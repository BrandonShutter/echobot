// Mock adapters for the sources the demo can't reach: Echo's private GitHub,
// Notion, Retool backoffice, and Linear. Each implements the same interface a
// real adapter would, backed by the illustrative fixtures in ./fixtures.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import github from "./fixtures/github.json" with { type: "json" };
import notion from "./fixtures/notion.json" with { type: "json" };
import retool from "./fixtures/retool.json" with { type: "json" };
import linear from "./fixtures/linear.json" with { type: "json" };
import { rankByKeywords } from "./keywordSearch.ts";
import type {
  ChangelogEntry,
  Escalation,
  GitHubIssue,
  GitHubSource,
  ImageDefinition,
  LinearSource,
  NotionSource,
  RetoolSource,
  Runbook,
  TenantCveReport,
  TenantStatus,
} from "./types.ts";

const ESCALATIONS_FILE = path.join(import.meta.dirname, "..", "..", "data", "escalations.json");

/** Accepts "python", "python:3.12", or "registry.echo.ai/python:3.12". */
function parseImageRef(image: string, tag: string): { image: string; tag: string } {
  const withoutRegistry = image.trim().toLowerCase().replace(/^registry\.echo\.ai\//, "");
  const [name, inlineTag] = withoutRegistry.split(":");
  return { image: name ?? "", tag: (inlineTag ?? tag).trim() || "latest" };
}

export function createMockGitHub(): GitHubSource {
  const images = github.images as ImageDefinition[];
  const changelog = github.changelog as ChangelogEntry[];
  const issues = github.issues as GitHubIssue[];

  return {
    async getImageDefinition(imageRef, tagRef) {
      const { image, tag } = parseImageRef(imageRef, tagRef);
      const found = images.find((d) => d.image === image && d.tag === tag) ?? null;
      const suggestions = found ? [] : images.map((d) => `${d.image}:${d.tag}`);
      return { found, suggestions };
    },
    async getPatchChangelog(imageRef, limit) {
      const { image } = parseImageRef(imageRef, "latest");
      return changelog.filter((e) => e.image === image).slice(0, limit);
    },
    async searchIssues(query, limit) {
      return rankByKeywords(issues, query, (i) => `${i.title} ${i.body}`, limit);
    },
  };
}

export function createMockNotion(): NotionSource {
  const runbooks = notion.runbooks as Runbook[];
  return {
    async searchRunbooks(query, limit) {
      return rankByKeywords(runbooks, query, (r) => `${r.title} ${r.body}`, limit);
    },
  };
}

interface FixtureTenant extends Omit<TenantStatus, "tenant"> {
  id: string;
  openCves: Omit<TenantCveReport, "tenant">;
}

export function createMockRetool(): RetoolSource {
  const tenants = retool.tenants as FixtureTenant[];
  const byId = (id: string) => tenants.find((t) => t.id === id);

  return {
    async listTenants() {
      return tenants.map((t) => ({ id: t.id, name: t.name }));
    },
    async getTenantStatus(tenantId) {
      const t = byId(tenantId);
      if (!t) return null;
      const { id, openCves: _openCves, ...status } = t;
      return { tenant: id, ...status };
    },
    async getOpenCves(tenantId) {
      const t = byId(tenantId);
      return t ? { tenant: t.id, ...t.openCves } : null;
    },
  };
}

export function createMockLinear(): LinearSource {
  const seeded = linear.escalations as Escalation[];

  async function created(): Promise<Escalation[]> {
    return existsSync(ESCALATIONS_FILE) ? (JSON.parse(await readFile(ESCALATIONS_FILE, "utf8")) as Escalation[]) : [];
  }

  return {
    async getEscalation(id) {
      const all = [...seeded, ...(await created())];
      return all.find((e) => e.id.toLowerCase() === id.trim().toLowerCase()) ?? null;
    },
    async createEscalation(input) {
      const existing = await created();
      const number = 200 + existing.length + 1;
      const escalation: Escalation = {
        id: `SUP-${number}`,
        status: "triage",
        url: `https://mock.echobot.local/linear/SUP-${number}`,
        createdAt: new Date().toISOString(),
        ...input,
      };
      await mkdir(path.dirname(ESCALATIONS_FILE), { recursive: true });
      await writeFile(ESCALATIONS_FILE, JSON.stringify([...existing, escalation], null, 2));
      return escalation;
    },
  };
}
