import "server-only";
import { prisma } from "./prisma";
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
    completedTasks, inProgressTasks, blockedTasks, overdueCount, logs,
    seo, analytics, topPages,
    discoveredIssues, verifiedIssues, openIssues,
    ops, competitors,
  ] = await Promise.all([
    prisma.task.findMany({ where: { status: "completed", completedDate: { gte: range.start, lte: range.end }, isDemo: taskDemo }, orderBy: { completedDate: "desc" } }),
    prisma.task.findMany({ where: { status: "in_progress", isDemo: taskDemo }, orderBy: { priority: "asc" } }),
    prisma.task.findMany({ where: { status: "blocked", isDemo: taskDemo } }),
    prisma.task.count({ where: { status: { not: "completed" }, dueDate: { lt: new Date() }, isDemo: taskDemo } }),
    prisma.workLog.findMany({ where: { date: { gte: range.start, lte: range.end }, isDemo: logDemo }, orderBy: { date: "desc" } }),
    getSeoWithComparison(range),
    getAnalyticsWithComparison(range),
    getTopPages(range, 6),
    prisma.technicalIssue.findMany({ where: { dateDiscovered: { gte: range.start, lte: range.end }, isDemo: issueDemo } }),
    prisma.technicalIssue.findMany({ where: { status: "verified", dateResolved: { gte: range.start, lte: range.end }, isDemo: issueDemo } }),
    prisma.technicalIssue.findMany({ where: { status: { in: ["open", "in_progress"] }, severity: { in: ["critical", "high"] }, isDemo: issueDemo }, orderBy: { severity: "asc" } }),
    prisma.operationsLog.findMany({ where: { occurredAt: { gte: range.start, lte: range.end }, isDemo: opsDemo }, orderBy: { occurredAt: "desc" } }),
    prisma.competitorResearch.findMany({ where: { researchDate: { gte: range.start, lte: range.end }, isDemo: compDemo }, orderBy: { researchDate: "desc" } }),
  ]);

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
