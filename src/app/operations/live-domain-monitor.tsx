"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Globe, Plus, RefreshCw, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { fmtRelative } from "@/lib/dates";
import { idleState } from "@/lib/form-state";
import { addMonitoredDomain, checkMonitoredDomainsAction, deleteServerAsset } from "./actions";
import type { DomainStatusRow } from "@/lib/domain-monitor";

const REFRESH_MS = 10_000;
type Filter = "all" | "up" | "down";

function stateTone(state?: string | null): { tone: "success" | "danger" | "warning" | "neutral"; label: string } {
  switch (state) {
    case "up": return { tone: "success", label: "Up" };
    case "down": return { tone: "danger", label: "Down" };
    case "degraded": return { tone: "warning", label: "Degraded" };
    default: return { tone: "neutral", label: "Checking…" };
  }
}

function hostHref(url: string | null, name: string): string {
  const v = url || name;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

/**
 * Live domain monitor for the Server Inventory. Add a domain/URL and it is
 * health-checked automatically; the whole list auto-refreshes every 30 seconds
 * so up/down status stays current without a page reload.
 */
export function LiveDomainMonitor({ initial }: { initial: DomainStatusRow[] }) {
  const [rows, setRows] = useState<DomainStatusRow[]>(initial);
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();
  const mounted = useRef(true);

  const poll = async () => {
    setRefreshing(true);
    try {
      const next = await checkMonitoredDomainsAction();
      if (mounted.current) {
        setRows(next);
        setUpdatedAt(Date.now());
      }
    } catch {
      /* transient — keep showing the last known state */
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  // Refresh on mount, then every 30 seconds while the page is open.
  useEffect(() => {
    mounted.current = true;
    void poll();
    const timer = setInterval(() => void poll(), REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);

  const onAdd = () => {
    const value = input.trim();
    if (!value) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("domain", value);
      const res = await addMonitoredDomain(idleState, fd);
      if (res.status === "error") {
        toast(res.message ?? "Could not add that domain.", "error");
        return;
      }
      toast(res.message ?? "Domain added.");
      setInput("");
      await poll();
    });
  };

  const onRemove = (id: string, name: string) => {
    if (!confirm(`Stop monitoring ${name}?`)) return;
    startTransition(async () => {
      await deleteServerAsset(id);
      if (mounted.current) setRows((r) => r.filter((x) => x.id !== id));
    });
  };

  const upCount = rows.filter((r) => r.monitorState === "up").length;
  const downCount = rows.filter((r) => r.monitorState === "down" || r.monitorState === "degraded").length;

  const visibleRows = rows.filter((r) => {
    if (filter === "up") return r.monitorState === "up";
    if (filter === "down") return r.monitorState === "down" || r.monitorState === "degraded";
    return true;
  });

  return (
    <Card className="mb-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground">
            <Globe className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Live domain monitor</h3>
            <p className="text-xs text-muted">
              {rows.length} monitored · {upCount} up · {downCount} down/degraded
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-2">
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          <span>
            Auto-refreshing every 10s{updatedAt ? ` · updated ${fmtRelative(new Date(updatedAt))}` : ""}
          </span>
        </div>
      </div>

      {/* Add a domain */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
            placeholder="Add a domain to monitor — e.g. uat-webinsight.atlasskilltech.app"
            className="pl-8"
            inputMode="url"
          />
        </div>
        <Button onClick={onAdd} disabled={pending || !input.trim()}>
          <Plus className="h-4 w-4" /> Add domain
        </Button>
      </div>

      {/* Filter */}
      {rows.length > 0 && (
        <div className="mt-4">
          <Segmented
            options={[
              { value: "all", label: `All (${rows.length})` },
              { value: "up", label: `Up (${upCount})` },
              { value: "down", label: `Down (${downCount})` },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
          />
        </div>
      )}

      {/* List */}
      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState icon={Globe} title="No domains monitored yet" description="Add a domain URL above to start tracking its up/down status live." />
        ) : visibleRows.length === 0 ? (
          <EmptyState icon={Globe} title={`No ${filter === "up" ? "up" : "down/degraded"} domains`} description="Switch the filter to see the others." />
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {visibleRows.map((r) => {
              const s = stateTone(r.monitorState);
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <Badge tone={s.tone} dot>{s.label}</Badge>
                  <a
                    href={hostHref(r.url, r.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 text-sm font-medium text-foreground hover:text-accent hover:underline"
                  >
                    <span className="truncate">{r.name}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-2" />
                  </a>
                  {r.autoDiscovered && <Badge tone="neutral">Auto</Badge>}
                  <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-2">
                    {r.lastHttpStatus ? <span>HTTP {r.lastHttpStatus}</span> : null}
                    {r.responseTimeMs != null ? <span>{r.responseTimeMs} ms</span> : null}
                    {r.lastCheckedAt ? <span>checked {fmtRelative(r.lastCheckedAt)}</span> : <span>not checked yet</span>}
                    <Tooltip content="Stop monitoring">
                      <button
                        onClick={() => onRemove(r.id, r.name)}
                        className="rounded-md p-1 text-muted hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
