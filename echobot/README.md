# EchoBot

*Optional extra. The assignment asked for an architecture PDF and
`system_prompt.md`. I built this working version afterward to test that the
design and the prompt hold up, and I'm including it in case it's useful.*

A Slack bot that helps Echo customers solve technical problems from Echo's own
sources, so they don't have to wait on their TAM, and hands problems to Echo's
team with a full handoff when it can't. Built for the Echo TAM home assignment.

- Design: [`../deliverables/architecture.html`](../deliverables/architecture.html)
- System prompt: [`../deliverables/system_prompt.md`](../deliverables/system_prompt.md).
  The bot reads its prompt from that file, so the submitted prompt is the one
  that runs. The `<!-- -->` design notes in it are stripped before the prompt
  reaches Claude.
- Design notes: [`../deliverables/system_prompt_design_notes.md`](../deliverables/system_prompt_design_notes.md)

## What's real and what's mocked

| Source | In this demo |
|---|---|
| Slack | Real. Runs in any workspace via Socket Mode. |
| Docs | Real public echo.ai pages (331 pages, crawled locally), plus three labeled illustrative pages standing in for Echo's login-gated Mintlify docs. |
| GitHub, Notion, Retool, Linear | Mock adapters over fixtures in `src/sources/fixtures`. Every record is labeled illustrative. Acme Corp and Globex are fictional, and CVE IDs use the fictional `CVE-2026-9xxxx` range. |

Each mock implements the same interface a real adapter would (`src/sources/types.ts`).

## Setup

You need [Bun](https://bun.sh) and an Anthropic API key.

```bash
bun install
bun crawl-docs          # builds data/docs-index.json from echo.ai
cp .env.example .env    # then fill in the keys
```

### Create the Slack app

1. Go to <https://api.slack.com/apps>, choose **Create New App**, then **From a
   manifest**, pick your workspace, and paste `slack-manifest.yaml`.
2. Under **Basic Information**, in **App-Level Tokens**, generate a token with
   the `connections:write` scope. That's `SLACK_APP_TOKEN` (`xapp-...`).
3. Under **Install App**, install it to your workspace. The **Bot User OAuth
   Token** is `SLACK_BOT_TOKEN` (`xoxb-...`).
4. Invite the bot to a channel: `/invite @EchoBot`.

### Play a customer in a personal workspace

A personal workspace has no external organizations, so by default everyone in it
is an Echo employee. To test as a customer, copy `demo-identities.example.json` to
`demo-identities.json`, put real user and channel IDs from your workspace in it,
and set `ECHOBOT_DEMO_IDENTITIES=./demo-identities.json` in `.env`.

A typical setup is two channels, `#acme-shared` mapped to `acme-corp` and
`#globex-shared` mapped to `globex`, plus one user mapped as an Acme customer.
The bot logs a warning at startup when these overrides are loaded. They exist
only for the demo.

## Run

```bash
bun start               # connect to Slack
bun ask "How do I pull an image from the Echo registry?"
bun ask --as customer --tenant acme-corp --channel slack_connect "What CVEs are open for us?"
bun ask --as echo_employee --channel slack_connect --visible globex "What CVEs are open for Acme Corp?"
bun test                # guardrail tests, no API calls
bun run eval            # 14 live cases against Claude, saves a transcript to evals/results/
bun report              # weekly summary for the TAM team
```

`bun ask` runs the same agent as Slack without Slack, as any caller, which makes
it the fastest way to try the four sample questions.

## What the code enforces, regardless of the prompt

- **Tenant data:** the tenant tools check the caller resolved from Slack before
  they run, and give the same refusal for a forbidden tenant and a nonexistent
  one (`src/tools/buildTools.ts`).
- **Internal runbooks:** filtered out wherever a customer can read the reply.
- **Untrusted content:** tool output is redacted and wrapped as data
  (`src/tools/content.ts`).
- **Citations:** every link in an answer must match a URL a tool returned in that
  request, or the answer is replaced with an escalation offer
  (`src/agent/citations.ts`).
- **Grounding:** an answer that called no tool gets one retry with a reminder
  (`src/agent/answer.ts`).

`test/guardrails.test.ts` covers each of these without calling the API.

## Evals

`bun run eval` runs 14 cases against the live model: the four sample questions
from the brief, customer flows (troubleshooting with an error, confirming a fix,
asking for a person), and guardrail cases (another customer's CVEs, an Echo
employee in the wrong shared channel, a false admin claim, a planted prompt
injection, pricing, and a question no source answers). Every check is
deterministic and defined in `evals/cases.ts`. The run saves a transcript of
every answer to `evals/results/` and exits non-zero on any failure, so it can
gate prompt changes in CI.
