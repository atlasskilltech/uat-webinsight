/**
 * Row types for every table, replacing Prisma's generated model types.
 * Shapes mirror db/schema.sql: DATETIME -> Date, INTEGER/DOUBLE -> number,
 * BOOLEAN -> boolean (mysql2 is configured to cast TINYINT(1) to boolean),
 * JSON -> the parsed value. Nullable columns are `| null`.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Project {
  id: string;
  name: string;
  description: string | null;
  color: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  priority: string;
  startDate: Date | null;
  dueDate: Date | null;
  completedDate: Date | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  progress: number;
  relatedUrl: string | null;
  notes: string | null;
  evidenceLinks: string[] | null;
  completionSummary: string | null;
  blocker: string | null;
  nextAction: string | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
  projectId: string | null;
  issueId: string | null;
}

export interface TaskActivity {
  id: string;
  taskId: string;
  type: string;
  message: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
}

export interface WorkLog {
  id: string;
  date: Date;
  summary: string;
  category: string;
  minutes: number | null;
  taskId: string | null;
  isDemo: boolean;
  createdAt: Date;
}

export interface WebsitePage {
  id: string;
  url: string;
  path: string;
  title: string | null;
  section: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeoSnapshot {
  id: string;
  propertyId: string;
  source: string;
  startDate: Date;
  endDate: Date;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  query: string | null;
  device: string | null;
  country: string | null;
  isDemo: boolean;
  importBatchId: string | null;
  importedAt: Date;
  pageId: string | null;
}

export interface AnalyticsSnapshot {
  id: string;
  propertyId: string;
  source: string;
  startDate: Date;
  endDate: Date;
  views: number;
  activeUsers: number;
  sessions: number;
  engagedSessions: number;
  engagementRate: number;
  avgEngagementSecs: number;
  channel: string | null;
  isDemo: boolean;
  importBatchId: string | null;
  importedAt: Date;
  pageId: string | null;
}

export interface HeadingNode {
  level: number;
  text: string;
}

export interface RedirectHop {
  from: string;
  to: string;
  status: number;
}

export interface PageAudit {
  id: string;
  url: string;
  pageId: string | null;
  httpStatus: number | null;
  indexable: string | null;
  robots: string | null;
  canonical: string | null;
  title: string | null;
  titleLength: number | null;
  metaDescription: string | null;
  metaDescLength: number | null;
  h1: string | null;
  headingStructure: HeadingNode[] | null;
  imagesTotal: number | null;
  imagesMissingAlt: number | null;
  internalLinks: number | null;
  externalLinks: number | null;
  brokenLinks: string[] | null;
  redirects: RedirectHop[] | null;
  structuredData: string[] | null;
  wordCount: number | null;
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  mobileScore: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  fetchedHtml: boolean;
  psiFetched: boolean;
  notes: string | null;
  rawJson: JsonValue | null;
  createdAt: Date;
}

export interface AuditFinding {
  id: string;
  auditId: string;
  detected: string;
  evidence: string | null;
  why: string | null;
  confidence: string;
  recommendation: string | null;
  priority: string;
  owner: string | null;
  status: string;
  verificationSteps: string | null;
  isHypothesis: boolean;
  createdAt: Date;
}

export interface TechnicalIssue {
  id: string;
  title: string;
  urls: string[] | null;
  category: string;
  evidence: string | null;
  source: string | null;
  severity: string;
  priority: string;
  impact: string | null;
  recommendedFix: string | null;
  status: string;
  dateDiscovered: Date;
  owner: string | null;
  approvalStatus: string;
  implementationNotes: string | null;
  verificationResult: string | null;
  dateResolved: Date | null;
  pageId: string | null;
  auditId: string | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServerAsset {
  id: string;
  type: string;
  name: string;
  provider: string | null;
  plan: string | null;
  environment: string | null;
  version: string | null;
  url: string | null;
  status: string;
  sslExpiry: Date | null;
  details: JsonValue | null;
  notes: string | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationsLog {
  id: string;
  occurredAt: Date;
  system: string;
  title: string;
  kind: string;
  symptoms: string | null;
  investigation: string | null;
  resolution: string | null;
  verificationStatus: string;
  status: string;
  httpStatus: number | null;
  approvedBy: string | null;
  responsiblePerson: string | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompetitorResearch {
  id: string;
  organisation: string;
  website: string | null;
  researchDate: Date;
  sourceUrl: string | null;
  observation: string;
  category: string;
  evidence: string | null;
  isAssumption: boolean;
  relevance: string | null;
  effort: string;
  expectedBenefit: string | null;
  measurement: string | null;
  recommendation: string;
  status: string;
  followUpDate: Date | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Report {
  id: string;
  title: string;
  type: string;
  periodStart: Date;
  periodEnd: Date;
  comparePeriodStart: Date | null;
  comparePeriodEnd: Date | null;
  executiveSummary: string | null;
  status: string;
  snapshot: JsonValue | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Integration {
  id: string;
  provider: string;
  status: string;
  propertyId: string | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  config: JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImportBatch {
  id: string;
  source: string;
  fileName: string | null;
  rowCount: number;
  skippedRows: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  propertyId: string | null;
  status: string;
  message: string | null;
  isDemo: boolean;
  createdAt: Date;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  passwordHash: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface AuthToken {
  id: string;
  userId: string;
  type: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface AdminAuditLog {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetUserId: string | null;
  targetEmail: string | null;
  metadata: JsonValue | null;
  createdAt: Date;
}

export interface AppSettings {
  id: string;
  siteUrl: string;
  siteName: string;
  ownerName: string;
  ownerEmail: string;
  timezone: string;
  gscProperty: string;
  ga4Property: string;
  updatedAt: Date;
}
