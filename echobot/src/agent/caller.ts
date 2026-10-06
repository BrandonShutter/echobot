// Who is asking, and what may be shown in the channel they asked in.
// Resolved by code from Slack, never from anything the model or user writes.

export type CallerType = "echo_employee" | "customer";
export type ChannelType = "internal" | "slack_connect" | "dm";

export interface CallerContext {
  callerType: CallerType;
  callerTenant: string | null;
  channelType: ChannelType;
  /** "all" only for Echo employees in internal channels or their own DMs. */
  tenantsVisibleHere: string[] | "all";
}

export function canSeeTenant(caller: CallerContext, tenantId: string): boolean {
  return caller.tenantsVisibleHere === "all" || caller.tenantsVisibleHere.includes(tenantId);
}

export function renderCallerContext(caller: CallerContext): string {
  const visible = caller.tenantsVisibleHere === "all" ? "all" : `[${caller.tenantsVisibleHere.join(", ")}]`;
  const lines = [
    "<caller_context>",
    `caller_type: ${caller.callerType}`,
    ...(caller.callerTenant ? [`caller_tenant: ${caller.callerTenant}`] : []),
    `channel_type: ${caller.channelType}`,
    `tenants_visible_here: ${visible}`,
    "</caller_context>",
  ];
  return lines.join("\n");
}
