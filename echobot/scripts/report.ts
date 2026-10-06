// Weekly summary for the TAM team, built from data/events.jsonl.
//
//   bun report            last 7 days
//   bun report --days 30
//
// Answers three questions: how much work did the bot take off the TAMs, how
// good were its handoffs, and what should Echo's docs cover that they don't.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { SourceRef } from "../src/agent/requestContext.ts";
import type { CallerContext } from "../src/agent/caller.ts";
import type { TokenUsage, Verdict } from "../src/agent/answer.ts";
import { EVENTS_FILE } from "../src/log.ts";

interface AnsweredEvent {
  at: string;
  event: "answered";
  channel: string;
  threadTs: string;
  caller: CallerContext;
  question: string;
  verdict: Verdict;
  sources: SourceRef[];
  escalationsCreated: string[];
  usage: TokenUsage;
  ms: number;
}

interface FeedbackEvent {
  at: string;
  event: "answer_feedback";
  via: "reaction" | "conversation";
  outcome: "resolved" | "rejected";
  channel: string;
  threadTs?: string;
  ts?: string;
}

const { values } = parseArgs({ options: { days: { type: "string", default: "7" } } });
const since = Date.now() - Number(values.days) * 24 * 60 * 60 * 1000;

if (!existsSync(EVENTS_FILE)) {
  console.log("No events yet. Run the bot and ask it something first.");
  process.exit(0);
}

const events = (await readFile(EVENTS_FILE, "utf8"))
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { at: string; event: string })
  .filter((e) => Date.parse(e.at) >= since);

const answered = events.filter((e): e is AnsweredEvent => e.event === "answered");
const feedback = events.filter((e): e is FeedbackEvent => e.event === "answer_feedback");
const customer = answered.filter((e) => e.caller.callerType === "customer");

const threadKey = (channel: string, thread: string | undefined) => `${channel}:${thread ?? ""}`;
const customerThreads = new Map<string, AnsweredEvent[]>();
for (const e of customer) {
  const key = threadKey(e.channel, e.threadTs);
  customerThreads.set(key, [...(customerThreads.get(key) ?? []), e]);
}

const resolvedThreads = new Set(
  feedback.filter((f) => f.outcome === "resolved").map((f) => threadKey(f.channel, f.threadTs ?? f.ts)),
);
const rejectedThreads = new Set(
  feedback.filter((f) => f.outcome === "rejected").map((f) => threadKey(f.channel, f.threadTs ?? f.ts)),
);
const escalatedThreads = new Set(
  [...customerThreads].filter(([, turns]) => turns.some((t) => t.escalationsCreated.length > 0)).map(([key]) => key),
);
const resolvedWithoutHuman = [...resolvedThreads].filter((key) => customerThreads.has(key) && !escalatedThreads.has(key));

const notAnswered = customer.filter((e) => e.verdict !== "answered");
const runbookUse = new Map<string, number>();
for (const e of customer) {
  for (const s of e.sources.filter((src) => src.source === "notion")) {
    runbookUse.set(s.title, (runbookUse.get(s.title) ?? 0) + 1);
  }
}

const totals = answered.reduce(
  (t, e) => ({
    input: t.input + e.usage.input,
    output: t.output + e.usage.output,
    cacheRead: t.cacheRead + e.usage.cacheRead,
    cacheWrite: t.cacheWrite + e.usage.cacheWrite,
    ms: t.ms + e.ms,
  }),
  { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ms: 0 },
);
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);

console.log(`# EchoBot report, last ${values.days} days

## Work taken off the TAMs
- Customer conversations: ${customerThreads.size}
- Confirmed resolved without a human: ${resolvedWithoutHuman.length} (${pct(resolvedWithoutHuman.length, customerThreads.size)})
- Escalated to Echo's team: ${escalatedThreads.size}
- Marked unhelpful by the customer: ${rejectedThreads.size}
- Echo employee questions: ${answered.length - customer.length}

## Docs gaps: customer questions the sources couldn't answer
${notAnswered.length ? notAnswered.map((e) => `- "${e.question}" (${e.verdict})`).join("\n") : "- None this period."}

## Docs debt: runbooks that answered customer questions
These are internal pages doing the job of public docs. Each is a candidate for a published page.
${runbookUse.size ? [...runbookUse].sort((a, b) => b[1] - a[1]).map(([title, n]) => `- ${title}: ${n}`).join("\n") : "- None this period."}

## Cost and speed
- Answers: ${answered.length}
- Tokens: ${totals.input + totals.cacheRead + totals.cacheWrite} in (${pct(totals.cacheRead, totals.input + totals.cacheRead + totals.cacheWrite)} read from cache), ${totals.output} out
- Average time to answer: ${answered.length ? (totals.ms / answered.length / 1000).toFixed(1) : "n/a"}s
`);
