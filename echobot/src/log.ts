// One JSON line per event, written to stdout and to data/events.jsonl. The
// file feeds `bun report`, the weekly summary for the TAM team.

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const EVENTS_FILE = path.join(import.meta.dirname, "..", "data", "events.jsonl");
mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });

export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields });
  console.log(line);
  appendFileSync(EVENTS_FILE, `${line}\n`);
}
