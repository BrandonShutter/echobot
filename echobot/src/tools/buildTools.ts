// The tools Claude can call. Each one is built per request around a
// RequestContext, so authorization decisions use the caller resolved from
// Slack, never a tenant or role the model passes in.

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { canSeeTenant } from "../agent/caller.ts";
import type { RequestContext } from "../agent/requestContext.ts";
import type { Sources, Tenant } from "../sources/types.ts";
import { toolNotice, wrapToolContent } from "./content.ts";

const SEARCH_LIMIT = 5;

const DENIED = toolNotice(
  "authorization_error",
  "Tenant data for this request can't be shown in this channel. Tell the user you can't share it here and where they can ask instead. Do not say whether the company is an Echo customer.",
);

/** Internal runbooks are only shown where no customer can read the reply. */
function internalContentAllowed(ctx: RequestContext): boolean {
  return ctx.caller.callerType === "echo_employee" && ctx.caller.channelType !== "slack_connect";
}

function slug(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type TenantResolution = { kind: "allowed"; tenant: Tenant } | { kind: "denied" } | { kind: "not_found" };

const TENANT_INPUT = z.object({
  tenant: z
    .string()
    .optional()
    .describe("Tenant ID or company name, e.g. 'acme-corp' or 'Acme Corp'. Leave out when a customer asks about their own tenant."),
});

const NO_TENANT_GIVEN = toolNotice("not_found", "No tenant was given and the caller isn't a customer. Ask which customer they mean.");

/**
 * Matches a tenant by ID or name, then applies the access check. When the
 * caller can't see every tenant, an unknown tenant and a forbidden one get the
 * same answer, so the bot never confirms who is a customer.
 */
async function resolveTenant(ctx: RequestContext, sources: Sources, requested: string | undefined): Promise<TenantResolution> {
  const asked = requested?.trim() || ctx.caller.callerTenant;
  if (!asked) return { kind: "not_found" };
  const wanted = slug(asked);
  const tenants = await sources.retool.listTenants();
  const match = tenants.find((t) => t.id === wanted || slug(t.name) === wanted);

  if (ctx.caller.tenantsVisibleHere !== "all") {
    return match && canSeeTenant(ctx.caller, match.id) ? { kind: "allowed", tenant: match } : { kind: "denied" };
  }
  return match ? { kind: "allowed", tenant: match } : { kind: "not_found" };
}

export function buildTools(ctx: RequestContext, sources: Sources) {
  const searchDocs = betaZodTool({
    name: "search_docs",
    description:
      "Search Echo's product documentation: registry access, pulling images, image catalog pages, variants such as -fips images, migration guides, and integrations. Use for how-to questions and official guidance.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Search terms, e.g. 'registry login pull token' or 'python fips variant'"),
    }),
    run: async ({ query }) => {
      const hits = await sources.docs.search(query, SEARCH_LIMIT);
      ctx.recordCall("search_docs", { query }, hits.length ? "ok" : "empty");
      if (hits.length === 0) return toolNotice("no_results", `No documentation matched "${query}".`);
      ctx.recordSources(hits.map((h) => ({ url: h.url, title: h.title, source: "docs" })));
      return wrapToolContent("docs", hits);
    },
  });

  const getImageDefinition = betaZodTool({
    name: "get_image_definition",
    description:
      "Get the definition of one Echo image tag from GitHub: base, key packages, whether it is a FIPS build and which validated module it uses, Dockerfile excerpt, and related tags. GitHub is the source of truth for what an image contains.",
    inputSchema: z.object({
      image: z.string().min(1).describe("Image name, e.g. 'python', 'python-fips', or 'registry.echo.ai/jdk-fips'"),
      tag: z.string().default("latest").describe("Tag, e.g. 'latest', '3.12', 'openjdk-21'"),
    }),
    run: async ({ image, tag }) => {
      const { found, suggestions } = await sources.github.getImageDefinition(image, tag);
      if (!found) {
        ctx.recordCall("get_image_definition", { image, tag }, "not_found");
        return toolNotice("not_found", `No image definition for ${image}:${tag}. Known image tags: ${suggestions.join(", ")}.`);
      }
      ctx.recordCall("get_image_definition", { image, tag }, "ok");
      ctx.recordSources([{ url: found.url, title: found.title, source: "github" }]);
      return wrapToolContent("github", found);
    },
  });

  const getPatchChangelog = betaZodTool({
    name: "get_patch_changelog",
    description: "Get recent patch history for an Echo image from GitHub: dates, what changed, and which CVEs each rebuild fixed.",
    inputSchema: z.object({
      image: z.string().min(1).describe("Image name, e.g. 'python' or 'python-fips'"),
      limit: z.number().int().min(1).max(20).default(5),
    }),
    run: async ({ image, limit }) => {
      const entries = await sources.github.getPatchChangelog(image, limit);
      ctx.recordCall("get_patch_changelog", { image, limit }, entries.length ? "ok" : "empty");
      if (entries.length === 0) return toolNotice("no_results", `No changelog entries found for ${image}.`);
      ctx.recordSources(entries.map((e) => ({ url: e.url, title: e.title, source: "github" })));
      return wrapToolContent("github", entries);
    },
  });

  const searchGithubIssues = betaZodTool({
    name: "search_github_issues",
    description: "Search open and closed issues in Echo's image repositories for known bugs and their status.",
    inputSchema: z.object({ query: z.string().min(2) }),
    run: async ({ query }) => {
      const issues = await sources.github.searchIssues(query, SEARCH_LIMIT);
      ctx.recordCall("search_github_issues", { query }, issues.length ? "ok" : "empty");
      if (issues.length === 0) return toolNotice("no_results", `No GitHub issues matched "${query}".`);
      ctx.recordSources(issues.map((i) => ({ url: i.url, title: i.title, source: "github" })));
      return wrapToolContent("github", issues);
    },
  });

  const searchRunbooks = betaZodTool({
    name: "search_runbooks",
    description: "Search Echo's support runbooks in Notion for known issues, workarounds, and troubleshooting steps.",
    inputSchema: z.object({ query: z.string().min(2) }),
    run: async ({ query }) => {
      const all = await sources.notion.searchRunbooks(query, SEARCH_LIMIT);
      const visible = internalContentAllowed(ctx) ? all : all.filter((r) => r.visibility === "customer_safe");
      ctx.recordCall("search_runbooks", { query }, visible.length ? "ok" : "empty");
      if (visible.length === 0) return toolNotice("no_results", `No runbooks matched "${query}".`);
      ctx.recordSources(visible.map((r) => ({ url: r.url, title: r.title, source: "notion" })));
      return wrapToolContent("notion", visible);
    },
  });

  const getTenantStatus = betaZodTool({
    name: "get_tenant_status",
    description:
      "Get one customer tenant's plan, license status, renewal date, registry namespace, and the images and tags they use, from Echo's backoffice. For a customer, call it without a tenant to get their own.",
    inputSchema: TENANT_INPUT,
    run: async ({ tenant }) => {
      if (!tenant && !ctx.caller.callerTenant) return ctx.caller.callerType === "customer" ? DENIED : NO_TENANT_GIVEN;
      const resolved = await resolveTenant(ctx, sources, tenant);
      if (resolved.kind === "denied") {
        ctx.recordCall("get_tenant_status", { tenant }, "denied");
        return DENIED;
      }
      if (resolved.kind === "not_found") {
        ctx.recordCall("get_tenant_status", { tenant }, "not_found");
        return toolNotice("not_found", `No tenant matches "${tenant}".`);
      }
      const status = await sources.retool.getTenantStatus(resolved.tenant.id);
      ctx.recordCall("get_tenant_status", { tenant }, status ? "ok" : "not_found");
      if (!status) return toolNotice("not_found", `No status record for ${resolved.tenant.id}.`);
      ctx.tenantsTouched.add(status.tenant);
      ctx.recordSources([{ url: status.url, title: status.title, source: "retool" }]);
      return wrapToolContent("retool", status);
    },
  });

  const getOpenCves = betaZodTool({
    name: "get_open_cves",
    description:
      "Get the CVEs currently open for one customer tenant, with severity, affected image, and status, from Echo's backoffice. For a customer, call it without a tenant to get their own.",
    inputSchema: TENANT_INPUT,
    run: async ({ tenant }) => {
      if (!tenant && !ctx.caller.callerTenant) return ctx.caller.callerType === "customer" ? DENIED : NO_TENANT_GIVEN;
      const resolved = await resolveTenant(ctx, sources, tenant);
      if (resolved.kind === "denied") {
        ctx.recordCall("get_open_cves", { tenant }, "denied");
        return DENIED;
      }
      if (resolved.kind === "not_found") {
        ctx.recordCall("get_open_cves", { tenant }, "not_found");
        return toolNotice("not_found", `No tenant matches "${tenant}".`);
      }
      const report = await sources.retool.getOpenCves(resolved.tenant.id);
      ctx.recordCall("get_open_cves", { tenant }, report ? "ok" : "not_found");
      if (!report) return toolNotice("not_found", `No CVE report for ${resolved.tenant.id}.`);
      ctx.tenantsTouched.add(report.tenant);
      ctx.recordSources([{ url: report.url, title: report.title, source: "retool" }]);
      return wrapToolContent("retool", report);
    },
  });

  const getEscalationStatus = betaZodTool({
    name: "get_escalation_status",
    description: "Get the status of a support escalation in Linear by its ID, e.g. SUP-104. Status only, never a source for how the product works.",
    inputSchema: z.object({ ticket_id: z.string().min(1) }),
    run: async ({ ticket_id }) => {
      const escalation = await sources.linear.getEscalation(ticket_id);
      const hidden = escalation?.tenant && !canSeeTenant(ctx.caller, escalation.tenant);
      if (!escalation || hidden) {
        ctx.recordCall("get_escalation_status", { ticket_id }, hidden ? "denied" : "not_found");
        return toolNotice("not_found", `No escalation ${ticket_id} is visible here.`);
      }
      ctx.recordCall("get_escalation_status", { ticket_id }, "ok");
      ctx.recordSources([{ url: escalation.url, title: `${escalation.id}: ${escalation.title}`, source: "linear" }]);
      return wrapToolContent("linear", escalation);
    },
  });

  const createEscalation = betaZodTool({
    name: "create_escalation",
    description:
      "Hand a problem to Echo's support team in Linear. Fill in every field you can from the conversation so whoever picks it up never has to ask the customer again. Use urgency 'urgent' only for a possible security incident or production outage involving an Echo artifact.",
    inputSchema: z.object({
      title: z.string().min(5).max(120),
      problem: z.string().min(10).describe("The problem in one sentence"),
      error_message: z.string().optional().describe("The exact error text, if there is one"),
      images: z.array(z.string()).default([]).describe("Images and tags involved, e.g. ['python-fips:3.12']"),
      found_in_sources: z.string().min(10).describe("What you searched and what Echo's sources said"),
      suggested_fix: z.string().optional().describe("What you suggested, if anything"),
      customer_tried: z.string().optional().describe("What the customer already tried and what happened"),
      impact: z.enum(["blocked", "degraded", "question"]).describe("How badly the customer is blocked"),
      urgency: z.enum(["normal", "urgent"]),
    }),
    run: async (input) => {
      const handoff = {
        problem: input.problem,
        errorMessage: input.error_message ?? null,
        images: input.images,
        foundInSources: input.found_in_sources,
        suggestedFix: input.suggested_fix ?? null,
        customerTried: input.customer_tried ?? null,
        impact: input.impact,
      };
      const escalation = await sources.linear.createEscalation({
        title: input.title,
        summary: input.problem,
        urgency: input.urgency,
        tenant: ctx.caller.callerTenant,
        handoff,
      });
      ctx.recordCall("create_escalation", { title: input.title, urgency: input.urgency, impact: input.impact }, "ok");
      ctx.escalationsCreated.push(escalation.id);
      ctx.recordSources([{ url: escalation.url, title: `${escalation.id}: ${escalation.title}`, source: "linear" }]);
      return wrapToolContent("linear", { id: escalation.id, status: escalation.status, url: escalation.url });
    },
  });

  const recordResolution = betaZodTool({
    name: "record_resolution",
    description:
      "Record whether your earlier answer solved the customer's problem. Call it when they say the fix worked (resolved: true) or didn't (resolved: false).",
    inputSchema: z.object({
      resolved: z.boolean(),
      note: z.string().optional().describe("What worked, or what still fails"),
    }),
    run: async ({ resolved, note }) => {
      ctx.resolution = { resolved, note: note ?? null };
      ctx.recordCall("record_resolution", { resolved }, "ok");
      return toolNotice("no_results", resolved ? "Recorded as resolved." : "Recorded as not resolved. Offer to escalate with what was tried.");
    },
  });

  return [
    searchDocs,
    getImageDefinition,
    getPatchChangelog,
    searchGithubIssues,
    searchRunbooks,
    getTenantStatus,
    getOpenCves,
    getEscalationStatus,
    createEscalation,
    recordResolution,
  ];
}
