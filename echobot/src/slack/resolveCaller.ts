// Resolves who is asking and who can read the reply, from Slack itself.
// Fails closed: an unmapped customer workspace sees no tenant data.

import type { WebClient } from "@slack/web-api";
import type { CallerContext, CallerType, ChannelType } from "../agent/caller.ts";
import type { Identities } from "./identities.ts";

export interface WorkspaceInfo {
  ownTeamId: string;
}

interface ConversationInfo {
  is_im?: boolean;
  is_ext_shared?: boolean;
  connected_team_ids?: string[];
  shared_team_ids?: string[];
}

export async function resolveCaller(
  client: WebClient,
  workspace: WorkspaceInfo,
  identities: Identities,
  userId: string,
  channelId: string,
  isDirectMessage = false,
): Promise<CallerContext> {
  const [userInfo, channelInfo] = await Promise.all([
    client.users.info({ user: userId }),
    // A DM needs no lookup, and skipping it avoids needing the im:read scope.
    isDirectMessage ? Promise.resolve({ channel: { is_im: true } }) : client.conversations.info({ channel: channelId }),
  ]);

  const userTeam = userInfo.user?.team_id ?? "";
  const conversation = (channelInfo.channel ?? {}) as ConversationInfo;

  let callerType: CallerType = userTeam === workspace.ownTeamId ? "echo_employee" : "customer";
  let callerTenant: string | null = callerType === "customer" ? (identities.teams[userTeam] ?? null) : null;

  const userOverride = identities.users[userId];
  if (userOverride) {
    callerType = userOverride.callerType;
    callerTenant = userOverride.tenant;
  }

  let channelType: ChannelType = conversation.is_im ? "dm" : conversation.is_ext_shared ? "slack_connect" : "internal";
  const externalTeams = (conversation.connected_team_ids ?? conversation.shared_team_ids ?? []).filter((t) => t !== workspace.ownTeamId);
  let channelTenants = externalTeams.flatMap((t) => (identities.teams[t] ? [identities.teams[t]] : []));

  const channelOverride = identities.channels[channelId];
  if (channelOverride) {
    channelType = channelOverride.channelType;
    channelTenants = channelOverride.tenants;
  }

  return {
    callerType,
    callerTenant,
    channelType,
    tenantsVisibleHere: visibleTenants(callerType, callerTenant, channelType, channelTenants),
  };
}

/** The rule depends on who can read the reply, not only on who asked. */
export function visibleTenants(
  callerType: CallerType,
  callerTenant: string | null,
  channelType: ChannelType,
  channelTenants: string[],
): string[] | "all" {
  if (channelType === "slack_connect") return channelTenants;
  if (callerType === "echo_employee") return "all";
  return callerTenant ? [callerTenant] : [];
}
