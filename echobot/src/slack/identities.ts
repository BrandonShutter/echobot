// How Slack identities map to Echo tenants.
//
// `teams` is the production mapping: a Slack Connect workspace ID to the
// tenant it belongs to. It should be a real table owned by ops; here it is a
// JSON file.
//
// `users` and `channels` are demo-only overrides. A personal Slack workspace
// has no external organizations, so these let one workspace play both Echo
// and a customer. They are logged loudly when loaded and must never ship.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as z from "zod/v4";
import { logEvent } from "../log.ts";

const IdentitiesFile = z.object({
  teams: z.record(z.string(), z.string()).default({}),
  users: z
    .record(z.string(), z.object({ callerType: z.enum(["echo_employee", "customer"]), tenant: z.string().nullable().default(null) }))
    .default({}),
  channels: z
    .record(z.string(), z.object({ channelType: z.enum(["internal", "slack_connect", "dm"]), tenants: z.array(z.string()).default([]) }))
    .default({}),
});

export type Identities = z.infer<typeof IdentitiesFile>;

export const NO_IDENTITIES: Identities = { teams: {}, users: {}, channels: {} };

export async function loadIdentities(path: string | undefined): Promise<Identities> {
  if (!path) return NO_IDENTITIES;
  if (!existsSync(path)) throw new Error(`ECHOBOT_DEMO_IDENTITIES points to ${path}, which doesn't exist.`);
  const identities = IdentitiesFile.parse(JSON.parse(await readFile(path, "utf8")));
  const overrides = Object.keys(identities.users).length + Object.keys(identities.channels).length;
  if (overrides > 0) {
    logEvent("demo_identity_overrides_loaded", {
      warning: "Demo only. User and channel overrides bypass Slack identity. Never use in production.",
      users: Object.keys(identities.users).length,
      channels: Object.keys(identities.channels).length,
    });
  }
  return identities;
}
