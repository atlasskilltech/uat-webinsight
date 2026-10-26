import { z } from "zod";
import {
  TASK_STATUS_VALUES,
  PRIORITY_VALUES,
  TASK_CATEGORY_VALUES,
  ISSUE_CATEGORY_VALUES,
  SEVERITY_VALUES,
  ISSUE_STATUS_VALUES,
  APPROVAL_STATUS_VALUES,
  SERVER_ASSET_TYPE_VALUES,
  ASSET_STATUS_VALUES,
  OPS_KIND_VALUES,
  OPS_STATUS_VALUES,
  VERIFICATION_STATUS_VALUES,
  RESEARCH_CATEGORY_VALUES,
  RESEARCH_EFFORT_VALUES,
  RECOMMENDATION_VALUES,
  RESEARCH_STATUS_VALUES,
  REPORT_TYPE_VALUES,
  REPORT_STATUS_VALUES,
} from "./enums";

/** Treat empty strings from form fields as undefined. */
const emptyToUndef = (v: unknown) => (v === "" || v == null ? undefined : v);

const optionalString = z.preprocess(emptyToUndef, z.string().trim().optional());
const optionalDate = z.preprocess(
  emptyToUndef,
  z.coerce.date().optional(),
);
const optionalInt = z.preprocess(
  emptyToUndef,
  z.coerce.number().int().min(0).optional(),
);

const enumOf = (values: string[], fallback: string) =>
  z.preprocess(emptyToUndef, z.enum(values as [string, ...string[]]).catch(fallback as never)).default(fallback);

// --- Task -------------------------------------------------------------------

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalString,
  category: enumOf(TASK_CATEGORY_VALUES, "other"),
  status: enumOf(TASK_STATUS_VALUES, "not_started"),
  priority: enumOf(PRIORITY_VALUES, "medium"),
  projectId: optionalString,
  startDate: optionalDate,
  dueDate: optionalDate,
  completedDate: optionalDate,
  estimatedMinutes: optionalInt,
  actualMinutes: optionalInt,
  progress: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).max(100)).default(0),
  relatedUrl: optionalString,
  notes: optionalString,
  completionSummary: optionalString,
  blocker: optionalString,
  nextAction: optionalString,
  issueId: optionalString,
});
export type TaskInput = z.infer<typeof taskSchema>;

export const workLogSchema = z.object({
  date: z.coerce.date(),
  summary: z.string().trim().min(1, "Describe what you did").max(500),
  category: enumOf(TASK_CATEGORY_VALUES, "other"),
  minutes: optionalInt,
  taskId: optionalString,
});

export const projectSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: optionalString,
  color: z.string().trim().default("#6366f1"),
});

// --- Technical issue --------------------------------------------------------

export const issueSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  urls: optionalString, // newline/comma separated, split server-side
  category: enumOf(ISSUE_CATEGORY_VALUES, "other"),
  evidence: optionalString,
  source: optionalString,
  severity: enumOf(SEVERITY_VALUES, "medium"),
  priority: enumOf(PRIORITY_VALUES, "medium"),
  impact: optionalString,
  recommendedFix: optionalString,
  status: enumOf(ISSUE_STATUS_VALUES, "open"),
  owner: optionalString,
  approvalStatus: enumOf(APPROVAL_STATUS_VALUES, "pending"),
  implementationNotes: optionalString,
  verificationResult: optionalString,
  dateDiscovered: optionalDate,
  dateResolved: optionalDate,
});

// --- Server asset + ops log -------------------------------------------------

export const serverAssetSchema = z.object({
  type: enumOf(SERVER_ASSET_TYPE_VALUES, "application"),
  name: z.string().trim().min(1, "Name is required").max(160),
  provider: optionalString,
  plan: optionalString,
  environment: optionalString,
  version: optionalString,
  status: enumOf(ASSET_STATUS_VALUES, "active"),
  sslExpiry: optionalDate,
  notes: optionalString,
});

export const opsLogSchema = z.object({
  occurredAt: z.coerce.date(),
  system: z.string().trim().min(1, "System is required").max(160),
  title: z.string().trim().min(1, "Title is required").max(200),
  kind: enumOf(OPS_KIND_VALUES, "task"),
  symptoms: optionalString,
  investigation: optionalString,
  resolution: optionalString,
  verificationStatus: enumOf(VERIFICATION_STATUS_VALUES, "pending"),
  status: enumOf(OPS_STATUS_VALUES, "open"),
  httpStatus: optionalInt,
  approvedBy: optionalString,
  responsiblePerson: optionalString,
});

// --- Competitor research ----------------------------------------------------

export const researchSchema = z.object({
  organisation: z.string().trim().min(1, "Organisation is required").max(160),
  website: optionalString,
  researchDate: z.coerce.date(),
  sourceUrl: optionalString,
  observation: z.string().trim().min(1, "Observation is required").max(1000),
  category: enumOf(RESEARCH_CATEGORY_VALUES, "seo"),
  evidence: optionalString,
  isAssumption: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).default(false),
  relevance: optionalString,
  effort: enumOf(RESEARCH_EFFORT_VALUES, "medium"),
  expectedBenefit: optionalString,
  measurement: optionalString,
  recommendation: enumOf(RECOMMENDATION_VALUES, "investigate"),
  status: enumOf(RESEARCH_STATUS_VALUES, "new"),
  followUpDate: optionalDate,
});

// --- Report + settings ------------------------------------------------------

export const reportSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  type: enumOf(REPORT_TYPE_VALUES, "weekly"),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  executiveSummary: optionalString,
  status: enumOf(REPORT_STATUS_VALUES, "draft"),
});

export const settingsSchema = z.object({
  siteUrl: z.string().trim().url("Enter a valid URL"),
  siteName: z.string().trim().min(1).max(120),
  ownerName: optionalString,
  ownerEmail: optionalString,
  timezone: optionalString,
  gscProperty: optionalString,
  ga4Property: optionalString,
});

/** Split a textarea of URLs (newline/comma separated) into a clean array. */
export function splitUrls(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
}
