import "server-only";
import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import { execute, query } from "./db";
import { createId } from "./id";
import type { ServerAsset } from "./models";
import { getSettings } from "./settings";
import { sendEmail, parseRecipients, emailLayout, escapeHtml } from "./email";

/**
 * Domain monitoring for the Server Inventory. Only domains a user explicitly
 * adds are monitored (no auto-discovery). Each monitored domain/subdomain is
 * probed over HTTPS (with an HTTP fallback) to record whether it is
 * up/degraded/down, the HTTP status, response time and live TLS cert expiry.
 *
 * Everything is best-effort and self-contained: a failure for one host never
 * affects another, and the whole run never throws to its caller.
 */

const PROBE_TIMEOUT_MS = 10_000;
const CONCURRENCY = 10;

/** Human-readable duration like "2m 15s". */
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}m ${rem}s` : `${rem}s`;
}

function fmtTime(d: Date, tz: string): string {
  try {
    return d.toLocaleString("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "medium" });
  } catch {
    return d.toISOString();
  }
}

function targetUrl(asset: ServerAsset, host: string): string {
  return asset.url || `https://${host}`;
}

/** Email the team that a monitored site has been down past the threshold. */
async function sendDownAlertEmail(
  asset: ServerAsset,
  host: string,
  downSince: Date,
  now: Date,
  httpStatus: number | null,
  recipients: string[],
  cc: string[],
  tz: string,
  ctaUrl: string,
) {
  const url = targetUrl(asset, host);
  const forStr = fmtDuration(now.getTime() - downSince.getTime());
  const statusLine = httpStatus ? `HTTP status ${httpStatus}` : "No response (connection failed)";
  const html = emailLayout({
    accent: "#dc2626",
    icon: "⚠️",
    badge: "SITE DOWN",
    title: `${asset.name} is down`,
    intro: `${asset.name} has not been responding for ${forStr}.`,
    rows: [
      { label: "URL", value: `<a href="${escapeHtml(url)}" style="color:#2563eb;text-decoration:none">${escapeHtml(url)}</a>` },
      { label: "Environment", value: escapeHtml(asset.environment || "—") },
      { label: "Down since", value: escapeHtml(fmtTime(downSince, tz)) },
      { label: "Down for", value: escapeHtml(forStr) },
      { label: "Detail", value: escapeHtml(statusLine) },
    ],
    cta: ctaUrl ? { label: "View domain report", url: ctaUrl } : undefined,
    footerNote: "You are receiving this because you are a downtime-alert recipient in Atlas WebInsight.",
  });
  const text = `SITE DOWN: ${asset.name}\nURL: ${url}\nEnvironment: ${asset.environment || "-"}\nDown since: ${fmtTime(downSince, tz)}\nDown for: ${forStr}\n${statusLine}${ctaUrl ? `\nReport: ${ctaUrl}` : ""}`;
  return sendEmail({ to: recipients, cc, subject: `🔴 DOWN: ${asset.name} has been down for ${forStr}`, html, text });
}

/** Email the team that a site that had been reported down is back up. */
async function sendRecoveryEmail(
  asset: ServerAsset,
  host: string,
  downSince: Date,
  now: Date,
  recipients: string[],
  cc: string[],
  tz: string,
  ctaUrl: string,
) {
  const url = targetUrl(asset, host);
  const outage = fmtDuration(now.getTime() - downSince.getTime());
  const html = emailLayout({
    accent: "#16a34a",
    icon: "✅",
    badge: "RESOLVED",
    title: `${asset.name} is back up`,
    intro: `${asset.name} is responding again.`,
    rows: [
      { label: "URL", value: `<a href="${escapeHtml(url)}" style="color:#2563eb;text-decoration:none">${escapeHtml(url)}</a>` },
      { label: "Total downtime", value: escapeHtml(outage) },
      { label: "Recovered at", value: escapeHtml(fmtTime(now, tz)) },
    ],
    cta: ctaUrl ? { label: "View domain report", url: ctaUrl } : undefined,
  });
  const text = `RECOVERED: ${asset.name}\nURL: ${url}\nTotal downtime: ${outage}\nRecovered at: ${fmtTime(now, tz)}${ctaUrl ? `\nReport: ${ctaUrl}` : ""}`;
  return sendEmail({ to: recipients, cc, subject: `✅ RECOVERED: ${asset.name} is back up`, html, text });
}
const MAX_REDIRECTS = 5;
const UA = "AtlasWebInsight-Monitor/1.0";

export type MonitorState = "up" | "degraded" | "down" | "unknown";

export interface MonitorRunResult {
  ok: boolean;
  checked: number;
  up: number;
  degraded: number;
  down: number;
  message: string;
}

// Module-level lock so the in-process scheduler and a manual/cron trigger can
// never run two monitor passes at once (they share the same Node process).
let running = false;

/** Lowercase a host and strip protocol, path, port, wildcard and trailing dot. */
export function normaliseHost(input: string): string | null {
  if (!input) return null;
  let h = input.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^\*\./, ""); // wildcard cert entry
  if (h.includes("://")) {
    try {
      h = new URL(h).hostname;
    } catch {
      return null;
    }
  }
  h = h.split("/")[0].split("?")[0].split("@").pop()!; // drop path/query/userinfo
  h = h.split(":")[0]; // drop port
  h = h.replace(/\.$/, "");
  // A valid hostname: labels of letters/digits/hyphen, at least one dot.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return null;
  return h;
}

/** The host a ServerAsset points at, derived from its url or name. */
function hostOfAsset(a: Pick<ServerAsset, "url" | "name">): string | null {
  return normaliseHost(a.url ?? "") ?? normaliseHost(a.name ?? "");
}

// --- Health checks ----------------------------------------------------------

interface ProbeResult {
  state: MonitorState;
  httpStatus: number | null;
  responseTimeMs: number | null;
  sslExpiry: Date | null;
}

/** One request to a full URL. Resolves status 0 on connection failure. */
function requestOnce(urlStr: string, method: "HEAD" | "GET"): Promise<{ status: number; location?: string; ms: number }> {
  const start = Date.now();
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return Promise.resolve({ status: 0, ms: 0 });
  }
  const secure = u.protocol === "https:";
  const mod = secure ? https : http;
  const options: https.RequestOptions = {
    host: u.hostname,
    port: u.port ? Number(u.port) : secure ? 443 : 80,
    method,
    path: (u.pathname || "/") + (u.search || ""),
    timeout: PROBE_TIMEOUT_MS,
    headers: { "User-Agent": UA, Accept: "*/*" },
    ...(secure ? { servername: u.hostname, rejectUnauthorized: false } : {}),
  };
  return new Promise((resolve) => {
    const req = mod.request(options, (res) => {
      resolve({ status: res.statusCode ?? 0, location: res.headers.location, ms: Date.now() - start });
      res.resume(); // drain so the socket can close
      req.destroy();
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, ms: Date.now() - start }); });
    req.on("error", () => resolve({ status: 0, ms: Date.now() - start }));
    req.end();
  });
}

/**
 * Probe a URL and FOLLOW redirects (like a browser), returning the final
 * status. Falls back to GET if HEAD is rejected (405). Resolves status 0 if the
 * first hop can't connect.
 */
async function probeFollow(startUrl: string): Promise<{ status: number; ms: number }> {
  let url = startUrl;
  let method: "HEAD" | "GET" = "HEAD";
  let total = 0;
  let lastStatus = 0;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const r = await requestOnce(url, method);
    total += r.ms;
    if (r.status === 0) return { status: hop === 0 ? 0 : lastStatus, ms: total };
    lastStatus = r.status;
    // Some servers reject HEAD — retry the same URL with GET once.
    if (r.status === 405 && method === "HEAD") { method = "GET"; continue; }
    // Follow 3xx redirects to their Location.
    if (r.status >= 300 && r.status < 400 && r.location) {
      let next: string;
      try {
        next = new URL(r.location, url).toString();
      } catch {
        return { status: r.status, ms: total };
      }
      if (next === url) return { status: r.status, ms: total }; // self-redirect loop
      url = next;
      method = "HEAD"; // reset for the new hop
      continue;
    }
    return { status: r.status, ms: total };
  }
  return { status: lastStatus, ms: total }; // exceeded redirect limit
}

/** Read the live TLS certificate's expiry (valid_to). Null on failure. */
function certExpiry(host: string): Promise<Date | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: Date | null) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const socket = tls.connect(
        { host, port: 443, servername: host, timeout: PROBE_TIMEOUT_MS, rejectUnauthorized: false },
        () => {
          const cert = socket.getPeerCertificate();
          const d = cert && cert.valid_to ? new Date(cert.valid_to) : null;
          socket.destroy();
          done(d && !Number.isNaN(d.getTime()) ? d : null);
        },
      );
      socket.on("timeout", () => { socket.destroy(); done(null); });
      socket.on("error", () => done(null));
    } catch {
      done(null);
    }
  });
}

function classify(status: number): MonitorState {
  if (status === 0) return "down";
  if (status >= 200 && status < 400) return "up";
  if (status >= 400 && status < 500) return "degraded"; // reachable, auth/not-found
  return "down"; // 5xx — server failing
}

/** Probe a single host: HTTPS (following redirects) first, HTTP fallback, plus TLS expiry. */
export async function checkHost(host: string): Promise<ProbeResult> {
  const [httpsRes, ssl] = await Promise.all([
    probeFollow(`https://${host}/`),
    certExpiry(host),
  ]);
  if (httpsRes.status > 0) {
    return { state: classify(httpsRes.status), httpStatus: httpsRes.status, responseTimeMs: httpsRes.ms, sslExpiry: ssl };
  }
  // HTTPS unreachable — try plain HTTP to tell "no HTTPS" apart from "down".
  const httpRes = await probeFollow(`http://${host}/`);
  if (httpRes.status > 0) {
    return { state: "degraded", httpStatus: httpRes.status, responseTimeMs: httpRes.ms, sslExpiry: ssl };
  }
  return { state: "down", httpStatus: null, responseTimeMs: null, sslExpiry: ssl };
}

/** Run `tasks` with a bounded number in flight at once. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

// --- Orchestration ----------------------------------------------------------

/**
 * Run one monitoring pass: health-check every monitored domain/subdomain
 * (only the ones a user added). No auto-discovery.
 */
export async function runDomainMonitor(opts: { staleMs?: number } = {}): Promise<MonitorRunResult> {
  if (running) {
    return { ok: false, checked: 0, up: 0, degraded: 0, down: 0, message: "A monitor run is already in progress." };
  }
  running = true;
  try {
    const all = await query<ServerAsset>(
      "SELECT * FROM `ServerAsset` WHERE `monitorEnabled` = 1 OR `type` IN ('domain','subdomain')",
    );
    // When staleMs is set (frequent live polls), only re-check domains whose
    // last check is older than that, so a 10-second poll doesn't redundantly
    // re-probe everything each time.
    const toCheck = opts.staleMs
      ? all.filter((a) => !a.lastCheckedAt || Date.now() - new Date(a.lastCheckedAt).getTime() >= opts.staleMs!)
      : all;
    let up = 0, degraded = 0, down = 0, checked = 0;

    // Downtime-alert config (read once per run).
    const settings = await getSettings();
    const recipients = parseRecipients(settings.alertRecipients);
    const cc = parseRecipients(settings.alertCc);
    const thresholdMs = Math.max(10, Number(settings.downAlertSeconds) || 120) * 1000;
    const tz = settings.timezone || "Asia/Kolkata";
    // Base URL of the dashboard for the email CTA ("View domain report").
    const appBase = (process.env.APP_URL || "").replace(/\/+$/, "");
    const ctaFor = (h: string) => (appBase ? `${appBase}/operations?domain=${encodeURIComponent(h)}` : "");

    await pool(toCheck, CONCURRENCY, async (asset) => {
      const host = hostOfAsset(asset);
      if (!host) return;
      const r = await checkHost(host);
      checked++;
      if (r.state === "up") up++;
      else if (r.state === "degraded") degraded++;
      else if (r.state === "down") down++;

      const now = new Date();
      let downSince: Date | null = asset.downSince ? new Date(asset.downSince) : null;
      let downAlertSentAt: Date | null = asset.downAlertSentAt ? new Date(asset.downAlertSentAt) : null;

      if (r.state === "down") {
        if (!downSince) downSince = now; // outage just started
        const elapsedMs = now.getTime() - downSince.getTime();
        // Email once, after it has stayed down past the threshold.
        if (elapsedMs >= thresholdMs && !downAlertSentAt && recipients.length > 0) {
          const res = await sendDownAlertEmail(asset, host, downSince, now, r.httpStatus, recipients, cc, tz, ctaFor(host));
          if (res.ok) {
            downAlertSentAt = now;
            console.log(`[domain-monitor] down-alert emailed for ${host}: ${res.message}`);
          } else {
            console.error(`[domain-monitor] down-alert email failed for ${host}: ${res.message}`);
          }
        }
      } else {
        // Not down any more. If we had emailed an outage, send a recovery note.
        if (downSince && downAlertSentAt && recipients.length > 0) {
          const res = await sendRecoveryEmail(asset, host, downSince, now, recipients, cc, tz, ctaFor(host));
          if (!res.ok) console.error(`[domain-monitor] recovery email failed for ${host}: ${res.message}`);
        }
        downSince = null;
        downAlertSentAt = null;
      }

      // Keep an existing sslExpiry if this probe couldn't read one.
      await execute(
        "UPDATE `ServerAsset` SET `monitorState`=?, `lastHttpStatus`=?, `responseTimeMs`=?, `lastCheckedAt`=?, `monitorEnabled`=?, `sslExpiry`=COALESCE(?, `sslExpiry`), `downSince`=?, `downAlertSentAt`=? WHERE `id`=?",
        [r.state, r.httpStatus, r.responseTimeMs, new Date(), true, r.sslExpiry, downSince, downAlertSentAt, asset.id],
      );
    });

    return { ok: true, checked, up, degraded, down, message: `Checked ${checked} domain(s): ${up} up, ${degraded} degraded, ${down} down.` };
  } catch (e) {
    return { ok: false, checked: 0, up: 0, degraded: 0, down: 0, message: e instanceof Error ? e.message : "Monitor run failed." };
  } finally {
    running = false;
  }
}

// --- Live domain list (for the Server Inventory monitor panel) --------------

export interface DomainStatusRow {
  id: string;
  name: string;
  url: string | null;
  type: string;
  environment: string | null;
  monitorState: string | null;
  lastHttpStatus: number | null;
  responseTimeMs: number | null;
  sslExpiry: Date | null;
  lastCheckedAt: Date | null;
  autoDiscovered: boolean;
}

/** Every monitored domain/subdomain, for the live status panel. */
export async function getMonitoredDomains(): Promise<DomainStatusRow[]> {
  return query<DomainStatusRow>(
    "SELECT `id`,`name`,`url`,`type`,`environment`,`monitorState`,`lastHttpStatus`,`responseTimeMs`,`sslExpiry`,`lastCheckedAt`,`autoDiscovered` " +
      "FROM `ServerAsset` WHERE `monitorEnabled` = 1 OR `type` IN ('domain','subdomain') " +
      "ORDER BY (`monitorState` = 'down') DESC, (`monitorState` = 'degraded') DESC, `name` ASC",
  );
}

/** Normalise a free-form environment value to the two we track (else null). */
export function normaliseEnvironment(input: string | null | undefined): "production" | "uat" | null {
  const v = (input ?? "").trim().toLowerCase();
  if (v === "production" || v === "prod" || v === "live") return "production";
  if (v === "uat" || v === "staging" || v === "stage" || v === "test") return "uat";
  return null;
}

export type AddHostResult =
  | { ok: true; host: string }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "duplicate"; host: string };

/**
 * Add a single domain/URL to monitor. Rejects with "duplicate" if the same host
 * already exists (so the same URL can't be added twice), and "invalid" if the
 * input isn't a valid domain.
 */
export async function addMonitoredHost(
  input: string,
  environment?: string | null,
): Promise<AddHostResult> {
  const host = normaliseHost(input);
  if (!host) return { ok: false, reason: "invalid" };
  const existing = await query<{ id: string; url: string | null; name: string }>(
    "SELECT `id`,`url`,`name` FROM `ServerAsset`",
  );
  if (existing.some((a) => hostOfAsset(a) === host)) {
    return { ok: false, reason: "duplicate", host };
  }
  await execute(
    "INSERT INTO `ServerAsset` (`id`,`type`,`name`,`url`,`environment`,`autoDiscovered`,`monitorEnabled`,`status`) VALUES (?,?,?,?,?,?,?,?)",
    [createId(), "domain", host, `https://${host}`, normaliseEnvironment(environment), false, true, "active"],
  );
  return { ok: true, host };
}

/** Change which environment (production/uat) a monitored domain belongs to. */
export async function setMonitoredDomainEnvironment(
  id: string,
  environment: string | null,
): Promise<void> {
  await execute("UPDATE `ServerAsset` SET `environment` = ? WHERE `id` = ?", [
    normaliseEnvironment(environment),
    id,
  ]);
}
