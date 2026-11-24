import "server-only";

/**
 * In-process Atlas Invoice Agent worker. Started once at server boot from
 * instrumentation.ts (Node runtime only), so Gmail sync, job draining and
 * forwarding run inside the single Next.js process — there is no separate pm2
 * app. This mirrors src/lib/monitor-scheduler.ts.
 *
 * Safety:
 *  - a module-level singleton guard (`started`) prevents a second scheduler;
 *  - each task has its own in-flight guard so a slow tick never overlaps itself;
 *  - every tick is wrapped in try/catch (one failure never stops the loop or the
 *    web server);
 *  - the drain tick first reaps stale 'running' jobs left by an interrupted
 *    process (deploy/restart/crash).
 *
 * The same work stays exposed at /api/invoices/cron/* for external schedulers
 * and the Gmail Pub/Sub push webhook; duplicate execution is harmless because
 * the DB layer enforces idempotency (unique idempotency keys, FOR UPDATE SKIP
 * LOCKED, atomic forward claim + unique forward dedupe key).
 *
 * Disable entirely with INVOICE_WORKER_DISABLED=1. MUST run as a SINGLE instance
 * (pm2 fork mode, instances: 1) — multiple instances would each run a loop
 * (safe, but wasteful).
 */

const WORKER_ID = "inproc";

let started = false;
const inFlight: Record<string, boolean> = { drain: false, sync: false, forward: false };
let intervals: ReturnType<typeof setInterval>[] = [];
let timeouts: ReturnType<typeof setTimeout>[] = [];
let signalHandler: (() => void) | null = null;

/** Whether the in-process worker is switched off. */
export function invoiceWorkerDisabled(): boolean {
  return process.env.INVOICE_WORKER_DISABLED === "1";
}

/**
 * Run `fn` unless a previous run of the same task is still in flight (the guard
 * is checked-and-set synchronously, so overlapping timer ticks are dropped).
 */
export async function runGuarded(key: string, fn: () => Promise<void>): Promise<void> {
  if (inFlight[key]) return; // previous tick still running — skip this one
  inFlight[key] = true;
  try {
    await fn();
  } catch (e) {
    console.error(`[invoice-worker] ${key} failed:`, e instanceof Error ? e.message : e);
  } finally {
    inFlight[key] = false;
  }
}

function schedule(key: string, firstMs: number, everyMs: number, fn: () => Promise<void>): void {
  timeouts.push(setTimeout(() => void runGuarded(key, fn), firstMs));
  intervals.push(setInterval(() => void runGuarded(key, fn), everyMs));
}

/** Start the in-process worker scheduler. Safe to call more than once (no-op after the first). */
export function startInvoiceWorkerScheduler(): void {
  if (started) return; // singleton: never start a second scheduler
  if (invoiceWorkerDisabled()) {
    console.log("[invoice-worker] in-process scheduler disabled (INVOICE_WORKER_DISABLED=1).");
    return;
  }
  started = true;

  const drainMs = Math.max(5, Number(process.env.INVOICE_WORKER_DRAIN_SECONDS) || 10) * 1000;
  // Gmail push (watch + Pub/Sub) is the PRIMARY detection path — a notification
  // is enqueued and drained within ~1 drain cycle. This periodic sync is only a
  // FALLBACK for missed / expired notifications, capped at 2 minutes so eligible
  // mail is detected and forwarded within ~2 min even without push.
  const syncMs = Math.max(1, Math.min(2, Number(process.env.INVOICE_WORKER_SYNC_MINUTES) || 2)) * 60_000;
  const forwardMs = syncMs;

  // Drain queued jobs (incl. Pub/Sub-enqueued gmail_sync), and first recover any
  // stale 'running' jobs an interrupted process left behind.
  schedule("drain", 8_000, drainMs, async () => {
    const [{ drainJobs }, { reapStaleJobs }] = await Promise.all([
      import("./handlers"),
      import("../jobs"),
    ]);
    const reaped = await reapStaleJobs();
    const r = await drainJobs(WORKER_ID, 25);
    if (r.ran || reaped) {
      console.log(`[invoice-worker] drain ran=${r.ran} reaped=${reaped} ${JSON.stringify(r.detail)}`);
    }
  });

  // Incremental Gmail sync for due accounts (+ Pub/Sub watch renewal).
  schedule("sync", 20_000, syncMs, async () => {
    const { runDueGmailSyncs } = await import("./handlers");
    const r = await runDueGmailSyncs();
    console.log(`[invoice-worker] sync ran=${r.ran} ${JSON.stringify(r.detail)}`);
  });

  // Forward approved invoice emails to the Finance & Accounts address.
  schedule("forward", 30_000, forwardMs, async () => {
    const { runForwardingAll } = await import("./handlers");
    const r = await runForwardingAll();
    console.log(`[invoice-worker] forward ran=${r.ran} ${JSON.stringify(r.detail)}`);
  });

  installShutdown();
  console.log(
    `[invoice-worker] in-process scheduler started (drain ${drainMs / 1000}s, sync ${syncMs / 60_000}m, forward ${forwardMs / 60_000}m).`,
  );
}

/**
 * Stop the scheduler: clear timers, drop the signal handlers and reset state.
 * Does NOT exit the process — Next/pm2 own teardown. Any job left 'running' when
 * the process dies is recovered by reapStaleJobs on the next boot.
 */
export function stopInvoiceWorkerScheduler(): void {
  for (const t of intervals) clearInterval(t);
  for (const t of timeouts) clearTimeout(t);
  intervals = [];
  timeouts = [];
  if (signalHandler) {
    process.off("SIGTERM", signalHandler);
    process.off("SIGINT", signalHandler);
    signalHandler = null;
  }
  inFlight.drain = false;
  inFlight.sync = false;
  inFlight.forward = false;
  started = false;
}

function installShutdown(): void {
  if (signalHandler) return;
  signalHandler = () => stopInvoiceWorkerScheduler();
  process.on("SIGTERM", signalHandler);
  process.on("SIGINT", signalHandler);
}
