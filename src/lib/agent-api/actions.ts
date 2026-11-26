import "server-only";
import { query, queryOne } from "@/lib/db";
import {
  getSeoWithComparison,
  getAnalyticsWithComparison,
  getTrend,
  getTopPages,
  getTopQueries,
  getLatestDataDate,
} from "@/lib/metrics";
import type {
  Task,
  TaskActivity,
  WorkLog,
  TechnicalIssue,
  PageAudit,
  AuditFinding,
  ServerAsset,
  OperationsLog,
  CompetitorResearch,
  Report,
} from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { getIntegrations } from "@/lib/integrations";
import {
  ApiError,
  type AgentUser,
  dateRange,
  enumParam,
  isoDate,
  limitParam,
  likeParam,
  todayUtc,
  addDays,
} from "./common";
import { SCOPE_MAP } from "./scopes";

/**
 * Catalogue of READ-ONLY actions this project exposes to IntelligenceOS.
 *
 * Each action declares its manifest fields (id, name, description, method,
 * path, risk, params) plus the `scope` a key must hold, and a `run` handler
 * that returns plain JSON. Handlers reuse the app's own models and metrics, so
 * the Agent API answers with exactly the numbers the dashboard shows.
 */

export type ParamIn = "path" | "query";

export interface ActionParam {
  name: string;
  in: ParamIn;
  type: "string" | "integer" | "number" | "boolean";
  required?: boolean;
  enum?: string[];
  description?: string;
}

export interface ActionContext {
  path: Record<string, string>;
  query: Record<string, string>;
  user: AgentUser | null;
}

export interface Action {
  id: string;
  name: string;
  description: string;
  method: "GET";
  path: string;
  risk: "read";
  scope: string;
  params: ActionParam[];
  run: (ctx: ActionContext) => Promise<unknown>;
}

// Shared param definitions.
const FROM_PARAM: ActionParam = { name: "from", in: "query", type: "string", description: 'Start date, YYYY-MM-DD or "today".' };
const TO_PARAM: ActionParam = { name: "to", in: "query", type: "string", description: "End date, YYYY-MM-DD. Default: today." };
const LIMIT_PARAM: ActionParam = { name: "limit", in: "query", type: "integer", description: "Max rows (default 50, max 200)." };

const TASK_STATUSES = ["not_started", "in_progress", "blocked", "done", "cancelled"] as const;
const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const ISSUE_STATUSES = ["open", "in_progress", "resolved", "closed", "wont_fix"] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

/** Round a 0–1 ratio to a percentage with one decimal. */
const pct = (r: number) => Math.round(r * 1000) / 10;

export const ACTIONS: Action[] = [
  // ─── Executive overview ──────────────────────────────────────────
  {
    id: "overview_summary",
    name: "Executive overview",
    description:
      "Top-line KPIs across the whole workspace: open/in-progress/done task counts, priority issues by severity, sites up vs down, and the most recent website-data date. Use this for 'give me an overview' or 'how are things'.",
    method: "GET",
    path: "/overview/summary",
    risk: "read",
    scope: "overview.read",
    params: [],
    run: async () => {
      const [tasks, issues, servers, latest] = await Promise.all([
        query<{ status: string; c: number }>("SELECT `status`, COUNT(*) AS c FROM `Task` GROUP BY `status`"),
        query<{ severity: string; c: number }>(
          "SELECT `severity`, COUNT(*) AS c FROM `TechnicalIssue` WHERE `status` IN ('open','in_progress') GROUP BY `severity`",
        ),
        query<{ monitorState: string | null; c: number }>(
          "SELECT `monitorState`, COUNT(*) AS c FROM `ServerAsset` WHERE `monitorEnabled` = 1 GROUP BY `monitorState`",
        ),
        getLatestDataDate(),
      ]);
      const byStatus = Object.fromEntries(tasks.map((t) => [t.status, Number(t.c)]));
      const openIssuesBySeverity = Object.fromEntries(issues.map((i) => [i.severity, Number(i.c)]));
      const monitor = Object.fromEntries(servers.map((s) => [s.monitorState ?? "unknown", Number(s.c)]));
      const dueSoon = await queryOne<{ c: number }>(
        "SELECT COUNT(*) AS c FROM `Task` WHERE `status` NOT IN ('done','cancelled') AND `dueDate` IS NOT NULL AND `dueDate` <= ?",
        [new Date(addDays(todayUtc(), 7) + "T23:59:59Z")],
      );
      return {
        tasks: {
          total: tasks.reduce((s, t) => s + Number(t.c), 0),
          byStatus,
          openOrInProgress: (byStatus.not_started ?? 0) + (byStatus.in_progress ?? 0) + (byStatus.blocked ?? 0),
          dueWithin7Days: Number(dueSoon?.c ?? 0),
        },
        openIssues: {
          total: issues.reduce((s, i) => s + Number(i.c), 0),
          bySeverity: openIssuesBySeverity,
        },
        monitoring: { byState: monitor, down: Number(monitor.down ?? 0) },
        latestWebsiteDataDate: latest ? latest.toISOString().slice(0, 10) : null,
      };
    },
  },

  // ─── Work & tasks ────────────────────────────────────────────────
  {
    id: "search_tasks",
    name: "Search tasks",
    description:
      "Tasks filtered by status, priority, category or free text, newest first. Use for 'what tasks are open', 'what is overdue', 'what is John working on'.",
    method: "GET",
    path: "/tasks",
    risk: "read",
    scope: "work.read",
    params: [
      { name: "status", in: "query", type: "string", enum: [...TASK_STATUSES], description: "Task status" },
      { name: "priority", in: "query", type: "string", enum: [...TASK_PRIORITIES], description: "Task priority" },
      { name: "search", in: "query", type: "string", description: "Part of the title, description or notes" },
      { name: "overdue", in: "query", type: "boolean", description: "true = only tasks past their due date and not done" },
      LIMIT_PARAM,
    ],
    run: async ({ query: q }) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const status = enumParam(q.status, "status", TASK_STATUSES);
      if (status) { where.push("`status` = ?"); params.push(status); }
      const priority = enumParam(q.priority, "priority", TASK_PRIORITIES);
      if (priority) { where.push("`priority` = ?"); params.push(priority); }
      const search = likeParam(q.search);
      if (search) { where.push("(`title` LIKE ? OR `description` LIKE ? OR `notes` LIKE ?)"); params.push(search, search, search); }
      if (String(q.overdue || "").toLowerCase() === "true") {
        where.push("`status` NOT IN ('done','cancelled') AND `dueDate` IS NOT NULL AND `dueDate` < NOW(3)");
      }
      const limit = limitParam(q.limit);
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = await query<Task>(
        `SELECT \`id\`, \`title\`, \`description\`, \`category\`, \`status\`, \`priority\`, \`startDate\`, \`dueDate\`, ` +
          `\`completedDate\`, \`progress\`, \`relatedUrl\`, \`blocker\`, \`nextAction\`, \`updatedAt\` FROM \`Task\` ` +
          `${clause} ORDER BY \`updatedAt\` DESC LIMIT ?`,
        [...params, limit],
      );
      return { total: rows.length, tasks: rows };
    },
  },
  {
    id: "get_task",
    name: "Get a task",
    description: "One task in full, with its activity timeline (status changes, notes, progress).",
    method: "GET",
    path: "/tasks/{id}",
    risk: "read",
    scope: "work.read",
    params: [{ name: "id", in: "path", type: "string", required: true, description: "Task id" }],
    run: async ({ path }) => {
      const task = await queryOne<Task>("SELECT * FROM `Task` WHERE `id` = ?", [path.id]);
      if (!task) throw new ApiError(404, "Task not found");
      const activity = await query<TaskActivity>(
        "SELECT `type`, `message`, `fromValue`, `toValue`, `createdAt` FROM `TaskActivity` WHERE `taskId` = ? ORDER BY `createdAt` DESC LIMIT 50",
        [path.id],
      );
      return { ...task, activity };
    },
  },
  {
    id: "work_log",
    name: "Daily work log",
    description: "Daily work-log entries over a date range (default: last 14 days), newest first, with minutes spent and category.",
    method: "GET",
    path: "/work-log",
    risk: "read",
    scope: "work.read",
    params: [{ ...FROM_PARAM, description: "Start date. Default: 13 days ago." }, TO_PARAM, LIMIT_PARAM],
    run: async ({ query: q }) => {
      const { range } = dateRange(q, { defaultDays: 14 });
      const limit = limitParam(q.limit);
      const rows = await query<WorkLog>(
        "SELECT `id`, `date`, `summary`, `category`, `minutes`, `taskId`, `createdAt` FROM `WorkLog` " +
          "WHERE `date` >= ? AND `date` <= ? ORDER BY `date` DESC, `createdAt` DESC LIMIT ?",
        [range.start, range.end, limit],
      );
      const totalMinutes = rows.reduce((s, r) => s + (r.minutes ?? 0), 0);
      return { total: rows.length, totalMinutes, entries: rows };
    },
  },

  // ─── SEO & analytics ─────────────────────────────────────────────
  {
    id: "seo_summary",
    name: "SEO & analytics summary",
    description:
      "Search Console (clicks, impressions, CTR, average position) and GA4 (views, users, sessions, engagement) for a date range, each with the change vs the previous period. Default range: last 28 days.",
    method: "GET",
    path: "/seo/summary",
    risk: "read",
    scope: "seo.read",
    params: [{ ...FROM_PARAM, description: "Start date. Default: 27 days ago." }, TO_PARAM],
    run: async ({ query: q }) => {
      const { from, to, range } = dateRange(q, { defaultDays: 28 });
      const [seo, ga] = await Promise.all([getSeoWithComparison(range), getAnalyticsWithComparison(range)]);
      return {
        range: { from, to },
        searchConsole: {
          hasData: seo.current.hasData,
          isDemo: seo.current.isDemo,
          clicks: seo.current.clicks,
          impressions: seo.current.impressions,
          ctrPercent: pct(seo.current.ctr),
          avgPosition: Math.round(seo.current.position * 10) / 10,
          changeVsPrevious: seo.delta,
        },
        analytics: {
          hasData: ga.current.hasData,
          isDemo: ga.current.isDemo,
          views: ga.current.views,
          activeUsers: ga.current.activeUsers,
          sessions: ga.current.sessions,
          engagementRatePercent: pct(ga.current.engagementRate),
          avgEngagementSeconds: Math.round(ga.current.avgEngagementSecs),
          changeVsPrevious: ga.delta,
        },
      };
    },
  },
  {
    id: "seo_trend",
    name: "SEO & analytics trend",
    description: "Day-by-day clicks, impressions, views and users over a date range (default: last 28 days), for spotting trends.",
    method: "GET",
    path: "/seo/trend",
    risk: "read",
    scope: "seo.read",
    params: [{ ...FROM_PARAM, description: "Start date. Default: 27 days ago." }, TO_PARAM],
    run: async ({ query: q }) => {
      const { from, to, range } = dateRange(q, { defaultDays: 28 });
      return { range: { from, to }, points: await getTrend(range) };
    },
  },
  {
    id: "seo_top_pages",
    name: "Top pages",
    description: "The website's top landing pages by Search Console clicks over a date range, with impressions, CTR and average position.",
    method: "GET",
    path: "/seo/top-pages",
    risk: "read",
    scope: "seo.read",
    params: [{ ...FROM_PARAM, description: "Start date. Default: 27 days ago." }, TO_PARAM, { ...LIMIT_PARAM, description: "Max rows (default 10, max 200)." }],
    run: async ({ query: q }) => {
      const { from, to, range } = dateRange(q, { defaultDays: 28 });
      const rows = await getTopPages(range, limitParam(q.limit, 10));
      return {
        range: { from, to },
        pages: rows.map((r) => ({
          url: r.page?.url ?? null,
          path: r.page?.path ?? null,
          title: r.page?.title ?? null,
          clicks: r.clicks,
          impressions: r.impressions,
          ctrPercent: pct(r.ctr),
          position: Math.round(r.position * 10) / 10,
        })),
      };
    },
  },
  {
    id: "seo_top_queries",
    name: "Top search queries",
    description: "The top Google search queries bringing the website clicks over a date range, with impressions, CTR and average position.",
    method: "GET",
    path: "/seo/top-queries",
    risk: "read",
    scope: "seo.read",
    params: [{ ...FROM_PARAM, description: "Start date. Default: 27 days ago." }, TO_PARAM, { ...LIMIT_PARAM, description: "Max rows (default 25, max 200)." }],
    run: async ({ query: q }) => {
      const { from, to, range } = dateRange(q, { defaultDays: 28 });
      const rows = await getTopQueries(range, limitParam(q.limit, 25));
      return {
        range: { from, to },
        queries: rows.map((r) => ({
          query: r.key,
          clicks: r.clicks,
          impressions: r.impressions,
          ctrPercent: pct(r.ctr),
          position: Math.round(r.position * 10) / 10,
        })),
      };
    },
  },

  // ─── Page audits (Inspector) ─────────────────────────────────────
  {
    id: "list_audits",
    name: "List page audits",
    description: "Recent Page Inspector audits, newest first: URL, HTTP status, indexability, title/meta and SEO/performance scores. Filter by URL text.",
    method: "GET",
    path: "/audits",
    risk: "read",
    scope: "inspector.read",
    params: [
      { name: "search", in: "query", type: "string", description: "Part of the audited URL" },
      LIMIT_PARAM,
    ],
    run: async ({ query: q }) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const search = likeParam(q.search);
      if (search) { where.push("`url` LIKE ?"); params.push(search); }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = await query<PageAudit>(
        "SELECT `id`, `url`, `httpStatus`, `indexable`, `title`, `metaDescription`, `h1`, `seoScore`, " +
          "`performanceScore`, `accessibilityScore`, `mobileScore`, `wordCount`, `createdAt` FROM `PageAudit` " +
          `${clause} ORDER BY \`createdAt\` DESC LIMIT ?`,
        [...params, limitParam(q.limit, 20)],
      );
      return { total: rows.length, audits: rows };
    },
  },
  {
    id: "get_audit",
    name: "Get a page audit",
    description: "One Page Inspector audit in full (headings, images/alt, links, structured data, Core Web Vitals) with its rules-based findings, marking confirmed issues vs hypotheses.",
    method: "GET",
    path: "/audits/{id}",
    risk: "read",
    scope: "inspector.read",
    params: [{ name: "id", in: "path", type: "string", required: true, description: "Audit id (from list_audits)" }],
    run: async ({ path }) => {
      const audit = await queryOne<PageAudit>("SELECT * FROM `PageAudit` WHERE `id` = ?", [path.id]);
      if (!audit) throw new ApiError(404, "Audit not found");
      const findings = await query<AuditFinding>(
        "SELECT `detected`, `evidence`, `why`, `confidence`, `recommendation`, `priority`, `status`, `isHypothesis`, `createdAt` " +
          "FROM `AuditFinding` WHERE `auditId` = ? ORDER BY FIELD(`priority`,'critical','high','medium','low'), `createdAt` DESC",
        [path.id],
      );
      return { ...audit, findings };
    },
  },

  // ─── Technical SEO issues ────────────────────────────────────────
  {
    id: "list_issues",
    name: "List technical issues",
    description: "The technical SEO issue register, filtered by status, severity or free text, newest first. Includes approval status and linked URLs.",
    method: "GET",
    path: "/issues",
    risk: "read",
    scope: "issues.read",
    params: [
      { name: "status", in: "query", type: "string", enum: [...ISSUE_STATUSES], description: "Issue status" },
      { name: "severity", in: "query", type: "string", enum: [...SEVERITIES], description: "Issue severity" },
      { name: "search", in: "query", type: "string", description: "Part of the title, evidence or impact" },
      LIMIT_PARAM,
    ],
    run: async ({ query: q }) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const status = enumParam(q.status, "status", ISSUE_STATUSES);
      if (status) { where.push("`status` = ?"); params.push(status); }
      const severity = enumParam(q.severity, "severity", SEVERITIES);
      if (severity) { where.push("`severity` = ?"); params.push(severity); }
      const search = likeParam(q.search);
      if (search) { where.push("(`title` LIKE ? OR `evidence` LIKE ? OR `impact` LIKE ?)"); params.push(search, search, search); }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = await query<TechnicalIssue>(
        "SELECT `id`, `title`, `urls`, `category`, `severity`, `priority`, `status`, `approvalStatus`, `impact`, " +
          "`recommendedFix`, `owner`, `dateDiscovered`, `dateResolved`, `updatedAt` FROM `TechnicalIssue` " +
          `${clause} ORDER BY FIELD(\`severity\`,'critical','high','medium','low'), \`updatedAt\` DESC LIMIT ?`,
        [...params, limitParam(q.limit)],
      );
      return { total: rows.length, issues: rows };
    },
  },
  {
    id: "get_issue",
    name: "Get a technical issue",
    description: "One technical SEO issue in full: evidence, source, impact, recommended fix, approval and verification.",
    method: "GET",
    path: "/issues/{id}",
    risk: "read",
    scope: "issues.read",
    params: [{ name: "id", in: "path", type: "string", required: true, description: "Issue id" }],
    run: async ({ path }) => {
      const issue = await queryOne<TechnicalIssue>("SELECT * FROM `TechnicalIssue` WHERE `id` = ?", [path.id]);
      if (!issue) throw new ApiError(404, "Issue not found");
      return issue;
    },
  },

  // ─── Backend & server ────────────────────────────────────────────
  {
    id: "list_server_assets",
    name: "Servers & assets",
    description:
      "The server/asset inventory with live monitor state (up/down/degraded), last HTTP status, response time, how long anything has been down, and SSL certificate expiry. Use for 'is the site up', 'which SSL certs expire soon'.",
    method: "GET",
    path: "/operations/assets",
    risk: "read",
    scope: "operations.read",
    params: [
      { name: "state", in: "query", type: "string", enum: ["up", "down", "degraded", "unknown"], description: "Only assets in this monitor state" },
      LIMIT_PARAM,
    ],
    run: async ({ query: q }) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const state = enumParam(q.state, "state", ["up", "down", "degraded", "unknown"]);
      if (state) { where.push("`monitorState` = ?"); params.push(state); }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = await query<ServerAsset>(
        "SELECT `id`, `type`, `name`, `provider`, `environment`, `url`, `monitorEnabled`, `monitorState`, " +
          "`lastHttpStatus`, `responseTimeMs`, `lastCheckedAt`, `downSince`, `status`, `sslExpiry`, `notes`, `updatedAt` " +
          `FROM \`ServerAsset\` ${clause} ORDER BY FIELD(\`monitorState\`,'down','degraded','unknown','up'), \`name\` ASC LIMIT ?`,
        [...params, limitParam(q.limit)],
      );
      return { total: rows.length, assets: rows };
    },
  },
  {
    id: "operations_log",
    name: "Operations log",
    description: "Operations-log entries (incidents, maintenance, investigations) over a date range (default: last 30 days), newest first.",
    method: "GET",
    path: "/operations/log",
    risk: "read",
    scope: "operations.read",
    params: [{ ...FROM_PARAM, description: "Start date. Default: 29 days ago." }, TO_PARAM, LIMIT_PARAM],
    run: async ({ query: q }) => {
      const to = isoDate(q.to, "to", todayUtc());
      const from = isoDate(q.from, "from", addDays(to, -29));
      if (from > to) throw new ApiError(400, "from must be on or before to");
      const rows = await query<OperationsLog>(
        "SELECT `id`, `occurredAt`, `system`, `title`, `kind`, `symptoms`, `investigation`, `resolution`, " +
          "`verificationStatus`, `status`, `httpStatus`, `responsiblePerson`, `createdAt` FROM `OperationsLog` " +
          "WHERE `occurredAt` >= ? AND `occurredAt` <= ? ORDER BY `occurredAt` DESC LIMIT ?",
        [new Date(from + "T00:00:00Z"), new Date(to + "T23:59:59Z"), limitParam(q.limit)],
      );
      return { total: rows.length, entries: rows };
    },
  },

  // ─── Competitor intelligence ─────────────────────────────────────
  {
    id: "list_competitors",
    name: "Competitor research",
    description:
      "Structured competitor research, newest first, keeping observations separate from assumptions. Filter by organisation or category. Includes the recommendation and expected benefit.",
    method: "GET",
    path: "/competitors",
    risk: "read",
    scope: "competitors.read",
    params: [
      { name: "organisation", in: "query", type: "string", description: "Part of the organisation / institution name" },
      { name: "search", in: "query", type: "string", description: "Part of the observation or recommendation" },
      LIMIT_PARAM,
    ],
    run: async ({ query: q }) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const org = likeParam(q.organisation);
      if (org) { where.push("`organisation` LIKE ?"); params.push(org); }
      const search = likeParam(q.search);
      if (search) { where.push("(`observation` LIKE ? OR `recommendation` LIKE ?)"); params.push(search, search); }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = await query<CompetitorResearch>(
        "SELECT `id`, `organisation`, `website`, `researchDate`, `sourceUrl`, `observation`, `category`, `evidence`, " +
          "`isAssumption`, `relevance`, `effort`, `expectedBenefit`, `recommendation`, `status`, `updatedAt` FROM `CompetitorResearch` " +
          `${clause} ORDER BY \`researchDate\` DESC, \`updatedAt\` DESC LIMIT ?`,
        [...params, limitParam(q.limit)],
      );
      return { total: rows.length, research: rows };
    },
  },

  // ─── Reports ─────────────────────────────────────────────────────
  {
    id: "list_reports",
    name: "List reports",
    description: "Generated weekly/monthly reports, newest first: title, type, period and executive summary (without the full snapshot).",
    method: "GET",
    path: "/reports",
    risk: "read",
    scope: "reports.read",
    params: [
      { name: "type", in: "query", type: "string", enum: ["weekly", "monthly", "custom"], description: "Report type" },
      LIMIT_PARAM,
    ],
    run: async ({ query: q }) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const type = enumParam(q.type, "type", ["weekly", "monthly", "custom"]);
      if (type) { where.push("`type` = ?"); params.push(type); }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = await query<Report>(
        "SELECT `id`, `title`, `type`, `periodStart`, `periodEnd`, `comparePeriodStart`, `comparePeriodEnd`, " +
          "`executiveSummary`, `status`, `createdAt`, `updatedAt` FROM `Report` " +
          `${clause} ORDER BY \`periodEnd\` DESC, \`createdAt\` DESC LIMIT ?`,
        [...params, limitParam(q.limit, 20)],
      );
      return { total: rows.length, reports: rows };
    },
  },
  {
    id: "get_report",
    name: "Get a report",
    description: "One report in full, including its stored data snapshot (the figures captured when it was generated).",
    method: "GET",
    path: "/reports/{id}",
    risk: "read",
    scope: "reports.read",
    params: [{ name: "id", in: "path", type: "string", required: true, description: "Report id (from list_reports)" }],
    run: async ({ path }) => {
      const report = await queryOne<Report>("SELECT * FROM `Report` WHERE `id` = ?", [path.id]);
      if (!report) throw new ApiError(404, "Report not found");
      return report;
    },
  },

  // ─── Site & integrations ─────────────────────────────────────────
  {
    id: "site_overview",
    name: "Site & integrations",
    description:
      "The website property this workspace tracks (URL, name, timezone, GSC/GA4 property ids) and which Google integrations are connected and when they last synced. No secrets or tokens.",
    method: "GET",
    path: "/site/overview",
    risk: "read",
    scope: "settings.read",
    params: [],
    run: async () => {
      const [settings, integrations] = await Promise.all([getSettings(), getIntegrations()]);
      return {
        site: {
          url: settings.siteUrl,
          name: settings.siteName,
          owner: settings.ownerName,
          timezone: settings.timezone,
          gscProperty: settings.gscProperty,
          ga4Property: settings.ga4Property,
        },
        integrations: integrations.map((i) => ({
          provider: i.provider,
          status: i.status,
          connected: i.status === "connected",
          propertyId: i.propertyId,
          lastSyncAt: i.lastSyncAt,
          lastError: i.lastError,
        })),
      };
    },
  },
];

// ─── Access + manifest helpers ───────────────────────────────────

/**
 * Whether a delegated user may use the read actions at all. All actions here
 * are full-workspace reads, so an Invoice-Agent-only user (or an unknown /
 * inactive one) is refused; any active full-access user is allowed.
 */
export function userCanRead(user: AgentUser | null): boolean {
  if (!user) return true; // key-only call (the admin connecting)
  return user.accessScope === "full";
}

/** The actions a key's scopes allow, narrowed to the acting user when delegated. */
export function allowedActions(keyScopes: string[], user: AgentUser | null = null): Action[] {
  const scopes = new Set((keyScopes || []).filter((s) => SCOPE_MAP[s]));
  if (user && !userCanRead(user)) return [];
  return ACTIONS.filter((a) => scopes.has(a.scope));
}

/** The public (manifest) view of an action — everything except the handler and scope. */
export function publicAction(a: Action): Omit<Action, "run" | "scope"> {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    method: a.method,
    path: a.path,
    risk: a.risk,
    params: a.params,
  };
}
