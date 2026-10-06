import Anthropic from "@anthropic-ai/sdk";
import { anthropicClientOptions, loadAgentConfig, loadSlackConfig } from "./config.ts";
import { loadSystemPrompt } from "./agent/systemPrompt.ts";
import { createSources } from "./sources/index.ts";
import { loadIdentities } from "./slack/identities.ts";
import { startSlackApp } from "./slack/app.ts";
import { logEvent } from "./log.ts";

const agentConfig = loadAgentConfig();
const slackConfig = loadSlackConfig();

await startSlackApp({
  botToken: slackConfig.SLACK_BOT_TOKEN,
  appToken: slackConfig.SLACK_APP_TOKEN,
  identities: await loadIdentities(slackConfig.ECHOBOT_DEMO_IDENTITIES),
  agent: {
    client: new Anthropic(anthropicClientOptions(agentConfig)),
    systemPrompt: await loadSystemPrompt(),
    sources: await createSources(),
    model: agentConfig.ECHOBOT_MODEL,
    effort: agentConfig.ECHOBOT_EFFORT,
  },
});

logEvent("echobot_started", { model: agentConfig.ECHOBOT_MODEL, effort: agentConfig.ECHOBOT_EFFORT });
