import "server-only";
import { query, queryOne } from "./db";
import type { Task, WorkLog, TechnicalIssue, OperationsLog, CompetitorResearch } from "./models";
import { type DateRange, previousPeriod, toISODate } from "./dates";
import { getSeoWithComparison, getAnalyticsWithComparison, getTopPages } from "./metrics";
import {
  taskScope,
  workLogScope,
  issueScope,
  operationsScope,
  competitorScope,
  demoFilter,
} from "./data-scope";

export interface ReportData {
  period: { start: string; end: string; compareStart: string; compareEnd: string };
  work: {
    completed: { title: string; category: string; completionSummary: string | null; completedDate: string | null }[];
    inProgress: { title: string; category: string; progress: number; nextAction: string | null }[];
    blocked: { title: string; blocker: string | null }[];
    counts: { completed: number; inProgress: number; blocked: number; overdue: number };
    logs: { date: string; summary: string; category: string }[];
  };
  seo: Awaited<ReturnType<typeof getSeoWithComparison>>;
  analytics: Awaited<ReturnType<typeof getAnalyticsWithComparison>>;
  topPages: { title: string; path: string; clicks: number; impressions: number; ctr: number }[];
  issues: {
    discovered: { title: string; severity: string; category: string }[];
    verifiedFixes: { title: string; verificationResult: string | null }[];
    openPriority: { title: string; severity: string; status: string; approvalStatus: string }[];
  };
  operations: { occurredAt: string; system: string; title: string; kind: string; status: string }[];
  competitors: { organisation: string; observation: string; recommendation: string; category: string }[];
}

export async function buildReportData(range: DateRange): Promise<ReportData> {
  const prev = previousPeriod(range);

  // Resolve each domain's scope once so the snapshot contains real-only data
  // once that domain has real records, and never mixes demo with real. (SEO/GA
  // metrics are scoped inside the metrics helpers.) Every table queried here
  // has an `isDemo` column in the Prisma schema; TaskActivity, which does not,
  // is not read by this report.
  const [taskSc, logSc, issueSc, opsSc, compSc] = await Promise.all([
    taskScope(), workLogScope(), issueScope(), operationsScope(), competitorScope(),
  ]);
  const taskDemo = demoFilter(taskSc);
  const logDemo = demoFilter(logSc);
  const issueDemo = demoFilter(issueSc);
  const opsDemo = demoFilter(opsSc);
  const compDemo = demoFilter(compSc);

  const [
    completedTasks, inProgressTasks, blockedTasks, overdueRow, logs,
    seo, analytics, topPages,
    discoveredIssues, verifiedIssues, openIssues,
    ops, competitors,
  ] = await Promise.all([
    query<Task>("SELECT * FROM `Task` WHERE `status`='completed' AND `completedDate` >= ? AND `completedDate` <= ? AND `isDemo`=? ORDER BY `completedDate` DESC", [range.start, range.end, taskDemo]),
    query<Task>("SELECT * FROM `Task` WHERE `status`='in_progress' AND `isDemo`=? ORDER BY `priority` ASC", [taskDemo]),
    query<Task>("SELECT * FROM `Task` WHERE `status`='blocked' AND `isDemo`=?", [taskDemo]),
    queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM `Task` WHERE `status`<>'completed' AND `dueDate` < ? AND `isDemo`=?", [new Date(), taskDemo]),
    query<WorkLog>("SELECT * FROM `WorkLog` WHERE `date` >= ? AND `date` <= ? AND `isDemo`=? ORDER BY `date` DESC", [range.start, range.end, logDemo]),
    getSeoWithComparison(range),
    getAnalyticsWithComparison(range),
    getTopPages(range, 6),
    query<TechnicalIssue>("SELECT * FROM `TechnicalIssue` WHERE `dateDiscovered` >= ? AND `dateDiscovered` <= ? AND `isDemo`=?", [range.start, range.end, issueDemo]),
    query<TechnicalIssue>("SELECT * FROM `TechnicalIssue` WHERE `status`='verified' AND `dateResolved` >= ? AND `dateResolved` <= ? AND `isDemo`=?", [range.start, range.end, issueDemo]),
    query<TechnicalIssue>("SELECT * FROM `TechnicalIssue` WHERE `status` IN ('open','in_progress') AND `severity` IN ('critical','high') AND `isDemo`=? ORDER BY `severity` ASC", [issueDemo]),
    query<OperationsLog>("SELECT * FROM `OperationsLog` WHERE `occurredAt` >= ? AND `occurredAt` <= ? AND `isDemo`=? ORDER BY `occurredAt` DESC", [range.start, range.end, opsDemo]),
    query<CompetitorResearch>("SELECT * FROM `CompetitorResearch` WHERE `researchDate` >= ? AND `researchDate` <= ? AND `isDemo`=? ORDER BY `researchDate` DESC", [range.start, range.end, compDemo]),
  ]);
  const overdueCount = Number(overdueRow?.c ?? 0);

  return {
    period: {
      start: toISODate(range.start), end: toISODate(range.end),
      compareStart: toISODate(prev.start), compareEnd: toISODate(prev.end),
    },
    work: {
      completed: completedTasks.map((t) => ({ title: t.title, category: t.category, completionSummary: t.completionSummary, completedDate: t.completedDate ? toISODate(t.completedDate) : null })),
      inProgress: inProgressTasks.map((t) => ({ title: t.title, category: t.category, progress: t.progress, nextAction: t.nextAction })),
      blocked: blockedTasks.map((t) => ({ title: t.title, blocker: t.blocker })),
      counts: { completed: completedTasks.length, inProgress: inProgressTasks.length, blocked: blockedTasks.length, overdue: overdueCount },
      logs: logs.map((l) => ({ date: toISODate(l.date), summary: l.summary, category: l.category })),
    },
    seo,
    analytics,
    topPages: topPages.map((p) => ({ title: p.page?.title ?? "Unknown", path: p.page?.path ?? "", clicks: p.clicks, impressions: p.impressions, ctr: p.ctr })),
    issues: {
      discovered: discoveredIssues.map((i) => ({ title: i.title, severity: i.severity, category: i.category })),
      verifiedFixes: verifiedIssues.map((i) => ({ title: i.title, verificationResult: i.verificationResult })),
      openPriority: openIssues.map((i) => ({ title: i.title, severity: i.severity, status: i.status, approvalStatus: i.approvalStatus })),
    },
    operations: ops.map((o) => ({ occurredAt: toISODate(o.occurredAt), system: o.system, title: o.title, kind: o.kind, status: o.status })),
    competitors: competitors.map((c) => ({ organisation: c.organisation, observation: c.observation, recommendation: c.recommendation, category: c.category })),
  };
}
