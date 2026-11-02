import "server-only";

/**
 * In-process scheduler for domain monitoring. Started once at server boot from
 * instrumentation.ts, so the app monitors itself with no external cron needed.
 * Under pm2 the Node process is long-lived, so these timers persist until the
 * next deploy/restart (which simply starts them again).
 *
 * The same work is also exposed at /api/cron/monitor, so an external scheduler
 * can trigger it too; runDomainMonitor holds a lock so the two never overlap.
 */

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // health checks every 30 minutes
const DISCOVER_INTERVAL_MS = 24 * 60 * 60 * 1000; // re-discover subdomains daily
const FIRST_RUN_DELAY_MS = 45_000; // let the server settle before the first pass

let started = false;

export function startDomainMonitorScheduler(): void {
  if (started) return;
  started = true;

  const run = async (discover: boolean) => {
    try {
      const { runDomainMonitor } = await import("./domain-monitor");
      const r = await runDomainMonitor({ discover });
      console.log(`[domain-monitor] ${r.message}`);
    } catch (e) {
      console.error("[domain-monitor] run failed:", e instanceof Error ? e.message : e);
    }
  };

  // First pass shortly after boot: discover + check.
  setTimeout(() => void run(true), FIRST_RUN_DELAY_MS);
  // Recurring health checks and (less often) re-discovery.
  setInterval(() => void run(false), CHECK_INTERVAL_MS);
  setInterval(() => void run(true), DISCOVER_INTERVAL_MS);

  console.log("[domain-monitor] scheduler started (checks every 30m, discovery daily).");
}
