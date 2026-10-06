// Turns the Slack thread into prior conversation turns, so follow-ups keep
// their context. The thread is context only; the prompt never cites it.

import type { WebClient } from "@slack/web-api";
import type { Turn } from "../agent/answer.ts";

const MAX_THREAD_MESSAGES = 20;

export function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

/** Recent messages in a direct message, oldest first, as conversation turns. */
export async function directMessageHistory(client: WebClient, channel: string, currentTs: string, botUserId: string): Promise<Turn[]> {
  const recent = await client.conversations.history({ channel, latest: currentTs, inclusive: false, limit: MAX_THREAD_MESSAGES });
  return (recent.messages ?? [])
    .filter((m) => !m.thread_ts && typeof m.text === "string" && m.text.trim().length > 0)
    .reverse()
    .map((m) => ({ role: m.user === botUserId || m.bot_id ? "assistant" : "user", text: stripMentions(m.text ?? "") }));
}

export async function threadHistory(
  client: WebClient,
  channel: string,
  threadTs: string,
  currentTs: string,
  botUserId: string,
): Promise<Turn[]> {
  if (threadTs === currentTs) return [];
  const replies = await client.conversations.replies({ channel, ts: threadTs, limit: MAX_THREAD_MESSAGES });
  return (replies.messages ?? [])
    .filter((m) => m.ts !== currentTs && typeof m.text === "string" && m.text.trim().length > 0)
    .map((m) => ({
      role: m.user === botUserId || m.bot_id ? "assistant" : "user",
      text: stripMentions(m.text ?? ""),
    }));
}
