import type { Metadata } from "next";
import { CheckCircle2, Clock, AlertTriangle, CircleDashed, FlaskConical } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { WorkClient, type WorkTask, type WorkLogRow } from "./work-client";
import { thisWeek } from "@/lib/dates";
import { taskScope, demoFilter } from "@/lib/data-scope";

export const metadata: Metadata = { title: "My Work" };
export const dynamic = "force-dynamic";

function StatChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Clock;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tone}`}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div>
        <p className="text-lg font-semibold leading-none tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted">{label}</p>
      </div>
    </div>
  );
}

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; log?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const [tasksRaw, projects, logsRaw] = await Promise.all([
    prisma.task.findMany({
      include: { project: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.project.findMany({ where: { archived: false }, orderBy: { name: "asc" } }),
    prisma.workLog.findMany({ orderBy: { date: "desc" }, take: 100 }),
  ]);

  const tasks: WorkTask[] = tasksRaw.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    category: t.category,
    progress: t.progress,
    projectId: t.projectId,
    projectName: t.project?.name,
    projectColor: t.project?.color,
    startDate: t.startDate,
    dueDate: t.dueDate,
    completedDate: t.completedDate,
    estimatedMinutes: t.estimatedMinutes,
    actualMinutes: t.actualMinutes,
    relatedUrl: t.relatedUrl,
    blocker: t.blocker,
    nextAction: t.nextAction,
    notes: t.notes,
    completionSummary: t.completionSummary,
    isDemo: t.isDemo,
    updatedAt: t.updatedAt,
  }));

  const logs: WorkLogRow[] = logsRaw.map((l) => ({
    id: l.id,
    date: l.date,
    summary: l.summary,
    category: l.category,
    minutes: l.minutes,
    isDemo: l.isDemo,
  }));

  // The list below shows every task, but the summary counts reflect only the
  // active data scope: real tasks once any exist, otherwise the seeded demo
  // tasks. This keeps the counts consistent with the dashboard and never mixes
  // demo and real together. `scopedTasks` is the subset the counts are built
  // from; the full `tasksRaw`/`tasks` list is still rendered below.
  const taskSc = await taskScope();
  const scopedTasks = tasksRaw.filter((t) => t.isDemo === demoFilter(taskSc));

  const week = thisWeek();
  const completedThisWeek = scopedTasks.filter(
    (t) => t.status === "completed" && t.completedDate && t.completedDate >= week.start && t.completedDate <= week.end,
  ).length;
  const inProgress = scopedTasks.filter((t) => t.status === "in_progress").length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = scopedTasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== "completed").length;
  const notStarted = scopedTasks.filter((t) => t.status === "not_started").length;
  const demoTaskCount = tasksRaw.filter((t) => t.isDemo).length;
  const realTaskCount = tasksRaw.length - demoTaskCount;

  return (
    <div>
      <PageHeader
        title="My Work"
        description="Record and manage every piece of professional work — tasks, daily logs and progress."
      />

      <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatChip icon={CheckCircle2} label="Completed this week" value={completedThisWeek} tone="bg-success-soft text-success" />
        <StatChip icon={Clock} label="In progress" value={inProgress} tone="bg-info-soft text-info" />
        <StatChip icon={AlertTriangle} label="Overdue" value={overdue} tone="bg-danger-soft text-danger" />
        <StatChip icon={CircleDashed} label="Not started" value={notStarted} tone="bg-surface-2 text-muted" />
      </div>
      {taskSc === "real" && demoTaskCount > 0 && (
        <p className="mb-6 flex items-center gap-1.5 text-xs text-muted-2">
          <FlaskConical className="h-3.5 w-3.5 text-warning" />
          Summary counts reflect your {realTaskCount} real task{realTaskCount === 1 ? "" : "s"} only. The list below also includes {demoTaskCount} seeded demo task{demoTaskCount === 1 ? "" : "s"} (tagged “Demo data”), which are excluded from these counts.
        </p>
      )}
      {taskSc === "demo" && (
        <p className="mb-6 flex items-center gap-1.5 text-xs text-muted-2">
          <FlaskConical className="h-3.5 w-3.5 text-warning" />
          Summary counts reflect {demoTaskCount} seeded demo task{demoTaskCount === 1 ? "" : "s"} — no real tasks yet. Add a task, or remove demo data in Settings.
        </p>
      )}
      {taskSc === "real" && demoTaskCount === 0 && <div className="mb-6" />}

      <WorkClient
        tasks={tasks}
        logs={logs}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        initialNew={sp.new === "1"}
        initialLog={sp.log === "1"}
        initialTab={sp.tab === "log" ? "log" : "tasks"}
      />
    </div>
  );
}
