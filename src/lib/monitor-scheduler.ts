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

// Health checks run frequently so a short outage is caught server-side (needed
// for the "down for N seconds" email alert). Default 60s; override with
// MONITOR_INTERVAL_SECONDS. Kept >= 20s to avoid hammering hosts.
const CHECK_INTERVAL_MS = Math.max(20, Number(process.env.MONITOR_INTERVAL_SECONDS) || 60) * 1000;
const FIRST_RUN_DELAY_MS = 45_000; // let the server settle before the first pass

// Google (GSC + GA4) auto-sync interval. Defaults to 3 hours; override with
// SYNC_INTERVAL_HOURS (e.g. 1). GSC daily data lags 2-3 days regardless, so the
// most recent days fill in once Google finalises them.
const SYNC_INTERVAL_MS = Math.max(1, Number(process.env.SYNC_INTERVAL_HOURS) || 3) * 60 * 60 * 1000;
const SYNC_FIRST_DELAY_MS = 60_000;

let started = false;
let syncStarted = false;
let reportStarted = false;

// How often the daily-report scheduler wakes to check whether the digest is due
// (the send itself is gated to once per day, at/after the configured hour).
const REPORT_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const REPORT_FIRST_DELAY_MS = 90_000;

export function startDomainMonitorScheduler(): void {
  if (started) return;
  started = true;

  const run = async () => {
    try {
      const { runDomainMonitor } = await import("./domain-monitor");
      const r = await runDomainMonitor();
      console.log(`[domain-monitor] ${r.message}`);
    } catch (e) {
      console.error("[domain-monitor] run failed:", e instanceof Error ? e.message : e);
    }
  };

  setTimeout(() => void run(), FIRST_RUN_DELAY_MS);
  setInterval(() => void run(), CHECK_INTERVAL_MS);

  console.log(`[domain-monitor] scheduler started (health checks every ${CHECK_INTERVAL_MS / 1000}s).`);
}

/**
 * Auto-sync Google Search Console + GA4 on a schedule (default every 3 hours),
 * so the SEO & Analytics data stays current with no manual "Sync" needed. Each
 * run refreshes the trailing window (daily totals, hourly, pages and the
 * query/country/device/channel breakdowns); runGoogleSync holds its own
 * per-provider lock so overlapping runs are safe.
 */
export function startGoogleSyncScheduler(): void {
  if (syncStarted) return;
  syncStarted = true;

  const run = async () => {
    try {
      const { runGoogleSync } = await import("./sync");
      for (const provider of ["gsc", "ga4"] as const) {
        const r = await runGoogleSync(provider, { trigger: "cron" });
        console.log(`[auto-sync] ${provider}: ${r.message}`);
      }
    } catch (e) {
      console.error("[auto-sync] run failed:", e instanceof Error ? e.message : e);
    }
  };

  setTimeout(() => void run(), SYNC_FIRST_DELAY_MS);
  setInterval(() => void run(), SYNC_INTERVAL_MS);

  console.log(`[auto-sync] scheduler started (every ${SYNC_INTERVAL_MS / 3_600_000}h).`);
}

/**
 * Send the daily "which sites are up/down" digest once per day. Wakes every 15
 * minutes and asks sendDailyStatusReport whether it is due — the send is gated
 * (enabled, at/after the configured hour, not already sent today) and records
 * the date in the DB, so restarts never double-send and a restart later in the
 * day still catches up. The same work is exposed at /api/cron/daily-report.
 */
export function startDailyReportScheduler(): void {
  if (reportStarted) return;
  reportStarted = true;

  const run = async () => {
    try {
      const { sendDailyStatusReport } = await import("./domain-monitor");
      const r = await sendDailyStatusReport();
      if (r.ok) console.log(`[daily-report] ${r.message}`);
      else if (!r.skipped) console.error(`[daily-report] ${r.message}`);
    } catch (e) {
      console.error("[daily-report] run failed:", e instanceof Error ? e.message : e);
    }
  };

  setTimeout(() => void run(), REPORT_FIRST_DELAY_MS);
  setInterval(() => void run(), REPORT_CHECK_INTERVAL_MS);

  console.log(`[daily-report] scheduler started (checks every ${REPORT_CHECK_INTERVAL_MS / 60000}m).`);
}
