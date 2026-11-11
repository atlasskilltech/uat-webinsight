/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * We use it to launch the in-process domain-monitor scheduler so the Server
 * Inventory's live status updates on its own, with no external cron required.
 *
 * Guarded to the Node.js runtime (never the edge runtime or build step) and
 * can be turned off with MONITOR_SCHEDULER_DISABLED=1.
 */
export async function register(): Promise<void> {
  // The positive `=== "nodejs"` guard lets the edge bundler drop this import
  // (domain-monitor uses node:tls/http, which the edge runtime can't bundle).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const schedulers = await import("./lib/monitor-scheduler");
    if (process.env.MONITOR_SCHEDULER_DISABLED !== "1") {
      schedulers.startDomainMonitorScheduler();
    }
    // Auto-sync GSC + GA4 (default every 3 hours) so the data stays current.
    if (process.env.SYNC_SCHEDULER_DISABLED !== "1") {
      schedulers.startGoogleSyncScheduler();
    }
    // Daily "which sites are up/down" status report (once per day at the hour
    // configured in Settings).
    if (process.env.DAILY_REPORT_SCHEDULER_DISABLED !== "1") {
      schedulers.startDailyReportScheduler();
    }
  }
}
