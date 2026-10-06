// Loads the system prompt from the submitted deliverable, so the prompt Echo
// reviews is exactly the prompt that runs. The <!-- --> lines in that file are
// design notes for reviewers; they are stripped here and never reach the model.

import { readFile } from "node:fs/promises";
import path from "node:path";

const PROMPT_FILE = path.join(import.meta.dirname, "..", "..", "..", "deliverables", "system_prompt.md");

export function stripReviewerNotes(prompt: string): string {
  return prompt.replace(/\n?<!--[\s\S]*?-->/g, "");
}

export async function loadSystemPrompt(): Promise<string> {
  const markdown = await readFile(PROMPT_FILE, "utf8");
  const blocks = [...markdown.matchAll(/```text\n([\s\S]*?)\n```/g)].map((m) => m[1] ?? "");
  const block = blocks.find((b) => b.trimStart().startsWith("<role>"));
  if (!block) throw new Error(`No \`\`\`text block starting with <role> found in ${PROMPT_FILE}`);
  return stripReviewerNotes(block).trim();
}
