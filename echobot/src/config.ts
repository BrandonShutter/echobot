import * as z from "zod/v4";

const AgentEnv = z.object({
  // Explicit so a shell-level ANTHROPIC_BASE_URL (for example a local proxy) can't silently redirect the bot.
  ECHOBOT_ANTHROPIC_BASE_URL: z.url().default("https://api.anthropic.com"),
  // Needed only for API keys not scoped to a workspace (they start with sk-ant-usr-).
  ECHOBOT_ANTHROPIC_WORKSPACE_ID: z.string().optional(),
  ECHOBOT_MODEL: z.string().default("claude-opus-5-5"),
  ECHOBOT_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
});

const SlackEnv = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-", "SLACK_BOT_TOKEN should start with xoxb-"),
  SLACK_APP_TOKEN: z.string().startsWith("xapp-", "SLACK_APP_TOKEN should start with xapp-"),
  ECHOBOT_DEMO_IDENTITIES: z.string().optional(),
});

export type AgentConfig = z.infer<typeof AgentEnv>;
export type SlackConfig = z.infer<typeof SlackEnv>;

export function loadAgentConfig(): AgentConfig {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("Set ANTHROPIC_API_KEY in .env (see .env.example).");
  }
  return AgentEnv.parse(process.env);
}

/** The Anthropic client the bot uses, with its base URL and workspace pinned by config. */
export function anthropicClientOptions(config: AgentConfig): { baseURL: string; defaultHeaders?: Record<string, string> } {
  return {
    baseURL: config.ECHOBOT_ANTHROPIC_BASE_URL,
    ...(config.ECHOBOT_ANTHROPIC_WORKSPACE_ID
      ? { defaultHeaders: { "anthropic-workspace-id": config.ECHOBOT_ANTHROPIC_WORKSPACE_ID } }
      : {}),
  };
}

export function loadSlackConfig(): SlackConfig {
  const parsed = SlackEnv.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Slack settings missing or invalid in .env:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
