import Link from "next/link";
import {
  CheckCircle2, Clock, AlertTriangle, MousePointerClick, Eye, Users,
  TriangleAlert, FileText, Plus, SearchCheck, ListChecks, ArrowRight,
  CalendarClock, Activity,
} from "lucide-react";
import { query, queryOne } from "@/lib/db";
import type { Task, TaskActivity, TechnicalIssue, Report } from "@/lib/models";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { DataStatusBanner } from "@/components/data-status";
import { WebsiteTrend, TaskCompletionTrend } from "./dashboard-charts";
import { getSeoWithComparison, getAnalyticsWithComparison, getTrend } from "@/lib/metrics";
import { taskScope, issueScope, demoFilter } from "@/lib/data-scope";
import { lastNDays, thisWeek, fmtDate, fmtRelative, toISODate } from "@/lib/dates";
import { eachDayLabels } from "@/lib/series";
import { formatNumber } from "@/lib/utils";
import { explain } from "@/lib/glossary";
import { SEVERITIES, PRIORITIES, REPORT_STATUSES, ISSUE_CATEGORIES, labelOf } from "@/lib/enums";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const QUICK_ACTIONS = [
  { href: "/work?new=1", label: "New task", icon: Plus },
  { href: "/issues?new=1", label: "Record issue", icon: TriangleAlert },
  { href: "/inspector", label: "Inspect a page", icon: SearchCheck },
  { href: "/reports?new=1", label: "Generate report", icon: FileText },
];

export default async function DashboardPage() {
  const range = lastNDays(28);
  const week = thisWeek();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Resolve each domain's scope up front so the Work and Issue counts below
  // reflect real records only (once any real record exists) and never mix demo
  // and real together. TaskActivity has no `isDemo` column, so it is filtered
  // through its parent task's `isDemo`.
  const [taskSc, issueSc] = await Promise.all([taskScope(), issueScope()]);
  const taskDemo = demoFilter(taskSc);
  const issueDemo = demoFilter(issueSc);

  const [
    settings, seo, ga, trend,
    completedThisWeek, inProgress, overdue,
    openIssues, criticalIssues, priorityIssues,
    upcoming, recentActivity, latestReports, recentCompleted,
  ] = await Promise.all([
    getSettings(),
    getSeoWithComparison(range),
    getAnalyticsWithComparison(range),
    getTrend(range),
    queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM `Task` WHERE `status` = ? AND `completedDate` >= ? AND `completedDate` <= ? AND `isDemo` = ?",
      ["completed", week.start, week.end, taskDemo],
    ).then((r) => Number(r?.c ?? 0)),
    queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM `Task` WHERE `status` = ? AND `isDemo` = ?",
      ["in_progress", taskDemo],
    ).then((r) => Number(r?.c ?? 0)),
    queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM `Task` WHERE `status` <> ? AND `dueDate` < ? AND `isDemo` = ?",
      ["completed", today, taskDemo],
    ).then((r) => Number(r?.c ?? 0)),
    queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM `TechnicalIssue` WHERE `status` IN (?, ?) AND `isDemo` = ?",
      ["open", "in_progress", issueDemo],
    ).then((r) => Number(r?.c ?? 0)),
    queryOne<{ c: number }>(
      "SELECT COUNT(*) AS c FROM `TechnicalIssue` WHERE `status` IN (?, ?) AND `severity` = ? AND `isDemo` = ?",
      ["open", "in_progress", "critical", issueDemo],
    ).then((r) => Number(r?.c ?? 0)),
    query<TechnicalIssue>(
      "SELECT * FROM `TechnicalIssue` WHERE `status` IN (?, ?) AND `severity` IN (?, ?) AND `isDemo` = ? ORDER BY `severity` ASC LIMIT ?",
      ["open", "in_progress", "critical", "high", issueDemo, 5],
    ),
    query<Task>(
      "SELECT * FROM `Task` WHERE `status` <> ? AND `dueDate` >= ? AND `isDemo` = ? ORDER BY `dueDate` ASC LIMIT ?",
      ["completed", today, taskDemo, 5],
    ),
    query<TaskActivity & { taskTitle: string | null }>(
      "SELECT `ta`.*, `t`.`title` AS `taskTitle` FROM `TaskActivity` `ta` " +
        "JOIN `Task` `t` ON `t`.`id` = `ta`.`taskId` " +
        "WHERE `t`.`isDemo` = ? ORDER BY `ta`.`createdAt` DESC LIMIT ?",
      [taskDemo, 6],
    ).then((rows) => rows.map((r) => ({ ...r, task: { title: r.taskTitle, id: r.taskId } }))),
    query<Report>("SELECT * FROM `Report` ORDER BY `createdAt` DESC LIMIT ?", [3]),
    query<{ completedDate: Date }>(
      "SELECT `completedDate` FROM `Task` WHERE `status` = ? AND `completedDate` IS NOT NULL AND `isDemo` = ? ORDER BY `completedDate` DESC LIMIT ?",
      ["completed", taskDemo, 200],
    ),
  ]);

  const hasData = seo.current.hasData || ga.current.hasData;
  const isDemo = seo.current.isDemo || ga.current.isDemo;
  const latestReport = latestReports[0];

  // Task completion trend (last 14 days)
  const taskRange = lastNDays(14);
  const completionMap = new Map(eachDayLabels(taskRange).map((d) => [d.iso, { date: d.short, completed: 0 }]));
  for (const t of recentCompleted) {
    if (!t.completedDate) continue;
    const iso = toISODate(t.completedDate);
    const bucket = completionMap.get(iso);
    if (bucket) bucket.completed++;
  }
  const taskTrend = [...completionMap.values()];

  return (
    <div>
      <PageHeader
        title={`Welcome back${settings.ownerName ? `, ${settings.ownerName}` : ""}`}
        description="Your work, the website's performance and what needs attention — at a glance."
        actions={
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((a) => (
              <Link key={a.href} href={a.href}>
                <Button variant="secondary" size="sm"><a.icon className="h-3.5 w-3.5" /> {a.label}</Button>
              </Link>
            ))}
          </div>
        }
      />

      <DataStatusBanner isDemo={isDemo} hasData={hasData} />

      {/* Work KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Completed this week" value={completedThisWeek} icon={CheckCircle2} tone="success" href="/work" caption="Tasks marked done this week" />
        <StatCard label="In progress" value={inProgress} icon={Clock} tone="accent" href="/work" />
        <StatCard label="Overdue" value={overdue} icon={AlertTriangle} tone={overdue > 0 ? "danger" : "accent"} href="/work" state={overdue === 0 ? "ok" : "ok"} />
        <StatCard label="Open SEO issues" value={openIssues} icon={TriangleAlert} tone={criticalIssues > 0 ? "danger" : "warning"} href="/issues" caption={`${criticalIssues} critical`} />
      </div>

      {/* Website KPIs */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Search clicks" value={formatNumber(seo.current.clicks)} icon={MousePointerClick} hint={explain("clicks")} delta={seo.delta.clicks} href="/seo" state={seo.current.hasData ? "ok" : "empty"} />
        <StatCard label="Impressions" value={formatNumber(seo.current.impressions)} icon={Eye} hint={explain("impressions")} delta={seo.delta.impressions} href="/seo" state={seo.current.hasData ? "ok" : "empty"} />
        <StatCard label="Active users" value={formatNumber(ga.current.activeUsers)} icon={Users} hint={explain("activeUsers")} delta={ga.delta.activeUsers} href="/seo" state={ga.current.hasData ? "ok" : "empty"} />
        <StatCard label="Page views" value={formatNumber(ga.current.views)} icon={Activity} hint={explain("views")} delta={ga.delta.views} href="/seo" state={ga.current.hasData ? "ok" : "empty"} />
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Website performance · last 28 days</CardTitle><Badge tone="neutral">{isDemo ? "Demo" : hasData ? "Live/Imported" : "No data"}</Badge></CardHeader>
          <CardContent>{hasData ? <WebsiteTrend data={trend} /> : <EmptyState title="No performance data" description="Connect Google or import a CSV in Settings." className="border-0" />}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Task completion · last 14 days</CardTitle></CardHeader>
          <CardContent><TaskCompletionTrend data={taskTrend} /></CardContent>
        </Card>
      </div>

      {/* Lower grid */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Priority issues */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Priority issues requiring attention</CardTitle>
            <Link href="/issues" className="text-xs text-accent hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {priorityIssues.length === 0 ? (
              <EmptyState title="No high-priority issues" description="Nothing critical or high is currently open." className="border-0" />
            ) : priorityIssues.map((i) => (
              <div key={i.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <StatusBadge options={SEVERITIES} value={i.severity} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{i.title}</p>
                  <p className="text-xs text-muted-2">{labelOf(ISSUE_CATEGORIES, i.category)}</p>
                </div>
                <Badge tone={i.approvalStatus === "approved" ? "success" : "warning"}>{i.approvalStatus === "approved" ? "Approved" : "Needs approval"}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Upcoming deadlines */}
        <Card>
          <CardHeader><CardTitle>Upcoming deadlines</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {upcoming.length === 0 ? (
              <EmptyState icon={CalendarClock} title="Nothing due" description="No upcoming task deadlines." className="border-0" />
            ) : upcoming.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 shrink-0 text-muted-2" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.title}</span>
                <StatusBadge options={PRIORITIES} value={t.priority} dot />
                <span className="shrink-0 text-xs text-muted-2">{fmtDate(t.dueDate)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent activity */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Recent work activity</CardTitle><Link href="/work" className="text-xs text-accent hover:underline">My Work</Link></CardHeader>
          <CardContent className="space-y-2">
            {recentActivity.length === 0 ? (
              <EmptyState icon={ListChecks} title="No activity yet" description="Your task activity will appear here." className="border-0" />
            ) : recentActivity.map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-sm">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="min-w-0 flex-1 truncate text-foreground">{a.message} <span className="text-muted-2">· {a.task.title}</span></span>
                <span className="shrink-0 text-xs text-muted-2">{fmtRelative(a.createdAt)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Latest reports */}
        <Card>
          <CardHeader><CardTitle>Reports</CardTitle><Link href="/reports" className="text-xs text-accent hover:underline">All</Link></CardHeader>
          <CardContent>
            {latestReport ? (
              <div className="space-y-2">
                {latestReports.map((r) => (
                  <Link key={r.id} href={`/reports/${r.id}`} className="block rounded-lg border border-border p-3 hover:bg-surface-hover">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
                      <StatusBadge options={REPORT_STATUSES} value={r.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-2">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState icon={FileText} title="No reports" description="Generate a weekly report for management." className="border-0"
                action={<Link href="/reports?new=1"><Button size="sm"><Plus className="h-4 w-4" /> Generate</Button></Link>} />
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 flex items-center justify-center gap-1 text-xs text-muted-2">
        Weekly report status: {latestReport ? <Link href={`/reports/${latestReport.id}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{latestReport.title} <ArrowRight className="h-3 w-3" /></Link> : "none generated yet"}
      </p>
    </div>
  );
}
