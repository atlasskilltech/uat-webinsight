import "server-only";
import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import { execute, query } from "./db";
import { createId } from "./id";
import { getSettings } from "./settings";
import type { ServerAsset } from "./models";

/**
 * Domain monitoring for the Server Inventory.
 *
 *  - Discovery: subdomains of each configured root domain are enumerated from
 *    Certificate Transparency logs (crt.sh) — the standard way to find every
 *    host that has ever had a TLS certificate. New hosts are added to
 *    ServerAsset automatically (autoDiscovered = true).
 *  - Health checks: each monitored domain/subdomain is probed over HTTPS (with
 *    an HTTP fallback) to record whether it is up/degraded/down, the HTTP
 *    status, the response time and the live TLS certificate expiry.
 *
 * Everything is best-effort and self-contained: a failure for one host never
 * affects another, and the whole run never throws to its caller.
 */

const PROBE_TIMEOUT_MS = 10_000;
const DISCOVERY_TIMEOUT_MS = 25_000;
const CONCURRENCY = 10;
const MAX_REDIRECTS = 5;
const UA = "AtlasWebInsight-Monitor/1.0";

export type MonitorState = "up" | "degraded" | "down" | "unknown";

export interface MonitorRunResult {
  ok: boolean;
  discovered: number; // new hosts added this run
  checked: number;
  up: number;
  degraded: number;
  down: number;
  message: string;
}

// Module-level lock so the in-process scheduler and a manual/cron trigger can
// never run two monitor passes at once (they share the same Node process).
let running = false;

/** Root domains to watch, from settings (newline/comma separated). */
export async function getWatchDomains(): Promise<string[]> {
  const settings = await getSettings();
  return parseDomains(settings.watchDomains ?? "");
}

export function parseDomains(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n,\s]+/)
        .map((d) => normaliseHost(d))
        .filter((d): d is string => !!d),
    ),
  ];
}

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

// --- Discovery (Certificate Transparency via crt.sh) ------------------------

/**
 * Enumerate subdomains of a root domain from crt.sh. Returns the root itself
 * plus every discovered host. Never throws — returns [] on any failure.
 */
export async function discoverSubdomains(root: string): Promise<string[]> {
  const domain = normaliseHost(root);
  if (!domain) return [];
  const found = new Set<string>([domain]);
  try {
    const url = `https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) return [...found];
    const rows = (await res.json()) as Array<{ name_value?: string; common_name?: string }>;
    for (const row of rows) {
      for (const field of [row.name_value, row.common_name]) {
        if (!field) continue;
        for (const part of String(field).split("\n")) {
          const h = normaliseHost(part);
          if (h && (h === domain || h.endsWith("." + domain))) found.add(h);
        }
      }
    }
  } catch {
    /* crt.sh unreachable/slow/invalid — keep whatever we have (at least root) */
  }
  return [...found];
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
 * Run one monitoring pass. When `discover` is true, re-enumerate subdomains of
 * every watched root from crt.sh and add any new hosts first. Then health-check
 * every auto-discovered asset and every manually-added domain/subdomain.
 */
export async function runDomainMonitor(opts: { discover?: boolean; staleMs?: number } = {}): Promise<MonitorRunResult> {
  if (running) {
    return { ok: false, discovered: 0, checked: 0, up: 0, degraded: 0, down: 0, message: "A monitor run is already in progress." };
  }
  running = true;
  try {
    let discovered = 0;

    // Existing hosts (across all assets) so we never create duplicates.
    const assets = await query<ServerAsset>("SELECT * FROM `ServerAsset`");
    const knownHosts = new Set<string>();
    for (const a of assets) {
      const h = hostOfAsset(a);
      if (h) knownHosts.add(h);
    }

    if (opts.discover) {
      const roots = await getWatchDomains();
      for (const root of roots) {
        const hosts = await discoverSubdomains(root);
        const newHosts = hosts.filter((h) => !knownHosts.has(h));
        if (newHosts.length === 0) continue;
        const values = newHosts.map((h) => {
          knownHosts.add(h);
          const type = h === root ? "domain" : "subdomain";
          // id,type,name,url,autoDiscovered,monitorEnabled,status
          return [createId(), type, h, `https://${h}`, true, true, "active"];
        });
        await execute(
          "INSERT INTO `ServerAsset` (`id`,`type`,`name`,`url`,`autoDiscovered`,`monitorEnabled`,`status`) VALUES ?",
          [values],
        );
        discovered += newHosts.length;
      }
    }

    // Health-check every auto-discovered asset and every manual domain/subdomain.
    const all = await query<ServerAsset>(
      "SELECT * FROM `ServerAsset` WHERE `autoDiscovered` = ? OR `type` IN ('domain','subdomain')",
      [true],
    );
    // When staleMs is set (frequent live polls), only re-check domains whose
    // last check is older than that, so a 30-second poll doesn't redundantly
    // re-probe everything each time.
    const toCheck = opts.staleMs
      ? all.filter((a) => !a.lastCheckedAt || Date.now() - new Date(a.lastCheckedAt).getTime() >= opts.staleMs!)
      : all;
    let up = 0, degraded = 0, down = 0, checked = 0;

    await pool(toCheck, CONCURRENCY, async (asset) => {
      const host = hostOfAsset(asset);
      if (!host) return;
      const r = await checkHost(host);
      checked++;
      if (r.state === "up") up++;
      else if (r.state === "degraded") degraded++;
      else if (r.state === "down") down++;
      // Keep an existing sslExpiry if this probe couldn't read one.
      await execute(
        "UPDATE `ServerAsset` SET `monitorState`=?, `lastHttpStatus`=?, `responseTimeMs`=?, `lastCheckedAt`=?, `monitorEnabled`=?, `sslExpiry`=COALESCE(?, `sslExpiry`) WHERE `id`=?",
        [r.state, r.httpStatus, r.responseTimeMs, new Date(), true, r.sslExpiry, asset.id],
      );
    });

    return {
      ok: true,
      discovered,
      checked,
      up,
      degraded,
      down,
      message:
        `Checked ${checked} domain(s): ${up} up, ${degraded} degraded, ${down} down` +
        (opts.discover ? `; ${discovered} newly discovered.` : "."),
    };
  } catch (e) {
    return { ok: false, discovered: 0, checked: 0, up: 0, degraded: 0, down: 0, message: e instanceof Error ? e.message : "Monitor run failed." };
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
    "SELECT `id`,`name`,`url`,`type`,`monitorState`,`lastHttpStatus`,`responseTimeMs`,`sslExpiry`,`lastCheckedAt`,`autoDiscovered` " +
      "FROM `ServerAsset` WHERE `monitorEnabled` = 1 OR `type` IN ('domain','subdomain') " +
      "ORDER BY (`monitorState` = 'down') DESC, (`monitorState` = 'degraded') DESC, `name` ASC",
  );
}

/**
 * Add a single domain/URL to monitor (or enable monitoring on an existing
 * matching asset). Returns the normalised host, or null if the input isn't a
 * valid domain.
 */
export async function addMonitoredHost(input: string): Promise<string | null> {
  const host = normaliseHost(input);
  if (!host) return null;
  const existing = await query<{ id: string; url: string | null; name: string }>(
    "SELECT `id`,`url`,`name` FROM `ServerAsset`",
  );
  const match = existing.find((a) => hostOfAsset(a) === host);
  if (match) {
    await execute("UPDATE `ServerAsset` SET `monitorEnabled` = 1 WHERE `id` = ?", [match.id]);
    return host;
  }
  await execute(
    "INSERT INTO `ServerAsset` (`id`,`type`,`name`,`url`,`autoDiscovered`,`monitorEnabled`,`status`) VALUES (?,?,?,?,?,?,?)",
    [createId(), "domain", host, `https://${host}`, false, true, "active"],
  );
  return host;
}
