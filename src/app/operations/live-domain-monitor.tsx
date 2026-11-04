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
import { addMonitoredDomain, checkMonitoredDomainsAction, deleteServerAsset } from "./actions";
import type { DomainStatusRow } from "@/lib/domain-monitor";

const REFRESH_MS = 10_000;
// Remembers the user's alert on/off choice across reloads and logins.
const SOUND_PREF_KEY = "live-monitor-alerts";
type Filter = "all" | "up" | "degraded" | "down" | "checking";
type View = "cards" | "list";

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

type DownNotifyOptions = NotificationOptions & { renotify?: boolean };

/** Register the service worker (needed for notifications on mobile). */
async function registerSw(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    /* notifications will fall back to the desktop-only path */
  }
}

/**
 * Ask for OS notification permission (must run from a user gesture) and make
 * sure the service worker is registered. Returns true if pop-ups can be shown.
 */
async function ensureNotificationReady(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  let perm = Notification.permission;
  // Request first, synchronously within the gesture, before any await.
  if (perm === "default") {
    try {
      perm = await Notification.requestPermission();
    } catch {
      perm = Notification.permission;
    }
  }
  await registerSw();
  return perm === "granted";
}

/** Show an OS-level "site down" pop-up (desktop + Android). No-op without permission. */
async function showDownNotification(title: string, body: string, tag: string): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const opts: DownNotifyOptions = {
    body,
    icon: "/icon.png",
    badge: "/icon.png",
    tag,
    renotify: true,
    requireInteraction: true,
  };
  try {
    if ("serviceWorker" in navigator) {
      const reg =
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register("/sw.js"));
      await reg.showNotification(title, opts);
      return;
    }
    new Notification(title, opts);
  } catch {
    // Android throws on `new Notification`; the in-app toast still fires.
    try {
      new Notification(title, opts);
    } catch {
      /* ignore */
    }
  }
}

/** Synthesize a short "site down" alert tune via the Web Audio API (no asset). */
function playAlertTune(ctx: AudioContext): void {
  const now = ctx.currentTime;
  // A descending three-note alert — attention-grabbing but short.
  const notes = [
    { f: 988, t: 0 },
    { f: 740, t: 0.18 },
    { f: 554, t: 0.36 },
  ];
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.f;
    gain.gain.setValueAtTime(0.0001, now + n.t);
    gain.gain.exponentialRampToValueAtTime(0.35, now + n.t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + n.t);
    osc.stop(now + n.t + 0.18);
  }
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
  const [view, setView] = useState<View>("cards");
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const toast = useToast();
  const mounted = useRef(true);
  // Sound alert plumbing: a ref for the current soundOn (the poll closure is
  // created once), the unlocked AudioContext, and the last-seen state per
  // domain so we can detect a fresh transition into "down".
  const soundOnRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const prevStatesRef = useRef<Map<string, string>>(new Map());
  const firstLoadRef = useRef(true);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  // Lazily create + resume the AudioContext. Browsers require a user gesture
  // to start audio, so when the preference is restored as "on" at load time we
  // can't resume yet — instead we arm this to fire on the first interaction.
  const unlockAudio = () => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      void audioCtxRef.current.resume();
      return audioCtxRef.current;
    } catch {
      return null; // audio unavailable — the toast alert still works
    }
  };

  // Create/resume the AudioContext on the (user-gesture) toggle so browsers
  // allow the sound to play; play a confirmation blip when turning it on.
  // Persist the choice so it survives reloads, re-logins and tab close/reopen.
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    try {
      localStorage.setItem(SOUND_PREF_KEY, next ? "on" : "off");
    } catch {
      /* storage unavailable — the choice just won't persist */
    }
    if (next) {
      const ctx = unlockAudio();
      if (ctx) playAlertTune(ctx);
      // Turning alerts on also enables OS pop-up notifications. The permission
      // prompt must come from this click (a user gesture).
      void ensureNotificationReady().then((ok) => {
        if (!ok && "Notification" in window && Notification.permission === "denied") {
          toast("Pop-up notifications are blocked in your browser. Sound and in-app alerts still work.", "error");
        }
      });
    }
  };

  // Restore the saved alert preference on load (after logout/login or reopening
  // the page). If it was on, show it on and unlock audio on the first gesture.
  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(SOUND_PREF_KEY) === "on";
    } catch {
      /* storage unavailable — default to off */
    }
    if (!saved) return;
    setSoundOn(true);
    // Set the ref synchronously so the first poll (run in the effect below,
    // before the re-render from setSoundOn commits) already treats alerts as on.
    soundOnRef.current = true;
    // Register the SW so pop-ups can show on mobile; the browser remembers the
    // notification permission, so a previously-granted user still gets pop-ups.
    void registerSw();
    if (audioCtxRef.current) return; // already unlocked this session
    const onGesture = () => {
      unlockAudio();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, []);

  const poll = async () => {
    setRefreshing(true);
    try {
      const next = await checkMonitoredDomainsAction();
      if (!mounted.current) return;

      // Decide what to alert on. On the FIRST load, surface anything already
      // down — the user opened the dashboard to a site that is down. On every
      // poll after that, alert only on a fresh down (a real up→down transition
      // or a newly added domain found down), so a persistently-down site
      // doesn't re-alert every 10s.
      const prev = prevStatesRef.current;
      const justLoaded = firstLoadRef.current;
      firstLoadRef.current = false;
      const down = (r: DomainStatusRow) => r.monitorState === "down";
      const alerting = justLoaded
        ? next.filter(down)
        : next.filter((r) => down(r) && prev.get(r.id) !== "down");
      const map = new Map<string, string>();
      for (const r of next) map.set(r.id, r.monitorState ?? "");
      prevStatesRef.current = map;

      setRows(next);
      setUpdatedAt(Date.now());

      if (alerting.length > 0) {
        const single = alerting.length === 1 ? alerting[0] : null;
        const title = single ? `${single.name} is down` : `${alerting.length} sites are down`;
        const body = single
          ? single.url || single.name
          : alerting.slice(0, 5).map((r) => r.name).join(", ") + (alerting.length > 5 ? "…" : "");
        const tag = single ? `down-${single.id}` : "down-multi";

        // In-app toast always shows while the dashboard is open.
        toast(title, "error");

        // Sound + OS pop-up only when alerts are enabled (the bell toggle).
        if (soundOnRef.current) {
          void showDownNotification(title, body, tag);
          if (audioCtxRef.current) {
            try {
              void audioCtxRef.current.resume();
              playAlertTune(audioCtxRef.current);
            } catch {
              /* ignore audio errors */
            }
          }
        }
      }
    } catch {
      /* transient — keep showing the last known state */
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  // Refresh on mount, then every 10 seconds while the page is open. The
  // interval is set once; poll() reads live values (soundOn, states) via refs.
  useEffect(() => {
    mounted.current = true;
    void poll();
    const timer = setInterval(() => void poll(), REFRESH_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const degradedCount = rows.filter((r) => r.monitorState === "degraded").length;
  const downCount = rows.filter((r) => r.monitorState === "down").length;
  const checkingCount = rows.filter((r) => isChecking(r.monitorState)).length;

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
              {rows.length} monitored · {upCount} up · {degradedCount} degraded · {downCount} down
              {checkingCount ? ` · ${checkingCount} checking` : ""}
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

      {/* Content */}
      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState icon={Globe} title="No domains monitored yet" description="Add a domain URL above to start tracking its up/down status live." />
        ) : visibleRows.length === 0 ? (
          <EmptyState icon={Globe} title={`No ${filter} domains`} description="Switch the filter to see the others." />
        ) : view === "cards" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleRows.map((r) => (
              <DomainCard key={r.id} r={r} onRemove={onRemove} />
            ))}
          </div>
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

/** One domain as a card (grid view). */
function DomainCard({
  r,
  onRemove,
}: {
  r: DomainStatusRow;
  onRemove: (id: string, name: string) => void;
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
    </div>
  );
}
