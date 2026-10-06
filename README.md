# EchoBot

Submission for the Echo TAM home assignment.

## The assignment

| File | What it is |
|---|---|
| [`deliverables/EchoBot-Architecture.pdf`](deliverables/EchoBot-Architecture.pdf) | Part 1: architecture, system diagram, how the bot reaches each tool, and what I'd do before production |
| [`deliverables/system_prompt.md`](deliverables/system_prompt.md) | Part 2: the complete system prompt, with inline notes on key decisions |
| [`deliverables/system_prompt_design_notes.md`](deliverables/system_prompt_design_notes.md) | The longer reasoning behind the prompt, and how it handles the four sample questions |

## Optional: a working version

[`echobot/`](echobot/) is a working Slack bot built from that design, to test that
the architecture and the prompt hold up. It reads its system prompt straight from
`deliverables/system_prompt.md`, so the submitted prompt is the one that ran.

[`echobot/evals/results/`](echobot/evals/results/) has a transcript of the bot's
real answers to the sample questions and the guardrail cases. Setup and run
instructions are in [`echobot/README.md`](echobot/README.md).
