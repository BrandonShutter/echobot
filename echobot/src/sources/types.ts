// The interfaces every source adapter implements. The demo ships mock
// adapters backed by fixtures; production adapters call the real APIs and
// return the same shapes, so swapping one is a credentials change plus one file.

export type SourceName = "docs" | "github" | "notion" | "retool" | "linear";

export interface DocHit {
  url: string;
  title: string;
  excerpt: string;
  /** True for fixture pages standing in for Echo's login-gated Mintlify docs. */
  illustrative: boolean;
}

export interface DocsSource {
  search(query: string, limit: number): Promise<DocHit[]>;
}

export interface ImageDefinition {
  image: string;
  tag: string;
  url: string;
  title: string;
  base: string;
  fips: { enabled: boolean; standard?: string; module?: string; notes?: string };
  keyPackages: string[];
  dockerfileExcerpt: string;
  relatedTags: string[];
  updatedAt: string;
}

export interface ImageLookup {
  found: ImageDefinition | null;
  /** Known image references, returned when the requested one doesn't exist. */
  suggestions: string[];
}

export interface ChangelogEntry {
  image: string;
  tag: string;
  date: string;
  summary: string;
  cves: string[];
  url: string;
  title: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  body: string;
  updatedAt: string;
}

export interface GitHubSource {
  getImageDefinition(image: string, tag: string): Promise<ImageLookup>;
  getPatchChangelog(image: string, limit: number): Promise<ChangelogEntry[]>;
  searchIssues(query: string, limit: number): Promise<GitHubIssue[]>;
}

export interface Runbook {
  id: string;
  title: string;
  url: string;
  visibility: "customer_safe" | "internal";
  updatedAt: string;
  body: string;
}

export interface NotionSource {
  searchRunbooks(query: string, limit: number): Promise<Runbook[]>;
}

export interface Tenant {
  id: string;
  name: string;
}

export interface TenantStatus {
  tenant: string;
  name: string;
  plan: string;
  licenseStatus: "active" | "trial" | "expired";
  licenseRenewsOn: string;
  registryNamespace: string;
  imagesInUse: string[];
  url: string;
  title: string;
}

export interface TenantCve {
  cve: string;
  severity: "critical" | "high" | "medium" | "low";
  image: string;
  status: string;
  firstSeen: string;
}

export interface TenantCveReport {
  tenant: string;
  generatedAt: string;
  cves: TenantCve[];
  url: string;
  title: string;
}

export interface RetoolSource {
  listTenants(): Promise<Tenant[]>;
  getTenantStatus(tenantId: string): Promise<TenantStatus | null>;
  getOpenCves(tenantId: string): Promise<TenantCveReport | null>;
}

/** Everything the person picking up an escalation needs, so they never re-ask the customer. */
export interface Handoff {
  problem: string;
  errorMessage: string | null;
  images: string[];
  foundInSources: string;
  suggestedFix: string | null;
  customerTried: string | null;
  impact: "blocked" | "degraded" | "question";
}

export interface Escalation {
  id: string;
  title: string;
  status: "triage" | "in_progress" | "waiting_on_customer" | "done";
  urgency: "normal" | "urgent";
  tenant: string | null;
  summary: string;
  handoff?: Handoff;
  url: string;
  createdAt: string;
}

export interface NewEscalation {
  title: string;
  summary: string;
  urgency: "normal" | "urgent";
  tenant: string | null;
  handoff: Handoff;
}

export interface LinearSource {
  getEscalation(id: string): Promise<Escalation | null>;
  createEscalation(input: NewEscalation): Promise<Escalation>;
}

export interface Sources {
  docs: DocsSource;
  github: GitHubSource;
  notion: NotionSource;
  retool: RetoolSource;
  linear: LinearSource;
}
