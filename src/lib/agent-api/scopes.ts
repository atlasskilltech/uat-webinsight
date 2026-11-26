/**
 * Scopes a Web Insight admin can grant to an IntelligenceOS key.
 *
 * Every scope here is READ-ONLY: the Agent API exposes information for the
 * IntelligenceOS voice/agents to read and summarise, and never changes or
 * deletes Web Insight data (per the ATLAS Agent API spec's guidance that keys
 * should not be given delete / bulk-export / write rights).
 *
 * This module is intentionally free of `server-only` so both the API handler
 * and the client-side admin UI can import the catalogue.
 */

export interface ScopeDef {
  id: string;
  label: string;
  description: string;
}

export const SCOPES: ScopeDef[] = [
  {
    id: "overview.read",
    label: "Executive overview",
    description: "Top-line KPIs: open tasks, priority issues, upcoming deadlines, site up/down and the latest data date.",
  },
  {
    id: "work.read",
    label: "Work & tasks",
    description: "Tasks (status, priority, due dates, progress), their activity timeline and the daily work log.",
  },
  {
    id: "seo.read",
    label: "SEO & analytics",
    description: "Search Console and GA4 performance for the website: totals, trends, top pages and top queries.",
  },
  {
    id: "inspector.read",
    label: "Page audits",
    description: "Page Inspector audits (SEO/technical checks, Core Web Vitals) and their rules-based findings.",
  },
  {
    id: "issues.read",
    label: "Technical SEO issues",
    description: "The technical issue register: severity, status, approval workflow and linked URLs.",
  },
  {
    id: "operations.read",
    label: "Backend & server",
    description: "Server/asset inventory with monitor state and SSL expiry, plus the operations log.",
  },
  {
    id: "competitors.read",
    label: "Competitor intelligence",
    description: "Structured competitor research, keeping observations separate from assumptions.",
  },
  {
    id: "reports.read",
    label: "Reports & history",
    description: "Generated weekly/monthly reports with their executive summaries and stored snapshots.",
  },
  {
    id: "settings.read",
    label: "Site & integrations",
    description: "Website property, timezone and which Google integrations are connected (no secrets or tokens).",
  },
  {
    id: "invoices.read",
    label: "Invoice Agent (finance)",
    description:
      "The Invoice Agent: invoice counts and outstanding totals, invoices (supplier/customer, amounts, due dates, status), what the agent has done, and connected inboxes (no bank details or tokens).",
  },
];

export const SCOPE_IDS: string[] = SCOPES.map((s) => s.id);

export const SCOPE_MAP: Record<string, ScopeDef> = Object.fromEntries(SCOPES.map((s) => [s.id, s]));

/** Presets offered in the admin UI. "Read everything" is the default. */
export const PRESETS: Record<string, { label: string; scopes: string[] }> = {
  read_all: { label: "Read everything (recommended)", scopes: SCOPE_IDS },
  website_only: {
    label: "Website only (SEO, audits, issues)",
    scopes: ["overview.read", "seo.read", "inspector.read", "issues.read"],
  },
};

/** Keep only known scope ids, de-duplicated and in catalogue order. */
export function normaliseScopes(input: unknown): string[] {
  const set = new Set<string>();
  if (Array.isArray(input)) {
    for (const s of input) if (typeof s === "string" && SCOPE_MAP[s]) set.add(s);
  }
  return SCOPE_IDS.filter((id) => set.has(id));
}

/** Short "Read only" / "Custom" label for a set of scopes (shown on the key card). */
export function accessLabel(scopes: string[]): string {
  const valid = normaliseScopes(scopes);
  if (!valid.length) return "No access";
  if (valid.length === SCOPE_IDS.length) return "Read only (all areas)";
  return "Read only";
}
