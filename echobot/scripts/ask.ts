// Ask EchoBot a question from the terminal, as any caller, without Slack.
//
//   bun ask "How do I pull an image from the Echo registry?"
//   bun ask --as customer --tenant acme-corp --channel slack_connect "What CVEs are open for us?"
//   bun ask --as echo_employee --channel slack_connect --visible globex "What CVEs are open for Acme Corp?"

import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { answerQuestion } from "../src/agent/answer.ts";
import type { CallerContext, CallerType, ChannelType } from "../src/agent/caller.ts";
import { loadSystemPrompt } from "../src/agent/systemPrompt.ts";
import { anthropicClientOptions, loadAgentConfig } from "../src/config.ts";
import { visibleTenants } from "../src/slack/resolveCaller.ts";
import { createSources } from "../src/sources/index.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    as: { type: "string", default: "echo_employee" },
    tenant: { type: "string" },
    channel: { type: "string", default: "internal" },
    visible: { type: "string", default: "" },
    json: { type: "boolean", default: false },
  },
});

const question = positionals.join(" ").trim();
if (!question) {
  console.error('Usage: bun ask [--as customer|echo_employee] [--tenant id] [--channel internal|slack_connect|dm] [--visible id,id] "question"');
  process.exit(1);
}

const callerType = values.as as CallerType;
const channelType = values.channel as ChannelType;
const callerTenant = values.tenant ?? null;
const channelTenants = values.visible ? values.visible.split(",") : callerTenant && channelType === "slack_connect" ? [callerTenant] : [];
const caller: CallerContext = {
  callerType,
  callerTenant,
  channelType,
  tenantsVisibleHere: visibleTenants(callerType, callerTenant, channelType, channelTenants),
};

const config = loadAgentConfig();
const answer = await answerQuestion(
  {
    client: new Anthropic(anthropicClientOptions(config)),
    systemPrompt: await loadSystemPrompt(),
    sources: await createSources(),
    model: config.ECHOBOT_MODEL,
    effort: config.ECHOBOT_EFFORT,
  },
  { history: [], question, caller },
);

if (values.json) {
  console.log(JSON.stringify({ caller, ...answer, context: { toolCalls: answer.context.toolCalls, sources: [...answer.context.sources.values()] } }, null, 2));
} else {
  console.log(`\n${answer.text}\n`);
  console.log(`verdict: ${answer.verdict}${answer.groundingRetry ? " (after grounding retry)" : ""}`);
  console.log(`caller: ${JSON.stringify(caller)}`);
  console.log(`tools: ${answer.context.toolCalls.map((t) => `${t.name}=${t.outcome}`).join(", ") || "none"}`);
  console.log(`tokens: in ${answer.usage.input}, out ${answer.usage.output}, cache read ${answer.usage.cacheRead}, cache write ${answer.usage.cacheWrite}`);
  if (answer.unverifiedUrls.length) console.log(`unverified links: ${answer.unverifiedUrls.join(", ")}`);
}
