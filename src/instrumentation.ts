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
    if (process.env.MONITOR_SCHEDULER_DISABLED === "1") return;
    const { startDomainMonitorScheduler } = await import("./lib/monitor-scheduler");
    startDomainMonitorScheduler();
  }
}
