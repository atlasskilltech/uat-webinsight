"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  LinkIcon,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Options } from "@/components/ui/form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { DemoBadge } from "@/components/ui/demo-badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  ISSUE_CATEGORIES,
  SEVERITIES,
  ISSUE_STATUSES,
  APPROVAL_STATUSES,
  labelOf,
  toneOf,
} from "@/lib/enums";
import { fmtDate } from "@/lib/dates";
import { IssueForm, type IssueFormValues } from "./issue-form";
import { setIssueStatus, deleteIssue } from "./actions";

export interface IssueRow extends IssueFormValues {
  id: string;
  title: string;
  category: string;
  severity: string;
  priority: string;
  status: string;
  approvalStatus: string;
  urlList: string[];
  isDemo?: boolean;
  createdAt?: Date | string;
}

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function IssuesClient({
  issues,
  initialNew,
}: {
  issues: IssueRow[];
  initialNew?: boolean;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [formOpen, setFormOpen] = useState(Boolean(initialNew));
  const [editing, setEditing] = useState<IssueRow | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const list = issues.filter((i) => {
      if (q && !`${i.title} ${i.urlList.join(" ")} ${i.evidence ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (category && i.category !== category) return false;
      if (severity && i.severity !== severity) return false;
      if (status && i.status !== status) return false;
      return true;
    });
    return [...list].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
  }, [issues, q, category, severity, status]);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (i: IssueRow) => {
    setEditing(i);
    setFormOpen(true);
  };
  const onDelete = (id: string) => {
    if (!confirm("Delete this issue? This cannot be undone.")) return;
    startTransition(() => deleteIssue(id));
  };

  return (
    <div>
      {/* Filters */}
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issues…" className="pl-8" />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
            <Options options={ISSUE_CATEGORIES} placeholder="All categories" />
          </Select>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-auto">
            <Options options={SEVERITIES} placeholder="All severities" />
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <Options options={ISSUE_STATUSES} placeholder="All statuses" />
          </Select>
          <Button onClick={openNew} size="sm" className="ml-auto">
            <Plus className="h-4 w-4" /> New issue
          </Button>
        </div>
      </Card>

      <p className="mb-3 text-xs text-muted">
        {filtered.length} of {issues.length} issue{issues.length === 1 ? "" : "s"} · recommendations only — fixes are reviewed and implemented separately.
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={TriangleAlert}
          title="No issues match your filters"
          description={
            issues.length === 0
              ? "Record a technical issue found during an audit. Issues are recommendations to review — the app never edits the live website."
              : "Try clearing some filters."
          }
          action={<Button onClick={openNew} size="sm"><Plus className="h-4 w-4" /> New issue</Button>}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((i) => (
            <Card key={i.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge options={SEVERITIES} value={i.severity} dot />
                    <h3 className="text-sm font-semibold text-foreground">{i.title}</h3>
                    {i.isDemo && <DemoBadge />}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={toneOf(ISSUE_CATEGORIES, i.category)}>{labelOf(ISSUE_CATEGORIES, i.category)}</Badge>
                    <StatusBadge options={ISSUE_STATUSES} value={i.status} />
                    <StatusBadge options={APPROVAL_STATUSES} value={i.approvalStatus} />
                    {i.owner && <span className="text-muted">Owner: {i.owner}</span>}
                    <span className="text-muted-2">Found {fmtDate(i.createdAt)}</span>
                  </div>

                  {i.urlList.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {i.urlList.map((u) => (
                        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                          <LinkIcon className="h-3 w-3" />
                          <span className="max-w-xs truncate">{u}</span>
                        </a>
                      ))}
                    </div>
                  )}

                  {i.evidence && (
                    <p className="mt-2 text-sm text-muted">
                      <span className="font-medium text-foreground">Evidence: </span>
                      {i.evidence}
                    </p>
                  )}
                  {i.recommendedFix && (
                    <p className="mt-1 text-sm text-muted">
                      <span className="font-medium text-foreground">Recommended fix: </span>
                      {i.recommendedFix}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="flex items-center gap-1">
                    <Tooltip content="Edit">
                      <button onClick={() => openEdit(i)} className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                    <Tooltip content="Delete">
                      <button onClick={() => onDelete(i.id)} className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                  <Select
                    value={i.status}
                    onChange={(e) => startTransition(() => setIssueStatus(i.id, e.target.value))}
                    disabled={pending}
                    className="h-7 w-auto text-xs"
                    aria-label="Change status"
                  >
                    <Options options={ISSUE_STATUSES} />
                  </Select>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit issue" : "Record technical issue"}
        description={editing ? "Update the issue details." : "Log a technical issue found during an audit. This is a recommendation to review — not a change to the live site."}
        size="lg"
      >
        <IssueForm issue={editing ?? undefined} onDone={() => setFormOpen(false)} />
      </Dialog>
    </div>
  );
}
