// Runs the eval cases against the live model and saves a transcript.
//
//   bun eval                      every case
//   bun eval --case role-claim    one case (repeatable)
//   bun eval --group guardrail    one group
//
// Exits non-zero if any check fails, so it can gate prompt changes in CI.

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { answerQuestion, type AgentAnswer, type AgentDeps } from "../src/agent/answer.ts";
import { loadSystemPrompt } from "../src/agent/systemPrompt.ts";
import { anthropicClientOptions, loadAgentConfig } from "../src/config.ts";
import { createSources } from "../src/sources/index.ts";
import { CASES, type EvalCase } from "../evals/cases.ts";

const CONCURRENCY = 3;
const ROOT = path.join(import.meta.dirname, "..");
const ESCALATIONS_FILE = path.join(ROOT, "data", "escalations.json");
const RESULTS_DIR = path.join(ROOT, "evals", "results");

interface CaseResult {
  testCase: EvalCase;
  answer: AgentAnswer | null;
  error: string | null;
  checks: { name: string; passed: boolean }[];
  ms: number;
}

const { values } = parseArgs({
  options: {
    case: { type: "string", multiple: true },
    group: { type: "string" },
  },
});

const selected = CASES.filter(
  (c) => (!values.case || values.case.includes(c.id)) && (!values.group || c.group === values.group),
);
if (selected.length === 0) {
  console.error(`No cases match. Available: ${CASES.map((c) => c.id).join(", ")}`);
  process.exit(1);
}

const config = loadAgentConfig();
const deps: AgentDeps = {
  client: new Anthropic(anthropicClientOptions(config)),
  systemPrompt: await loadSystemPrompt(),
  sources: await createSources(),
  model: config.ECHOBOT_MODEL,
  effort: config.ECHOBOT_EFFORT,
};

async function runCase(testCase: EvalCase): Promise<CaseResult> {
  const started = Date.now();
  try {
    const answer = await answerQuestion(deps, { history: testCase.history ?? [], question: testCase.question, caller: testCase.caller });
    const checks = testCase.checks.map((c) => ({ name: c.name, passed: c.passes(answer) }));
    return { testCase, answer, error: null, checks, ms: Date.now() - started };
  } catch (error) {
    return { testCase, answer: null, error: (error as Error).message, checks: [], ms: Date.now() - started };
  }
}

async function runAll(cases: EvalCase[]): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const queue = [...cases];
  async function worker(): Promise<void> {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const result = await runCase(next);
      results.push(result);
      console.log(`${passed(result) ? "PASS" : "FAIL"}  ${result.testCase.id}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return cases.map((c) => results.find((r) => r.testCase === c)!);
}

function passed(result: CaseResult): boolean {
  return result.error === null && result.checks.every((c) => c.passed);
}

function callerLabel(c: EvalCase["caller"]): string {
  const who = c.callerType === "customer" ? `${c.callerTenant} customer` : "Echo employee";
  const where = c.channelType === "slack_connect" ? `channel shared with ${(c.tenantsVisibleHere as string[]).join(", ") || "no tenant"}` : `${c.channelType} channel`;
  return `${who}, ${where}`;
}

function transcript(results: CaseResult[], runAt: string): string {
  const total = results.length;
  const ok = results.filter(passed).length;
  const lines = [
    `# EchoBot eval run, ${runAt}`,
    "",
    `Model \`${deps.model}\`, effort \`${deps.effort}\`. **${ok} of ${total} cases passed.**`,
    "",
    "Mock sources are illustrative: Acme Corp and Globex are fictional, and CVE IDs use the fictional CVE-2026-9xxxx range.",
    "",
    "| Case | Result | Tools called |",
    "|---|---|---|",
    ...results.map((r) => `| ${r.testCase.id} | ${passed(r) ? "pass" : "**fail**"} | ${r.answer?.context.toolCalls.map((t) => `${t.name} (${t.outcome})`).join(", ") || "none"} |`),
    "",
  ];
  for (const r of results) {
    lines.push(
      "---",
      "",
      `## ${r.testCase.id}: ${passed(r) ? "pass" : "FAIL"}`,
      "",
      `${r.testCase.description}. Asked by: ${callerLabel(r.testCase.caller)}.`,
      "",
      ...(r.testCase.history ?? []).map((t) => `> **${t.role}:** ${t.text}`),
      `> **question:** ${r.testCase.question}`,
      "",
    );
    if (r.error) {
      lines.push(`Error: \`${r.error}\``, "");
      continue;
    }
    const a = r.answer!;
    lines.push(
      "**Answer**",
      "",
      "```text",
      a.text,
      "```",
      "",
      ...(a.rejectedDraft
        ? ["**Draft rejected by the citation check.** Links no tool returned: " + a.unverifiedUrls.map((u) => `\`${u}\``).join(", "), "", "```text", a.rejectedDraft, "```", ""]
        : []),
      ...r.checks.map((c) => `- ${c.passed ? "✅" : "❌"} ${c.name}`),
      "",
      `Verdict \`${a.verdict}\`${a.groundingRetry ? " after a grounding retry" : ""}. ${a.usage.input + a.usage.cacheRead + a.usage.cacheWrite} tokens in (${a.usage.cacheRead} from cache), ${a.usage.output} out, ${(r.ms / 1000).toFixed(1)}s.`,
      "",
    );
  }
  return lines.join("\n");
}

const escalationsBefore = existsSync(ESCALATIONS_FILE) ? await readFile(ESCALATIONS_FILE, "utf8") : null;
console.log(`Running ${selected.length} cases against ${deps.model}\n`);
const results = await runAll(selected);
if (escalationsBefore === null) await rm(ESCALATIONS_FILE, { force: true });
else await writeFile(ESCALATIONS_FILE, escalationsBefore);

const runAt = new Date().toISOString();
await mkdir(RESULTS_DIR, { recursive: true });
const file = path.join(RESULTS_DIR, `${runAt.replace(/[:.]/g, "-")}.md`);
await writeFile(file, transcript(results, runAt));

const failures = results.filter((r) => !passed(r));

// Caching breaks silently: requests still succeed, they just cost more. The
// system prompt and tool definitions are identical on every request, so a
// healthy run reads them from cache.
const cacheReads = results.reduce((sum, r) => sum + (r.answer?.usage.cacheRead ?? 0), 0);
const cacheHealthy = results.length < 2 || cacheReads > 0;
console.log(`\nPrompt cache: ${cacheReads} tokens read across ${results.length} cases${cacheHealthy ? "" : ". FAIL: nothing was read from cache"}`);
console.log(`\n${results.length - failures.length} of ${results.length} passed. Transcript: ${path.relative(process.cwd(), file)}`);
for (const r of failures) {
  console.log(`\nFAIL ${r.testCase.id}`);
  if (r.error) console.log(`  error: ${r.error}`);
  for (const c of r.checks.filter((c) => !c.passed)) console.log(`  ✗ ${c.name}`);
}
process.exit(failures.length > 0 || !cacheHealthy ? 1 : 0);
