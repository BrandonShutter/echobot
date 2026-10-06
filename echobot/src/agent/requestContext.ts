// Per-request state the tools write into: which sources were returned (for
// the citation check), which tools ran, and which tenants were touched (for
// the audit log).

import type { CallerContext } from "./caller.ts";
import type { SourceName } from "../sources/types.ts";

export interface SourceRef {
  url: string;
  title: string;
  source: SourceName;
}

export type ToolOutcome = "ok" | "empty" | "denied" | "not_found" | "error";

export interface ToolCallRecord {
  name: string;
  input: unknown;
  outcome: ToolOutcome;
}

export class RequestContext {
  readonly sources = new Map<string, SourceRef>();
  readonly toolCalls: ToolCallRecord[] = [];
  readonly tenantsTouched = new Set<string>();
  readonly escalationsCreated: string[] = [];
  resolution: { resolved: boolean; note: string | null } | null = null;

  readonly caller: CallerContext;

  constructor(caller: CallerContext) {
    this.caller = caller;
  }

  recordSources(refs: SourceRef[]): void {
    for (const ref of refs) this.sources.set(ref.url, ref);
  }

  recordCall(name: string, input: unknown, outcome: ToolOutcome): void {
    this.toolCalls.push({ name, input, outcome });
  }
}
