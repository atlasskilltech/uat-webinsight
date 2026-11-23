// Atlas Invoice Agent — background worker.
//
// A thin, long-running loop that drives the Invoice Agent's automation by
// calling its bearer-protected cron endpoints on the running Next.js server
// (same pattern as scripts/daily-sync.mjs). Keeping the heavy logic inside the
// Next server avoids bundling server-only modules into a standalone process.
//
// NOTE: the Invoice Agent worker now runs IN-PROCESS inside the Next.js server
// (src/lib/invoice/worker/scheduler.ts, started from src/instrumentation.ts), so
// pm2 no longer runs this script. It is kept as a MANUAL / FALLBACK runner —
// e.g. `npm run invoice:worker`, or an external scheduler — for when the
// in-process worker is disabled (INVOICE_WORKER_DISABLED=1) or you want to drive
// the cron endpoints from a separate process. It calls the same bearer-protected
// /api/invoices/cron/* endpoints, so it needs INVOICE_CRON_SECRET (or CRON_SECRET)
// and APP_URL from .env / the environment.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(join(root, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (env[m[1]] === undefined) env[m[1]] = v;
    }
  } catch {
    /* rely on process env */
  }
  return env;
}

const env = loadEnv();
const appUrl = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = env.INVOICE_CRON_SECRET || env.CRON_SECRET;

if (!secret) {
  console.error("[invoice-worker] INVOICE_CRON_SECRET (or CRON_SECRET) is not set. Aborting.");
  process.exit(2);
}

const DRAIN_MS = Math.max(5, Number(env.INVOICE_WORKER_DRAIN_SECONDS) || 10) * 1000;
const SYNC_MS = Math.max(1, Number(env.INVOICE_WORKER_SYNC_MINUTES) || 5) * 60 * 1000;
const PERIODIC_MS = Math.max(5, Number(env.INVOICE_WORKER_PERIODIC_MINUTES) || 60) * 60 * 1000;

let running = true;

async function call(task) {
  try {
    const res = await fetch(`${appUrl}/api/invoices/cron/${task}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[invoice-worker] ${task} HTTP ${res.status}: ${body.error ?? ""}`);
      return;
    }
    console.log(`[invoice-worker] ${task} ok — ${JSON.stringify(body.results ?? {})}`);
  } catch (e) {
    console.error(`[invoice-worker] could not reach ${task}: ${e?.message ?? e}`);
  }
}

function every(ms, fn) {
  const tick = async () => {
    if (!running) return;
    await fn();
  };
  setTimeout(tick, 2000);
  return setInterval(tick, ms);
}

console.log(`[invoice-worker] started → ${appUrl} (drain ${DRAIN_MS / 1000}s, sync ${SYNC_MS / 60000}m, periodic ${PERIODIC_MS / 60000}m)`);
every(DRAIN_MS, () => call("drain"));
every(SYNC_MS, () => call("sync"));
every(SYNC_MS, () => call("forward"));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[invoice-worker] ${sig} received, stopping.`);
    running = false;
    process.exit(0);
  });
}
