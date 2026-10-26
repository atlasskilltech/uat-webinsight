"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  ExternalLink,
  Eye,
  CircleHelp,
  Telescope,
  CalendarClock,
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
  RESEARCH_CATEGORIES,
  RESEARCH_EFFORT,
  RECOMMENDATIONS,
  RESEARCH_STATUSES,
  labelOf,
  toneOf,
} from "@/lib/enums";
import { fmtDate } from "@/lib/dates";
import { ResearchForm, type ResearchFormValues } from "./research-form";
import { deleteResearch, setResearchStatus } from "./actions";

export interface ResearchRow extends ResearchFormValues {
  id: string;
  organisation: string;
  observation: string;
  category: string;
  effort: string;
  recommendation: string;
  status: string;
  isAssumption: boolean;
  isDemo?: boolean;
}

export function CompetitorsClient({
  entries,
  initialNew,
}: {
  entries: ResearchRow[];
  initialNew?: boolean;
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [status, setStatus] = useState("");

  const [formOpen, setFormOpen] = useState(Boolean(initialNew));
  const [editing, setEditing] = useState<ResearchRow | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (q && !`${e.organisation} ${e.observation} ${e.relevance ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (category && e.category !== category) return false;
      if (recommendation && e.recommendation !== recommendation) return false;
      if (status && e.status !== status) return false;
      return true;
    });
  }, [entries, q, category, recommendation, status]);

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (e: ResearchRow) => {
    setEditing(e);
    setFormOpen(true);
  };
  const onDelete = (id: string) => {
    if (!confirm("Delete this research entry? This cannot be undone.")) return;
    startTransition(() => deleteResearch(id));
  };

  return (
    <div>
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search organisations and observations…" className="pl-8" />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
            <Options options={RESEARCH_CATEGORIES} placeholder="All categories" />
          </Select>
          <Select value={recommendation} onChange={(e) => setRecommendation(e.target.value)} className="w-auto">
            <Options options={RECOMMENDATIONS} placeholder="All recommendations" />
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <Options options={RESEARCH_STATUSES} placeholder="All statuses" />
          </Select>
          <div className="ml-auto">
            <Button onClick={openNew} size="sm">
              <Plus className="h-4 w-4" /> New research
            </Button>
          </div>
        </div>
      </Card>

      <p className="mb-3 text-xs text-muted">
        {filtered.length} of {entries.length} entr{entries.length === 1 ? "y" : "ies"}
      </p>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Telescope}
          title={entries.length === 0 ? "No research logged yet" : "No entries match your filters"}
          description={
            entries.length === 0
              ? "Record what other institutions do well — keep public observations separate from your own assumptions."
              : "Try clearing some filters."
          }
          action={<Button onClick={openNew} size="sm"><Plus className="h-4 w-4" /> New research</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((e) => (
            <Card key={e.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{e.organisation}</h3>
                  {e.website && (
                    <a href={e.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
                      {e.website.replace(/^https?:\/\//, "")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <StatusBadge options={RECOMMENDATIONS} value={e.recommendation} />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {e.isAssumption ? (
                  <Badge tone="warning"><CircleHelp className="h-3 w-3" /> Assumption</Badge>
                ) : (
                  <Badge tone="success"><Eye className="h-3 w-3" /> Observed</Badge>
                )}
                <Badge tone={toneOf(RESEARCH_CATEGORIES, e.category)}>{labelOf(RESEARCH_CATEGORIES, e.category)}</Badge>
                <Badge tone={toneOf(RESEARCH_EFFORT, e.effort)}>{labelOf(RESEARCH_EFFORT, e.effort)}</Badge>
                {e.isDemo && <DemoBadge />}
              </div>

              <p className="mt-3 text-sm text-foreground">{e.observation}</p>
              {e.relevance && (
                <p className="mt-2 text-xs text-muted">
                  <span className="font-medium text-muted-2">Relevance: </span>
                  {e.relevance}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-2">
                <span>{fmtDate(e.researchDate)}</span>
                {e.followUpDate && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" /> Follow up {fmtDate(e.followUpDate)}
                  </span>
                )}
                {e.sourceUrl && (
                  <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                <Select
                  value={e.status}
                  onChange={(ev) => startTransition(() => setResearchStatus(e.id, ev.target.value))}
                  className="h-7 w-auto text-xs"
                  aria-label="Change status"
                >
                  <Options options={RESEARCH_STATUSES} />
                </Select>
                <div className="flex items-center gap-1">
                  <Tooltip content="Edit">
                    <button onClick={() => openEdit(e)} className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Delete">
                    <button onClick={() => onDelete(e.id)} className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit research entry" : "New research entry"}
        description={editing ? "Update this competitor observation." : "Log a public observation about another institution."}
        size="lg"
      >
        <ResearchForm entry={editing ?? undefined} onDone={() => setFormOpen(false)} />
      </Dialog>
    </div>
  );
}
