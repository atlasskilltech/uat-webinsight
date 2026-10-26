// Central registry of enum-like values. Stored as strings in SQLite and
// validated here + in Zod schemas so the DB stays portable across engines.
// Each entry carries a human label and a semantic tone used for badges.

export type Tone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

export interface Option {
  value: string;
  label: string;
  tone?: Tone;
  description?: string;
}

function values(options: readonly Option[]): string[] {
  return options.map((o) => o.value);
}

export function labelOf(options: readonly Option[], value?: string | null): string {
  if (!value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}

export function toneOf(options: readonly Option[], value?: string | null): Tone {
  if (!value) return "neutral";
  return options.find((o) => o.value === value)?.tone ?? "neutral";
}

// --- Tasks ------------------------------------------------------------------

export const TASK_STATUSES: readonly Option[] = [
  { value: "not_started", label: "Not Started", tone: "neutral" },
  { value: "in_progress", label: "In Progress", tone: "info" },
  { value: "blocked", label: "Blocked", tone: "danger" },
  { value: "completed", label: "Completed", tone: "success" },
] as const;

export const PRIORITIES: readonly Option[] = [
  { value: "low", label: "Low", tone: "neutral" },
  { value: "medium", label: "Medium", tone: "info" },
  { value: "high", label: "High", tone: "warning" },
  { value: "critical", label: "Critical", tone: "danger" },
] as const;

export const TASK_CATEGORIES: readonly Option[] = [
  { value: "seo", label: "SEO", tone: "accent" },
  { value: "website", label: "Website Development", tone: "info" },
  { value: "backend", label: "Backend", tone: "info" },
  { value: "server", label: "Server", tone: "warning" },
  { value: "research", label: "Research", tone: "accent" },
  { value: "reporting", label: "Reporting", tone: "success" },
  { value: "administration", label: "Administration", tone: "neutral" },
  { value: "other", label: "Other", tone: "neutral" },
] as const;

// --- Issues -----------------------------------------------------------------

export const ISSUE_CATEGORIES: readonly Option[] = [
  { value: "indexing", label: "Indexing" },
  { value: "crawlability", label: "Crawlability" },
  { value: "metadata", label: "Metadata" },
  { value: "content", label: "Content" },
  { value: "performance", label: "Performance / Core Web Vitals" },
  { value: "mobile", label: "Mobile" },
  { value: "structured_data", label: "Structured Data" },
  { value: "links", label: "Links / Redirects" },
  { value: "accessibility", label: "Accessibility" },
  { value: "other", label: "Other" },
] as const;

export const SEVERITIES: readonly Option[] = [
  { value: "critical", label: "Critical", tone: "danger" },
  { value: "high", label: "High", tone: "warning" },
  { value: "medium", label: "Medium", tone: "info" },
  { value: "low", label: "Low", tone: "neutral" },
] as const;

export const ISSUE_STATUSES: readonly Option[] = [
  { value: "open", label: "Open", tone: "danger" },
  { value: "in_progress", label: "In Progress", tone: "info" },
  { value: "fixed", label: "Fixed (unverified)", tone: "warning" },
  { value: "verified", label: "Verified", tone: "success" },
  { value: "wont_fix", label: "Won't Fix", tone: "neutral" },
] as const;

export const APPROVAL_STATUSES: readonly Option[] = [
  { value: "pending", label: "Pending Approval", tone: "warning" },
  { value: "approved", label: "Approved", tone: "success" },
  { value: "rejected", label: "Rejected", tone: "danger" },
  { value: "not_required", label: "Not Required", tone: "neutral" },
] as const;

// --- Diagnostics ------------------------------------------------------------

export const CONFIDENCE_LEVELS: readonly Option[] = [
  { value: "high", label: "High confidence", tone: "success" },
  { value: "medium", label: "Medium confidence", tone: "warning" },
  { value: "low", label: "Low confidence", tone: "neutral" },
] as const;

export const FINDING_STATUSES: readonly Option[] = [
  { value: "open", label: "Open", tone: "info" },
  { value: "investigating", label: "Investigating", tone: "warning" },
  { value: "hypothesis", label: "Hypothesis", tone: "neutral" },
  { value: "confirmed", label: "Confirmed", tone: "danger" },
  { value: "resolved", label: "Resolved", tone: "success" },
  { value: "dismissed", label: "Dismissed", tone: "neutral" },
] as const;

// --- Server / operations ----------------------------------------------------

export const SERVER_ASSET_TYPES: readonly Option[] = [
  { value: "hosting", label: "Hosting" },
  { value: "domain", label: "Domain" },
  { value: "subdomain", label: "Subdomain" },
  { value: "application", label: "Application" },
  { value: "database", label: "Database" },
  { value: "api", label: "API Dependency" },
  { value: "ssl", label: "SSL Certificate" },
  { value: "service", label: "Service" },
] as const;

export const ASSET_STATUSES: readonly Option[] = [
  { value: "active", label: "Active", tone: "success" },
  { value: "degraded", label: "Degraded", tone: "warning" },
  { value: "down", label: "Down", tone: "danger" },
  { value: "retired", label: "Retired", tone: "neutral" },
] as const;

export const OPS_KINDS: readonly Option[] = [
  { value: "task", label: "Task", tone: "info" },
  { value: "incident", label: "Incident", tone: "danger" },
  { value: "maintenance", label: "Maintenance", tone: "neutral" },
  { value: "deployment", label: "Deployment", tone: "accent" },
  { value: "backup", label: "Backup", tone: "success" },
] as const;

export const OPS_STATUSES: readonly Option[] = [
  { value: "open", label: "Open", tone: "warning" },
  { value: "in_progress", label: "In Progress", tone: "info" },
  { value: "monitoring", label: "Monitoring", tone: "accent" },
  { value: "resolved", label: "Resolved", tone: "success" },
] as const;

export const VERIFICATION_STATUSES: readonly Option[] = [
  { value: "pending", label: "Pending", tone: "warning" },
  { value: "verified", label: "Verified", tone: "success" },
  { value: "failed", label: "Failed", tone: "danger" },
  { value: "n/a", label: "N/A", tone: "neutral" },
] as const;

// --- Competitor research ----------------------------------------------------

export const RESEARCH_CATEGORIES: readonly Option[] = [
  { value: "seo", label: "SEO" },
  { value: "content", label: "Content" },
  { value: "admissions", label: "Admissions" },
  { value: "conversion", label: "Conversion" },
  { value: "ux", label: "UX" },
  { value: "automation", label: "Automation" },
  { value: "technology", label: "Technology" },
  { value: "operations", label: "Operations" },
] as const;

export const RESEARCH_EFFORT: readonly Option[] = [
  { value: "low", label: "Low effort", tone: "success" },
  { value: "medium", label: "Medium effort", tone: "warning" },
  { value: "high", label: "High effort", tone: "danger" },
] as const;

export const RECOMMENDATIONS: readonly Option[] = [
  { value: "investigate", label: "Investigate", tone: "info" },
  { value: "pilot", label: "Pilot", tone: "accent" },
  { value: "adopt", label: "Adopt", tone: "success" },
  { value: "reject", label: "Reject", tone: "danger" },
] as const;

export const RESEARCH_STATUSES: readonly Option[] = [
  { value: "new", label: "New", tone: "info" },
  { value: "reviewing", label: "Reviewing", tone: "warning" },
  { value: "actioned", label: "Actioned", tone: "success" },
  { value: "archived", label: "Archived", tone: "neutral" },
] as const;

// --- Reports / integrations -------------------------------------------------

export const REPORT_TYPES: readonly Option[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom range" },
] as const;

export const REPORT_STATUSES: readonly Option[] = [
  { value: "draft", label: "Draft", tone: "warning" },
  { value: "final", label: "Final", tone: "success" },
] as const;

export const INTEGRATION_STATUSES: readonly Option[] = [
  { value: "not_connected", label: "Not Connected", tone: "neutral" },
  { value: "connected", label: "Connected", tone: "success" },
  { value: "error", label: "Error", tone: "danger" },
] as const;

// Convenience value-only lists for Zod enums.
export const TASK_STATUS_VALUES = values(TASK_STATUSES);
export const PRIORITY_VALUES = values(PRIORITIES);
export const TASK_CATEGORY_VALUES = values(TASK_CATEGORIES);
export const ISSUE_CATEGORY_VALUES = values(ISSUE_CATEGORIES);
export const SEVERITY_VALUES = values(SEVERITIES);
export const ISSUE_STATUS_VALUES = values(ISSUE_STATUSES);
export const APPROVAL_STATUS_VALUES = values(APPROVAL_STATUSES);
export const SERVER_ASSET_TYPE_VALUES = values(SERVER_ASSET_TYPES);
export const ASSET_STATUS_VALUES = values(ASSET_STATUSES);
export const OPS_KIND_VALUES = values(OPS_KINDS);
export const OPS_STATUS_VALUES = values(OPS_STATUSES);
export const VERIFICATION_STATUS_VALUES = values(VERIFICATION_STATUSES);
export const RESEARCH_CATEGORY_VALUES = values(RESEARCH_CATEGORIES);
export const RESEARCH_EFFORT_VALUES = values(RESEARCH_EFFORT);
export const RECOMMENDATION_VALUES = values(RECOMMENDATIONS);
export const RESEARCH_STATUS_VALUES = values(RESEARCH_STATUSES);
export const REPORT_TYPE_VALUES = values(REPORT_TYPES);
export const REPORT_STATUS_VALUES = values(REPORT_STATUSES);
