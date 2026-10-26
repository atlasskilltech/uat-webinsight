"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Plus,
  Search,
  List as ListIcon,
  Table2,
  KanbanSquare,
  Calendar as CalendarIcon,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  LinkIcon,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Options } from "@/components/ui/form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  TASK_STATUSES,
  PRIORITIES,
  TASK_CATEGORIES,
  labelOf,
  toneOf,
} from "@/lib/enums";
import { cn, formatDuration } from "@/lib/utils";
import { fmtDate } from "@/lib/dates";
import { TaskForm, type TaskFormValues } from "./task-form";
import { WorkLogForm } from "./work-log-form";
import { setTaskStatus, deleteTask, deleteWorkLog } from "./actions";

export interface WorkTask extends TaskFormValues {
  id: string;
  title: string;
  status: string;
  priority: string;
  category: string;
  progress: number;
  projectName?: string | null;
  projectColor?: string | null;
  completedDate?: Date | string | null;
  isDemo?: boolean;
  updatedAt?: Date | string;
}

export interface WorkLogRow {
  id: string;
  date: Date | string;
  summary: string;
  category: string;
  minutes?: number | null;
  isDemo?: boolean;
}

type View = "list" | "table" | "board" | "calendar";
type Tab = "tasks" | "log";

function isOverdue(t: WorkTask): boolean {
  if (!t.dueDate || t.status === "completed") return false;
  const due = new Date(t.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

export function WorkClient({
  tasks,
  logs,
  projects,
  initialNew,
  initialLog,
  initialTab = "tasks",
}: {
  tasks: WorkTask[];
  logs: WorkLogRow[];
  projects: { id: string; name: string }[];
  initialNew?: boolean;
  initialLog?: boolean;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [view, setView] = useState<View>("list");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [project, setProject] = useState("");
  const [sort, setSort] = useState("due");

  const [formOpen, setFormOpen] = useState(Boolean(initialNew));
  const [editing, setEditing] = useState<WorkTask | null>(null);
  const [logOpen, setLogOpen] = useState(Boolean(initialLog));
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    let list = tasks.filter((t) => {
      if (q && !`${t.title} ${t.description ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (status && t.status !== status) return false;
      if (priority && t.priority !== priority) return false;
      if (category && t.category !== category) return false;
      if (project && t.projectId !== project) return false;
      return true;
    });
    const prioRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    list = [...list].sort((a, b) => {
      if (sort === "due") {
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return ad - bd;
      }
      if (sort === "priority") return (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9);
      if (sort === "title") return a.title.localeCompare(b.title);
      return 0;
    });
    return list;
  }, [tasks, q, status, priority, category, project, sort]);

  const openEdit = (t: WorkTask) => {
    setEditing(t);
    setFormOpen(true);
  };
  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const onDelete = (id: string) => {
    if (!confirm("Delete this task? This cannot be undone.")) return;
    startTransition(() => deleteTask(id));
  };

  return (
    <div>
      {/* Tab switch */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          options={[
            { value: "tasks", label: "Tasks" },
            { value: "log", label: "Daily Work Log" },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
        <div className="flex items-center gap-2">
          {tab === "tasks" ? (
            <Button onClick={openNew} size="sm">
              <Plus className="h-4 w-4" /> New task
            </Button>
          ) : (
            <Button onClick={() => setLogOpen(true)} size="sm">
              <Plus className="h-4 w-4" /> Add work log
            </Button>
          )}
        </div>
      </div>

      {tab === "tasks" ? (
        <>
          {/* Filters */}
          <Card className="mb-4 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search tasks…"
                  className="pl-8"
                />
              </div>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
                <Options options={TASK_STATUSES} placeholder="All statuses" />
              </Select>
              <Select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-auto">
                <Options options={PRIORITIES} placeholder="All priorities" />
              </Select>
              <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
                <Options options={TASK_CATEGORIES} placeholder="All categories" />
              </Select>
              <Select value={project} onChange={(e) => setProject(e.target.value)} className="w-auto">
                <Options options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="All projects" />
              </Select>
              <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-auto">
                <Options
                  options={[
                    { value: "due", label: "Sort: Due date" },
                    { value: "priority", label: "Sort: Priority" },
                    { value: "title", label: "Sort: Title" },
                  ]}
                />
              </Select>
              <div className="ml-auto">
                <Segmented
                  size="sm"
                  options={[
                    { value: "list", label: "", icon: <ListIcon className="h-4 w-4" /> },
                    { value: "table", label: "", icon: <Table2 className="h-4 w-4" /> },
                    { value: "board", label: "", icon: <KanbanSquare className="h-4 w-4" /> },
                    { value: "calendar", label: "", icon: <CalendarIcon className="h-4 w-4" /> },
                  ]}
                  value={view}
                  onChange={(v) => setView(v as View)}
                />
              </div>
            </div>
          </Card>

          <p className="mb-3 text-xs text-muted">
            {filtered.length} of {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </p>

          {filtered.length === 0 ? (
            <EmptyState
              icon={ListIcon}
              title="No tasks match your filters"
              description={tasks.length === 0 ? "Create your first task to start tracking your work." : "Try clearing some filters."}
              action={<Button onClick={openNew} size="sm"><Plus className="h-4 w-4" /> New task</Button>}
            />
          ) : view === "list" ? (
            <ListView tasks={filtered} onEdit={openEdit} onDelete={onDelete} />
          ) : view === "table" ? (
            <TableView tasks={filtered} onEdit={openEdit} onDelete={onDelete} />
          ) : view === "board" ? (
            <BoardView tasks={filtered} onEdit={openEdit} onMove={(id, s) => startTransition(() => setTaskStatus(id, s))} pending={pending} />
          ) : (
            <CalendarView tasks={filtered} onEdit={openEdit} />
          )}
        </>
      ) : (
        <LogList logs={logs} onDelete={(id) => startTransition(() => deleteWorkLog(id))} />
      )}

      {/* Dialogs */}
      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit task" : "New task"}
        description={editing ? "Update the task details." : "Record a piece of work to track."}
        size="lg"
      >
        <TaskForm
          task={editing ?? undefined}
          projects={projects}
          onDone={() => setFormOpen(false)}
        />
      </Dialog>

      <Dialog
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Add daily work log"
        description="Record what you actually did today."
      >
        <WorkLogForm tasks={tasks.map((t) => ({ id: t.id, title: t.title }))} onDone={() => setLogOpen(false)} />
      </Dialog>
    </div>
  );
}

function TaskMeta({ t }: { t: WorkTask }) {
  const overdue = isOverdue(t);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <StatusBadge options={PRIORITIES} value={t.priority} dot />
      <Badge tone={toneOf(TASK_CATEGORIES, t.category)}>{labelOf(TASK_CATEGORIES, t.category)}</Badge>
      {t.projectName && (
        <span className="inline-flex items-center gap-1 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: t.projectColor ?? "#999" }} />
          {t.projectName}
        </span>
      )}
      {t.dueDate && (
        <span className={cn("inline-flex items-center gap-1", overdue ? "font-medium text-danger" : "text-muted")}>
          <CalendarIcon className="h-3 w-3" /> {fmtDate(t.dueDate)} {overdue && "· overdue"}
        </span>
      )}
      {t.isDemo && <DemoBadge />}
    </div>
  );
}

function RowActions({ t, onEdit, onDelete }: { t: WorkTask; onEdit: (t: WorkTask) => void; onDelete: (id: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {t.relatedUrl && (
        <Tooltip content="Open related URL">
          <a href={t.relatedUrl} target="_blank" rel="noopener noreferrer" className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
            <LinkIcon className="h-3.5 w-3.5" />
          </a>
        </Tooltip>
      )}
      <Tooltip content="Edit">
        <button onClick={() => onEdit(t)} className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <Tooltip content="Delete">
        <button onClick={() => onDelete(t.id)} className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

function ListView({ tasks, onEdit, onDelete }: { tasks: WorkTask[]; onEdit: (t: WorkTask) => void; onDelete: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <Card key={t.id} className="flex items-start gap-3 p-4" interactive>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusBadge options={TASK_STATUSES} value={t.status} />
              <h3 className="truncate text-sm font-semibold text-foreground">{t.title}</h3>
            </div>
            {t.description && <p className="mt-1 line-clamp-1 text-sm text-muted">{t.description}</p>}
            <div className="mt-2">
              <TaskMeta t={t} />
            </div>
            {t.status !== "completed" && t.progress > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-hover">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${t.progress}%` }} />
                </div>
                <span className="text-xs text-muted-2">{t.progress}%</span>
              </div>
            )}
          </div>
          <RowActions t={t} onEdit={onEdit} onDelete={onDelete} />
        </Card>
      ))}
    </div>
  );
}

function TableView({ tasks, onEdit, onDelete }: { tasks: WorkTask[]; onEdit: (t: WorkTask) => void; onDelete: (id: string) => void }) {
  return (
    <Card>
      <Table>
        <THead>
          <tr>
            <TH>Task</TH>
            <TH>Status</TH>
            <TH>Priority</TH>
            <TH>Category</TH>
            <TH>Due</TH>
            <TH>Progress</TH>
            <TH className="text-right">Actions</TH>
          </tr>
        </THead>
        <TBody>
          {tasks.map((t) => (
            <TR key={t.id}>
              <TD className="max-w-xs">
                <span className="font-medium">{t.title}</span>
                {t.projectName && <span className="block text-xs text-muted-2">{t.projectName}</span>}
              </TD>
              <TD><StatusBadge options={TASK_STATUSES} value={t.status} /></TD>
              <TD><StatusBadge options={PRIORITIES} value={t.priority} dot /></TD>
              <TD className="text-muted">{labelOf(TASK_CATEGORIES, t.category)}</TD>
              <TD className={isOverdue(t) ? "font-medium text-danger" : "text-muted"}>{fmtDate(t.dueDate)}</TD>
              <TD className="text-muted tabular-nums">{t.progress}%</TD>
              <TD>
                <div className="flex justify-end">
                  <RowActions t={t} onEdit={onEdit} onDelete={onDelete} />
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function BoardView({ tasks, onEdit, onMove, pending }: { tasks: WorkTask[]; onEdit: (t: WorkTask) => void; onMove: (id: string, status: string) => void; pending: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((col) => {
        const items = tasks.filter((t) => t.status === col.value);
        return (
          <div key={col.value} className="rounded-xl border border-border bg-surface-2 p-2">
            <div className="flex items-center justify-between px-2 py-1.5">
              <StatusBadge options={TASK_STATUSES} value={col.value} />
              <span className="text-xs text-muted-2">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.map((t) => (
                <Card key={t.id} className="p-3">
                  <button onClick={() => onEdit(t)} className="block w-full text-left">
                    <h4 className="text-sm font-medium text-foreground">{t.title}</h4>
                    <div className="mt-2"><TaskMeta t={t} /></div>
                  </button>
                  <div className="mt-2 border-t border-border pt-2">
                    <Select
                      value={t.status}
                      onChange={(e) => onMove(t.id, e.target.value)}
                      disabled={pending}
                      className="h-7 text-xs"
                      aria-label="Change status"
                    >
                      <Options options={TASK_STATUSES} />
                    </Select>
                  </div>
                </Card>
              ))}
              {items.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-2">No tasks</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CalendarView({ tasks, onEdit }: { tasks: WorkTask[]; onEdit: (t: WorkTask) => void }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay = new Map<number, WorkTask[]>();
  for (const t of tasks) {
    if (!t.dueDate) continue;
    const d = new Date(t.dueDate);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const arr = byDay.get(d.getDate()) ?? [];
      arr.push(t);
      byDay.set(d.getDate(), arr);
    }
  }

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <Card className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{firstDay.toLocaleString("en-US", { month: "long", year: "numeric" })}</h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => (
          <div key={i} className={cn("min-h-20 rounded-lg border border-border p-1", day ? "bg-surface" : "bg-transparent border-transparent")}>
            {day && (
              <>
                <span className="text-xs text-muted-2">{day}</span>
                <div className="mt-1 space-y-1">
                  {(byDay.get(day) ?? []).slice(0, 3).map((t) => (
                    <button key={t.id} onClick={() => onEdit(t)} className={cn("block w-full truncate rounded px-1 py-0.5 text-left text-[10px]", isOverdue(t) ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent-soft-foreground")} title={t.title}>
                      {t.title}
                    </button>
                  ))}
                  {(byDay.get(day)?.length ?? 0) > 3 && <span className="px-1 text-[10px] text-muted-2">+{(byDay.get(day)!.length - 3)} more</span>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function LogList({ logs, onDelete }: { logs: WorkLogRow[]; onDelete: (id: string) => void }) {
  if (logs.length === 0) {
    return <EmptyState icon={Clock} title="No work logs yet" description="Record what you did each day to build a history of your work." />;
  }
  // Group by date (yyyy-mm-dd)
  const groups = new Map<string, WorkLogRow[]>();
  for (const l of logs) {
    const key = new Date(l.date).toISOString().slice(0, 10);
    const arr = groups.get(key) ?? [];
    arr.push(l);
    groups.set(key, arr);
  }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([date, items]) => {
        const total = items.reduce((s, l) => s + (l.minutes ?? 0), 0);
        return (
          <div key={date}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{fmtDate(date, "EEEE, d MMM yyyy")}</h3>
              {total > 0 && <span className="text-xs text-muted">{formatDuration(total)} logged</span>}
            </div>
            <Card className="divide-y divide-border">
              {items.map((l) => (
                <div key={l.id} className="flex items-start gap-3 p-3">
                  <Badge tone={toneOf(TASK_CATEGORIES, l.category)}>{labelOf(TASK_CATEGORIES, l.category)}</Badge>
                  <p className="min-w-0 flex-1 text-sm text-foreground">{l.summary}</p>
                  {l.minutes ? <span className="text-xs text-muted-2">{formatDuration(l.minutes)}</span> : null}
                  {l.isDemo && <DemoBadge />}
                  <button onClick={() => { if (confirm("Delete this log?")) onDelete(l.id); }} className="rounded-md p-1 text-muted-2 hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </Card>
          </div>
        );
      })}
    </div>
  );
}
