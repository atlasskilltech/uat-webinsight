"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Globe, Plus, RefreshCw, Trash2, ExternalLink, LayoutGrid, List, Bell, BellOff } from "lucide-react";
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
import {
  addMonitoredDomain,
  checkMonitoredDomainsAction,
  deleteServerAsset,
  setMonitoredDomainEnvironmentAction,
} from "./actions";
import type { DomainStatusRow } from "@/lib/domain-monitor";
import {
  ensureNotificationReady,
  isAlertsOn,
  ringAlertTune,
  setAlertsPref,
  unlockAudio,
} from "@/lib/domain-alerts";

const REFRESH_MS = 10_000;
type Filter = "all" | "up" | "degraded" | "down" | "checking";
type View = "cards" | "list";

// Which environment a monitored domain belongs to. "unspecified" is for
// existing domains added before environments existed — shown so they can be
// classified.
type Env = "production" | "uat";
type EnvKey = Env | "unspecified";

function envKey(environment: string | null | undefined): EnvKey {
  const v = (environment ?? "").trim().toLowerCase();
  if (v === "production" || v === "prod" || v === "live") return "production";
  if (v === "uat" || v === "staging" || v === "stage" || v === "test") return "uat";
  return "unspecified";
}

/** A domain that hasn't produced a concrete up/down/degraded state yet. */
function isChecking(state?: string | null): boolean {
  return !["up", "down", "degraded"].includes(state ?? "");
}

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
 * health-checked automatically; the whole list auto-refreshes every 10 seconds
 * so up/down status stays current without a page reload.
 *
 * The down-alert itself (sound + toast + OS pop-up) is fired by the global
 * DomainAlertWatcher so it reaches the user on any page; this panel only shows
 * the table and owns the bell toggle (which sets the shared alert preference).
 */
export function LiveDomainMonitor({ initial }: { initial: DomainStatusRow[] }) {
  const [rows, setRows] = useState<DomainStatusRow[]>(initial);
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("cards");
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [addEnv, setAddEnv] = useState<Env>("uat");
  const toast = useToast();
  const mounted = useRef(true);

  // Reflect the saved alert preference in the bell on load (after a reload,
  // re-login or tab reopen). The actual alerting is run by the global watcher.
  useEffect(() => {
    setSoundOn(isAlertsOn());
  }, []);

  // Toggle alerts on/off. Persisting via setAlertsPref also notifies the global
  // DomainAlertWatcher (same tab) so it starts/stops immediately. Turning on is
  // a user gesture, so we unlock audio, play a confirmation blip, and request
  // OS-notification permission here.
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setAlertsPref(next);
    if (next) {
      unlockAudio();
      ringAlertTune();
      void ensureNotificationReady().then((ok) => {
        if (!ok && "Notification" in window && Notification.permission === "denied") {
          toast("Pop-up notifications are blocked in your browser. Sound and in-app alerts still work.", "error");
        }
      });
    }
  };

  // Refresh the table only — alerting is handled globally by DomainAlertWatcher.
  const poll = async () => {
    setRefreshing(true);
    try {
      const next = await checkMonitoredDomainsAction();
      if (!mounted.current) return;
      setRows(next);
      setUpdatedAt(Date.now());
    } catch {
      /* transient — keep showing the last known state */
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  // Refresh the table on mount, then every 10 seconds while the page is open.
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
      fd.set("environment", addEnv);
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

  // Move a domain between Production and UAT — optimistic, then persisted.
  const onSetEnv = (id: string, env: Env) => {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, environment: env } : x)));
    startTransition(async () => {
      await setMonitoredDomainEnvironmentAction(id, env);
    });
  };

  const upCount = rows.filter((r) => r.monitorState === "up").length;
  const degradedCount = rows.filter((r) => r.monitorState === "degraded").length;
  const downCount = rows.filter((r) => r.monitorState === "down").length;
  const checkingCount = rows.filter((r) => isChecking(r.monitorState)).length;
  const prodCount = rows.filter((r) => envKey(r.environment) === "production").length;
  const uatCount = rows.filter((r) => envKey(r.environment) === "uat").length;
  const unspecCount = rows.filter((r) => envKey(r.environment) === "unspecified").length;

  // Status filter tabs appear only for states that currently have domains.
  const filterTabs = [
    { value: "all", label: `All (${rows.length})` },
    ...(upCount ? [{ value: "up", label: `Up (${upCount})` }] : []),
    ...(degradedCount ? [{ value: "degraded", label: `Degraded (${degradedCount})` }] : []),
    ...(downCount ? [{ value: "down", label: `Down (${downCount})` }] : []),
    ...(checkingCount ? [{ value: "checking", label: `Checking (${checkingCount})` }] : []),
  ];

  // If the active filter's tab disappears (its count dropped to 0 on a
  // refresh), fall back to All so nothing shows a stale/empty view.
  useEffect(() => {
    const counts: Record<Filter, number> = { all: rows.length, up: upCount, degraded: degradedCount, down: downCount, checking: checkingCount };
    if (filter !== "all" && counts[filter] === 0) setFilter("all");
  }, [filter, rows.length, upCount, degradedCount, downCount, checkingCount]);

  const visibleRows = rows.filter((r) => {
    switch (filter) {
      case "up": return r.monitorState === "up";
      case "degraded": return r.monitorState === "degraded";
      case "down": return r.monitorState === "down";
      case "checking": return isChecking(r.monitorState);
      default: return true;
    }
  });

  // Always show Production and UAT as their own sections; add Unspecified only
  // when there are still-unclassified domains to assign.
  const sections: { key: EnvKey; label: string; rows: DomainStatusRow[] }[] = [
    { key: "production", label: "Production", rows: visibleRows.filter((r) => envKey(r.environment) === "production") },
    { key: "uat", label: "UAT", rows: visibleRows.filter((r) => envKey(r.environment) === "uat") },
  ];
  const unspecifiedRows = visibleRows.filter((r) => envKey(r.environment) === "unspecified");
  if (unspecifiedRows.length) sections.push({ key: "unspecified", label: "Unspecified", rows: unspecifiedRows });

  const renderBody = (list: DomainStatusRow[]) =>
    view === "cards" ? (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((r) => (
          <DomainCard key={r.id} r={r} onRemove={onRemove} onSetEnv={onSetEnv} />
        ))}
      </div>
    ) : (
      <div className="divide-y divide-border rounded-lg border border-border">
        {list.map((r) => (
          <DomainListRow key={r.id} r={r} onRemove={onRemove} onSetEnv={onSetEnv} />
        ))}
      </div>
    );

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
              {rows.length} monitored · Production {prodCount} · UAT {uatCount}
              {unspecCount ? ` · Unspecified ${unspecCount}` : ""} · {upCount} up · {downCount} down
              {degradedCount ? ` · ${degradedCount} degraded` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-2">
          <Tooltip content={soundOn ? "Alerts on — sound + desktop/mobile pop-up when a site goes down" : "Enable sound + desktop/mobile pop-up alerts when a site goes down"}>
            <button
              type="button"
              onClick={toggleSound}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition-colors",
                soundOn
                  ? "border-accent/40 bg-accent-soft text-accent-soft-foreground"
                  : "border-border text-muted hover:bg-surface-hover hover:text-foreground",
              )}
              aria-pressed={soundOn}
            >
              {soundOn ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              {soundOn ? "Alerts on" : "Alerts off"}
            </button>
          </Tooltip>
          <span className="inline-flex items-center gap-1">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
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
        <Segmented
          options={[
            { value: "production", label: "Production" },
            { value: "uat", label: "UAT" },
          ]}
          value={addEnv}
          onChange={(v) => setAddEnv(v as Env)}
        />
        <Button onClick={onAdd} disabled={pending || !input.trim()}>
          <Plus className="h-4 w-4" /> Add domain
        </Button>
      </div>

      {/* Filter + view toggle */}
      {rows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Segmented
            options={filterTabs}
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
          />
          <Segmented
            options={[
              { value: "cards", label: "Cards", icon: <LayoutGrid className="h-4 w-4" /> },
              { value: "list", label: "List", icon: <List className="h-4 w-4" /> },
            ]}
            value={view}
            onChange={(v) => setView(v as View)}
          />
        </div>
      )}

      {/* Content — split into Production / UAT sections */}
      <div className="mt-4 space-y-5">
        {rows.length === 0 ? (
          <EmptyState icon={Globe} title="No domains monitored yet" description="Add a domain URL above and choose Production or UAT to start tracking its up/down status live." />
        ) : visibleRows.length === 0 ? (
          <EmptyState icon={Globe} title={`No ${filter} domains`} description="Switch the filter to see the others." />
        ) : (
          sections.map((sec) => (
            <div key={sec.key}>
              <div className="mb-2 flex items-center gap-2">
                <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold", envHeaderClass(sec.key))}>
                  {sec.label}
                </span>
                <span className="text-xs text-muted-2">{sec.rows.length} {sec.rows.length === 1 ? "domain" : "domains"}</span>
              </div>
              {sec.rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-2">
                  No {sec.label} domains in this view.
                </p>
              ) : (
                renderBody(sec.rows)
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

/** Tint for a section heading chip by environment. */
function envHeaderClass(key: EnvKey): string {
  switch (key) {
    case "production": return "bg-accent-soft text-accent-soft-foreground";
    case "uat": return "bg-warning-soft text-warning";
    default: return "bg-surface-hover text-muted";
  }
}

/** Compact Production/UAT switch shown on each domain to (re)classify it. */
function EnvToggle({ value, onChange }: { value: EnvKey; onChange: (e: Env) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {(["production", "uat"] as const).map((e) => {
        const active = value === e;
        return (
          <button
            key={e}
            type="button"
            onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onChange(e); }}
            className={cn(
              "px-2 py-0.5 text-[11px] font-medium transition-colors",
              active
                ? e === "production"
                  ? "bg-accent-soft text-accent-soft-foreground"
                  : "bg-warning-soft text-warning"
                : "text-muted-2 hover:bg-surface-hover hover:text-foreground",
            )}
            aria-pressed={active}
          >
            {e === "production" ? "Prod" : "UAT"}
          </button>
        );
      })}
    </div>
  );
}

/** One domain as a card (grid view). */
function DomainCard({
  r,
  onRemove,
  onSetEnv,
}: {
  r: DomainStatusRow;
  onRemove: (id: string, name: string) => void;
  onSetEnv: (id: string, env: Env) => void;
}) {
  const s = stateTone(r.monitorState);
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <Badge tone={s.tone} dot>{s.label}</Badge>
        <div className="flex items-center gap-1">
          {r.autoDiscovered && <Badge tone="neutral">Auto</Badge>}
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
      <a
        href={hostHref(r.url, r.name)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 flex max-w-full items-center gap-1 text-sm font-medium text-foreground hover:text-accent hover:underline"
      >
        <span className="truncate">{r.name}</span>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-2" />
      </a>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-2">
        {r.lastHttpStatus ? <span>HTTP {r.lastHttpStatus}</span> : null}
        {r.responseTimeMs != null ? <span>{r.responseTimeMs} ms</span> : null}
        {r.lastCheckedAt ? <span>checked {fmtRelative(r.lastCheckedAt)}</span> : <span>not checked yet</span>}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-[11px] text-muted-2">Environment</span>
        <EnvToggle value={envKey(r.environment)} onChange={(e) => onSetEnv(r.id, e)} />
      </div>
    </div>
  );
}

/** One domain as a row (list view). */
function DomainListRow({
  r,
  onRemove,
  onSetEnv,
}: {
  r: DomainStatusRow;
  onRemove: (id: string, name: string) => void;
  onSetEnv: (id: string, env: Env) => void;
}) {
  const s = stateTone(r.monitorState);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
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
        <EnvToggle value={envKey(r.environment)} onChange={(e) => onSetEnv(r.id, e)} />
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
}
