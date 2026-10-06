// The Slack side. A customer can mention @EchoBot, or simply reply in a thread
// where EchoBot just answered. Once an Echo person replies in the thread, the
// bot steps back until someone mentions it again.

import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { answerQuestion, type AgentDeps } from "../agent/answer.ts";
import { logEvent } from "../log.ts";
import type { Identities } from "./identities.ts";
import { resolveCaller } from "./resolveCaller.ts";
import { directMessageHistory, stripMentions, threadHistory } from "./threadHistory.ts";

const WORKING_REACTION = "eyes";
const RESOLVED_REACTIONS = new Set(["white_check_mark", "heavy_check_mark", "+1", "tada"]);
const REJECTED_REACTIONS = new Set(["-1", "x", "thumbsdown"]);
const ERROR_REPLY =
  "Something went wrong on my side and I couldn't answer. The error has been logged. Try again in a minute, or ask Echo's support team in this channel.";

export interface SlackAppOptions {
  botToken: string;
  appToken: string;
  identities: Identities;
  agent: AgentDeps;
}

interface IncomingQuestion {
  channel: string;
  user: string;
  text: string;
  ts: string;
  /** Null for a top-level direct message, which is answered in the conversation itself. */
  threadTs: string | null;
  trigger: "mention" | "thread_reply" | "direct_message";
}

interface BotIdentity {
  ownTeamId: string;
  botUserId: string;
}

export async function startSlackApp(options: SlackAppOptions): Promise<App> {
  const app = new App({ token: options.botToken, appToken: options.appToken, socketMode: true, logLevel: LogLevel.WARN });

  const auth = await app.client.auth.test();
  const bot: BotIdentity = { ownTeamId: auth.team_id ?? "", botUserId: auth.user_id ?? "" };

  app.event("app_mention", async ({ event, client }) => {
    await handleQuestion(client, options, bot, {
      channel: event.channel,
      user: event.user ?? "",
      text: event.text,
      ts: event.ts,
      threadTs: event.thread_ts ?? event.ts,
      trigger: "mention",
    });
  });

  app.event("message", async ({ event, client }) => {
    if (event.subtype !== undefined || !event.user || event.user === bot.botUserId || !event.text) return;
    const threadTs = "thread_ts" in event && event.thread_ts ? event.thread_ts : null;

    if (event.channel_type === "im") {
      await handleQuestion(client, options, bot, {
        channel: event.channel,
        user: event.user,
        text: event.text,
        ts: event.ts,
        threadTs,
        trigger: "direct_message",
      });
      return;
    }

    if (!threadTs) return;
    if (event.text.includes(`<@${bot.botUserId}>`)) return; // handled as a mention
    if (!(await isReplyToBot(client, event.channel, threadTs, event.ts, bot.botUserId))) return;

    await handleQuestion(client, options, bot, {
      channel: event.channel,
      user: event.user,
      text: event.text,
      ts: event.ts,
      threadTs,
      trigger: "thread_reply",
    });
  });

  app.event("reaction_added", async ({ event }) => {
    if (event.item_user !== bot.botUserId || event.item.type !== "message") return;
    const outcome = RESOLVED_REACTIONS.has(event.reaction) ? "resolved" : REJECTED_REACTIONS.has(event.reaction) ? "rejected" : null;
    if (!outcome) return;
    logEvent("answer_feedback", { via: "reaction", outcome, reaction: event.reaction, user: event.user, channel: event.item.channel, ts: event.item.ts });
  });

  await app.start();
  logEvent("slack_connected", { team: auth.team, botUserId: bot.botUserId, ownTeamId: bot.ownTeamId });
  return app;
}

/** True when the message directly before this one in the thread is the bot's. */
async function isReplyToBot(client: WebClient, channel: string, threadTs: string, ts: string, botUserId: string): Promise<boolean> {
  const replies = await client.conversations.replies({ channel, ts: threadTs, limit: 50 });
  const earlier = (replies.messages ?? []).filter((m) => m.ts !== undefined && m.ts < ts);
  const previous = earlier.at(-1);
  return previous !== undefined && (previous.user === botUserId || previous.bot_id !== undefined);
}

async function handleQuestion(client: WebClient, options: SlackAppOptions, bot: BotIdentity, q: IncomingQuestion): Promise<void> {
  const question = stripMentions(q.text);
  const started = Date.now();

  await client.reactions.add({ channel: q.channel, timestamp: q.ts, name: WORKING_REACTION }).catch(() => undefined);
  try {
    const isDirectMessage = q.trigger === "direct_message";
    const caller = await resolveCaller(client, { ownTeamId: bot.ownTeamId }, options.identities, q.user, q.channel, isDirectMessage);
    const history = q.threadTs
      ? await threadHistory(client, q.channel, q.threadTs, q.ts, bot.botUserId)
      : await directMessageHistory(client, q.channel, q.ts, bot.botUserId);
    const answer = await answerQuestion(options.agent, { history, question, caller });

    await client.chat.postMessage({
      channel: q.channel,
      ...(q.threadTs ? { thread_ts: q.threadTs } : {}),
      text: answer.text,
      unfurl_links: false,
      unfurl_media: false,
    });

    logEvent("answered", {
      channel: q.channel,
      threadTs: q.threadTs,
      user: q.user,
      trigger: q.trigger,
      caller,
      question,
      verdict: answer.verdict,
      tools: answer.context.toolCalls,
      sources: [...answer.context.sources.values()],
      unverifiedUrls: answer.unverifiedUrls,
      tenantsTouched: [...answer.context.tenantsTouched],
      escalationsCreated: answer.context.escalationsCreated,
      groundingRetry: answer.groundingRetry,
      iterations: answer.iterations,
      usage: answer.usage,
      ms: Date.now() - started,
    });
    if (answer.context.resolution) {
      logEvent("answer_feedback", {
        via: "conversation",
        outcome: answer.context.resolution.resolved ? "resolved" : "rejected",
        note: answer.context.resolution.note,
        user: q.user,
        channel: q.channel,
        threadTs: q.threadTs,
        caller,
      });
    }
  } catch (error) {
    logEvent("error", { channel: q.channel, user: q.user, question, error: (error as Error).stack ?? String(error) });
    await client.chat.postMessage({ channel: q.channel, ...(q.threadTs ? { thread_ts: q.threadTs } : {}), text: ERROR_REPLY }).catch(() => undefined);
  } finally {
    await client.reactions.remove({ channel: q.channel, timestamp: q.ts, name: WORKING_REACTION }).catch(() => undefined);
  }
}
