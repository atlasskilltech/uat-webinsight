// Trigger the protected daily Google sync endpoint.
// Intended to be run by Windows Task Scheduler / cron, e.g. `npm run sync`.
//
// Reads CRON_SECRET and APP_URL from the project's .env (falling back to the
// process environment). The secret is used only as a bearer token and is never
// printed. The Next.js server must be running at APP_URL for this to succeed.
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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (env[m[1]] === undefined) env[m[1]] = v;
    }
  } catch {
    // No .env file found — rely on the process environment.
  }
  return env;
}

const env = loadEnv();
const appUrl = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set (checked .env and the environment). Aborting.");
  process.exit(2);
}

try {
  const res = await fetch(`${appUrl}/api/cron/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Sync endpoint returned HTTP ${res.status}: ${body.error ?? ""}`);
    process.exit(1);
  }
  for (const r of body.results ?? []) {
    const tag = r.skipped ? "skipped" : r.ok ? "ok" : "FAILED";
    console.log(`[${r.provider}] ${tag} — ${r.message}`);
  }
  console.log(`Done at ${body.ranAt}`);
  process.exit(body.ok ? 0 : 1);
} catch (e) {
  console.error(`Could not reach the sync endpoint at ${appUrl}/api/cron/sync: ${e?.message ?? e}`);
  console.error("Is the Next.js server running?");
  process.exit(1);
}
