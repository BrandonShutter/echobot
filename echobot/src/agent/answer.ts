// Runs one question through Claude with the tools, then applies the checks
// the prompt can't enforce on its own: a retry when Claude answers without
// calling any tool, and the citation check on the final text.

import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageParam, BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages";
import { renderCallerContext, type CallerContext } from "./caller.ts";
import { checkCitations } from "./citations.ts";
import { RequestContext } from "./requestContext.ts";
import { toSlackMrkdwn } from "./slackFormat.ts";
import { buildTools } from "../tools/buildTools.ts";
import type { Sources } from "../sources/types.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentDeps {
  client: Anthropic;
  systemPrompt: string;
  sources: Sources;
  model: string;
  effort: Effort;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface AnswerInput {
  history: Turn[];
  question: string;
  caller: CallerContext;
}

export type Verdict = "answered" | "uncited_fallback" | "refusal" | "empty";

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface AgentAnswer {
  text: string;
  verdict: Verdict;
  context: RequestContext;
  unverifiedUrls: string[];
  /** The model's answer when the citation check replaced it, kept for logs and evals. */
  rejectedDraft: string | null;
  usage: TokenUsage;
  iterations: number;
  groundingRetry: boolean;
}

const MAX_TOOL_ITERATIONS = 8;

const GROUNDING_REMINDER =
  "Reminder from the operator: if this question is about Echo, call at least one tool before answering. If it is out of scope or too vague to search, reply as the system prompt describes.";

export const NO_SOURCE_REPLY =
  "I couldn't find that in Echo's sources. Want me to escalate it to the support team? Mention me in this thread with \"escalate\" and I'll open a ticket.";

const REFUSAL_REPLY =
  "I can't help with that one here. If you'd like, mention me with \"escalate\" and I'll pass it to Echo's support team.";

function toMessages(history: Turn[], question: string): BetaMessageParam[] {
  const firstUser = history.findIndex((t) => t.role === "user");
  const usable = firstUser === -1 ? [] : history.slice(firstUser);
  return [...usable.map((t) => ({ role: t.role, content: t.text })), { role: "user", content: question }];
}

function addUsage(total: TokenUsage, usage: BetaUsage): void {
  total.input += usage.input_tokens;
  total.output += usage.output_tokens;
  total.cacheRead += usage.cache_read_input_tokens ?? 0;
  total.cacheWrite += usage.cache_creation_input_tokens ?? 0;
}

function textOf(message: BetaMessage): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

async function runOnce(deps: AgentDeps, ctx: RequestContext, messages: BetaMessageParam[], usage: TokenUsage) {
  const runner = deps.client.beta.messages.toolRunner({
    model: deps.model,
    max_tokens: 16000,
    system: [{ type: "text", text: deps.systemPrompt, cache_control: { type: "ephemeral" } }],
    tools: buildTools(ctx, deps.sources),
    messages,
    output_config: { effort: deps.effort },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_iterations: MAX_TOOL_ITERATIONS,
  });

  let final: BetaMessage | undefined;
  let iterations = 0;
  for await (const message of runner) {
    iterations += 1;
    final = message;
    addUsage(usage, message.usage);
    if (message.stop_reason === "refusal") break;
  }
  if (!final) throw new Error("Claude returned no message");
  return { final, iterations };
}

export async function answerQuestion(deps: AgentDeps, input: AnswerInput): Promise<AgentAnswer> {
  const ctx = new RequestContext(input.caller);
  const usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const base = toMessages(input.history, input.question);
  const callerMessage = renderCallerContext(input.caller);

  let run = await runOnce(deps, ctx, [...base, { role: "system", content: callerMessage }], usage);
  let groundingRetry = false;

  if (run.final.stop_reason !== "refusal" && ctx.toolCalls.length === 0) {
    groundingRetry = true;
    const retry = await runOnce(deps, ctx, [...base, { role: "system", content: `${callerMessage}\n\n${GROUNDING_REMINDER}` }], usage);
    run = { final: retry.final, iterations: run.iterations + retry.iterations };
  }

  const result = { context: ctx, usage, iterations: run.iterations, groundingRetry, rejectedDraft: null };

  if (run.final.stop_reason === "refusal") {
    return { ...result, text: REFUSAL_REPLY, verdict: "refusal", unverifiedUrls: [] };
  }

  const text = toSlackMrkdwn(textOf(run.final));
  if (!text) return { ...result, text: NO_SOURCE_REPLY, verdict: "empty", unverifiedUrls: [] };

  const { unverified } = checkCitations(text, ctx.sources.keys());
  if (unverified.length > 0) {
    return { ...result, text: NO_SOURCE_REPLY, verdict: "uncited_fallback", unverifiedUrls: unverified, rejectedDraft: text };
  }
  return { ...result, text, verdict: "answered", unverifiedUrls: [] };
}
