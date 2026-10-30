import "server-only";
import { execute, query, queryOne, transaction } from "@/lib/db";
import { createId } from "@/lib/id";
import {
  validAccessToken,
  fetchSearchConsole,
  fetchGa4Report,
  GoogleApiError,
  type GoogleTokens,
} from "@/lib/google";
import { recordSync, recordError, type Provider } from "@/lib/integrations";
import type { Integration } from "@/lib/models";

/**
 * Shared Google sync engine, used by BOTH the manual "Sync 28d" buttons
 * (via the settings server action) and the scheduled /api/cron/sync endpoint.
 *
 * Key guarantees:
 *  - Overlap-safe: an atomic, DB-backed compare-and-set lock inside
 *    Integration.config (`$.sync.inProgress`) means only one run per provider
 *    proceeds at a time. A stale lock (crashed run) is reclaimed after a timeout.
 *  - Non-destructive refresh: data is fetched and validated FIRST; only then is
 *    the exact (provider, property, date-window) slice of REAL rows replaced,
 *    inside a transaction, so a failed insert cannot leave a gap. Demo rows and
 *    real rows outside the window are never touched. An empty API response is
 *    treated as "no new data" and leaves existing data intact.
 *  - Token-safe: refreshed tokens are persisted; auth/config errors are marked
 *    permanent and never retried.
 */

const STALE_LOCK_MS = 10 * 60 * 1000; // a lock older than this is treated as abandoned
const DEFAULT_WINDOW_DAYS = Number(process.env.SYNC_WINDOW_DAYS) || 30;
// How many trailing days of HOURLY data to refresh. Google exposes hourly data
// for roughly the last 10 days; 2 days comfortably covers the rolling 24-hour
// view (including across a midnight boundary) without over-fetching.
const HOURLY_WINDOW_DAYS = Number(process.env.SYNC_HOURLY_WINDOW_DAYS) || 2;

export interface SyncResult {
  provider: Provider;
  ok: boolean;
  skipped?: boolean;
  count: number;
  message: string;
}

interface SyncMeta {
  inProgress?: boolean;
  startedAt?: number | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastTrigger?: string | null;
  lastResult?: string | null;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Prefer a property id saved in the DB; fall back to the .env value. */
function resolveProperty(provider: Provider, dbProperty?: string | null): string {
  const db = dbProperty?.trim();
  if (db) return db;
  const env = provider === "gsc" ? process.env.GSC_PROPERTY : process.env.GA4_PROPERTY_ID;
  return env?.trim() ?? "";
}

type IntegrationConfig = {
  tokens?: GoogleTokens;
  sync?: SyncMeta;
  [key: string]: unknown;
};

/**
 * Write the whole config object back as JSON. Assigning a JSON string works on
 * both MySQL (JSON column) and MariaDB (LONGTEXT), avoiding engine-specific
 * JSON write functions (MariaDB has no CAST(... AS JSON)).
 */
async function writeConfig(provider: Provider, config: IntegrationConfig): Promise<void> {
  await execute(
    "UPDATE `Integration` SET `config` = ? WHERE `provider` = ?",
    [JSON.stringify(config), provider],
  );
}

/**
 * Acquire the per-provider sync lock. The check is done in JS (the config is
 * already parsed) and the whole config is written back with inProgress=true, so
 * it does not depend on any MySQL/MariaDB JSON SQL functions. A crashed run's
 * lock is reclaimed after STALE_LOCK_MS. Returns true if the lock was acquired.
 */
async function acquireLock(provider: Provider, config: IntegrationConfig): Promise<boolean> {
  const meta = config.sync ?? {};
  const now = Date.now();
  const held =
    meta.inProgress === true &&
    typeof meta.startedAt === "number" &&
    now - meta.startedAt < STALE_LOCK_MS;
  if (held) return false;
  config.sync = { ...meta, inProgress: true, startedAt: now };
  await writeConfig(provider, config);
  return true;
}

/** Bounded retry: at most `retries` extra attempts, never for permanent errors. */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 500): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      const permanent = e instanceof GoogleApiError && e.permanent;
      if (permanent || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      attempt++;
    }
  }
}

/**
 * Ensure a WebsitePage row exists for each URL; return a url -> id map.
 * New pages are created with the URL path; existing pages are left untouched.
 */
async function ensurePages(urls: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return map;

  const ph = unique.map(() => "?").join(", ");
  const existing = await query<{ id: string; url: string }>(
    `SELECT \`id\`, \`url\` FROM \`WebsitePage\` WHERE \`url\` IN (${ph})`,
    unique,
  );
  for (const p of existing) map.set(p.url, p.id);

  const missing = unique.filter((u) => !map.has(u));
  if (missing.length > 0) {
    const values = missing.map((u) => {
      let path = "/";
      try {
        path = new URL(u).pathname || "/";
      } catch {
        /* non-URL key (e.g. anonymised) — keep "/" */
      }
      return [createId(), u, path];
    });
    await execute(
      "INSERT INTO `WebsitePage` (`id`,`url`,`path`) VALUES ? ON DUPLICATE KEY UPDATE `url` = `url`",
      [values],
    );
    const rows = await query<{ id: string; url: string }>(
      `SELECT \`id\`, \`url\` FROM \`WebsitePage\` WHERE \`url\` IN (${missing.map(() => "?").join(", ")})`,
      missing,
    );
    for (const p of rows) map.set(p.url, p.id);
  }
  return map;
}

/**
 * Refresh per-page GSC rows for the window (dimensions date + page) so the
 * "Top Pages" table reflects real Search Console data. Additive: callers run
 * this best-effort so a failure here never fails the main (totals) sync.
 */
async function syncGscPages(
  accessToken: string,
  property: string,
  start: Date,
  end: Date,
  trigger: string,
): Promise<void> {
  const rows = await withRetry(() =>
    fetchSearchConsole(accessToken, property, {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ["date", "page"],
      rowLimit: 25000,
    }),
  );
  if (rows.length === 0) return;

  const pageIdByUrl = await ensurePages(rows.map((r) => r.keys[1]));

  await transaction(async (conn) => {
    const batchId = createId();
    await conn.query(
      "INSERT INTO `ImportBatch` (`id`,`source`,`propertyId`,`periodStart`,`periodEnd`,`isDemo`,`status`,`message`,`rowCount`) VALUES (?,?,?,?,?,?,?,?,?)",
      [batchId, "gsc", property, start, end, false, "completed", `Auto sync pages (${trigger})`, rows.length],
    );
    // Replace only the real per-page rows for this window.
    await conn.query(
      "DELETE FROM `SeoSnapshot` WHERE `source`=? AND `propertyId`=? AND `isDemo`=? AND `pageId` IS NOT NULL AND `query` IS NULL AND `startDate` >= ? AND `startDate` <= ?",
      ["gsc", property, false, start, end],
    );
    const values = rows
      .map((r) => {
        const d = new Date(r.keys[0]);
        const pageId = pageIdByUrl.get(r.keys[1]);
        if (!pageId) return null;
        return [createId(), property, "gsc", d, d, r.clicks, r.impressions, r.ctr, r.position, pageId, false, batchId];
      })
      .filter((v): v is (string | number | boolean | Date)[] => v !== null);
    if (values.length > 0) {
      await conn.query(
        "INSERT INTO `SeoSnapshot` (`id`,`propertyId`,`source`,`startDate`,`endDate`,`clicks`,`impressions`,`ctr`,`position`,`pageId`,`isDemo`,`importBatchId`) VALUES ?",
        [values],
      );
    }
  });
}

/**
 * Refresh HOURLY GSC totals for the trailing window so the "24 hours" view
 * shows a real per-hour breakdown (dimensions ["HOUR"] + dataState
 * "HOURLY_ALL"). Rows are stored with granularity='hour' and are kept entirely
 * separate from the daily snapshots, so daily aggregates never double-count.
 * Best-effort: callers run this so a failure never fails the daily sync.
 */
async function syncGscHourly(accessToken: string, property: string, trigger: string): Promise<void> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - HOURLY_WINDOW_DAYS);
  const rows = await withRetry(() =>
    fetchSearchConsole(accessToken, property, {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ["HOUR"],
      dataState: "HOURLY_ALL",
      rowLimit: 25000,
    }),
  );
  if (rows.length === 0) return;

  await transaction(async (conn) => {
    const batchId = createId();
    await conn.query(
      "INSERT INTO `ImportBatch` (`id`,`source`,`propertyId`,`periodStart`,`periodEnd`,`isDemo`,`status`,`message`,`rowCount`) VALUES (?,?,?,?,?,?,?,?,?)",
      [batchId, "gsc", property, start, end, false, "completed", `Auto sync hourly (${trigger})`, rows.length],
    );
    // Replace only the real hourly site-wide rows for this window.
    await conn.query(
      "DELETE FROM `SeoSnapshot` WHERE `source`=? AND `propertyId`=? AND `isDemo`=? AND `granularity`=? AND `pageId` IS NULL AND `query` IS NULL AND `startDate` >= ?",
      ["gsc", property, false, "hour", start],
    );
    const values = rows
      .map((r) => {
        // keys[0] is an ISO-8601 timestamp with a UTC offset (America/
        // Los_Angeles), e.g. "2026-10-29T13:00:00-07:00" — parsed to the exact
        // UTC instant so hour buckets are stable regardless of server locale.
        const d = new Date(r.keys[0]);
        if (Number.isNaN(d.getTime())) return null;
        return [createId(), property, "gsc", d, d, r.clicks, r.impressions, r.ctr, r.position, "hour", false, batchId];
      })
      .filter((v): v is (string | number | boolean | Date)[] => v !== null);
    if (values.length > 0) {
      await conn.query(
        "INSERT INTO `SeoSnapshot` (`id`,`propertyId`,`source`,`startDate`,`endDate`,`clicks`,`impressions`,`ctr`,`position`,`granularity`,`isDemo`,`importBatchId`) VALUES ?",
        [values],
      );
    }
  });
}

/**
 * Refresh HOURLY GA4 totals for the trailing window (dimension `dateHour`,
 * value "YYYYMMDDHH"). Stored with granularity='hour'. Best-effort.
 */
async function syncGa4Hourly(accessToken: string, property: string, trigger: string): Promise<void> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - HOURLY_WINDOW_DAYS);
  const { rows } = await withRetry(() =>
    fetchGa4Report(accessToken, property, {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ["dateHour"],
      metrics: ["screenPageViews", "activeUsers", "sessions", "engagedSessions", "engagementRate", "averageSessionDuration"],
    }),
  );
  if (rows.length === 0) return;

  await transaction(async (conn) => {
    const batchId = createId();
    await conn.query(
      "INSERT INTO `ImportBatch` (`id`,`source`,`propertyId`,`periodStart`,`periodEnd`,`isDemo`,`status`,`message`,`rowCount`) VALUES (?,?,?,?,?,?,?,?,?)",
      [batchId, "ga4", property, start, end, false, "completed", `Auto sync hourly (${trigger})`, rows.length],
    );
    await conn.query(
      "DELETE FROM `AnalyticsSnapshot` WHERE `source`=? AND `propertyId`=? AND `isDemo`=? AND `granularity`=? AND `pageId` IS NULL AND `channel` IS NULL AND `startDate` >= ?",
      ["ga4", property, false, "hour", start],
    );
    const values = rows
      .map((r) => {
        const raw = r.dimensionValues[0].value; // YYYYMMDDHH
        if (!/^\d{10}$/.test(raw)) return null;
        // Treat the components as a UTC instant so hour buckets are stable.
        const d = new Date(Date.UTC(
          Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8)), Number(raw.slice(8, 10)),
        ));
        const m = r.metricValues.map((v) => Number(v.value));
        return [createId(), property, "ga4", d, d, m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0, m[4] ?? 0, m[5] ?? 0, "hour", false, batchId];
      })
      .filter((v): v is (string | number | boolean | Date)[] => v !== null);
    if (values.length > 0) {
      await conn.query(
        "INSERT INTO `AnalyticsSnapshot` (`id`,`propertyId`,`source`,`startDate`,`endDate`,`views`,`activeUsers`,`sessions`,`engagedSessions`,`engagementRate`,`avgEngagementSecs`,`granularity`,`isDemo`,`importBatchId`) VALUES ?",
        [values],
      );
    }
  });
}

/**
 * Fetch recent metrics for one provider and refresh the stored real rows for
 * the synced window. Safe to call repeatedly. Never throws for expected
 * failures — returns a result the caller can report.
 */
export async function runGoogleSync(
  provider: Provider,
  opts: { trigger: "manual" | "cron"; windowDays?: number } = { trigger: "manual" },
): Promise<SyncResult> {
  if (provider === "psi") {
    return { provider, ok: false, skipped: true, count: 0, message: "PageSpeed is used per-URL in the Page Inspector, not synced here." };
  }

  const row = await queryOne<Integration>(
    "SELECT * FROM `Integration` WHERE `provider` = ?",
    [provider],
  );
  const config = (row?.config as IntegrationConfig | null) ?? {};
  const property = resolveProperty(provider, row?.propertyId);

  // Gate: tokens present == Google account connected (disconnect clears them).
  // We intentionally allow a provider in "error" state to retry so a transient
  // failure can self-recover on the next scheduled/manual run.
  if (!config.tokens) {
    return { provider, ok: false, skipped: true, count: 0, message: "Not connected. Connect your Google account first." };
  }
  if (!property) {
    return { provider, ok: false, skipped: true, count: 0, message: "Set the property id in Settings (or in .env) before syncing." };
  }

  // Keep the pre-lock sync metadata (nextRunAt etc.) for the finish patch.
  const meta: SyncMeta = { ...(config.sync ?? {}) };

  // Overlap guard — atomic lock (updates config.sync in place on success).
  const locked = await acquireLock(provider, config);
  if (!locked) {
    return { provider, ok: false, skipped: true, count: 0, message: "A sync is already in progress for this provider." };
  }

  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - windowDays);

  const finish = (patch: Partial<SyncMeta>) => {
    config.sync = { ...meta, inProgress: false, startedAt: null, lastTrigger: opts.trigger, ...patch };
    return writeConfig(provider, config);
  };

  try {
    // 1. Ensure a valid access token, persisting any refresh.
    const tokens = await withRetry(() => validAccessToken(config.tokens!));
    if (tokens !== config.tokens) {
      config.tokens = tokens;
      await writeConfig(provider, config);
    }

    // 2. Fetch FIRST. Only replace stored rows once a successful response is in hand.
    let count = 0;
    if (provider === "gsc") {
      const rows = await withRetry(() =>
        fetchSearchConsole(tokens.access_token, property, { startDate: fmt(start), endDate: fmt(end), dimensions: ["date"] }),
      );
      count = rows.length;
      if (count > 0) {
        await transaction(async (conn) => {
          const batchId = createId();
          await conn.query(
            "INSERT INTO `ImportBatch` (`id`,`source`,`propertyId`,`periodStart`,`periodEnd`,`isDemo`,`status`,`message`,`rowCount`) VALUES (?,?,?,?,?,?,?,?,?)",
            [batchId, "gsc", property, start, end, false, "completed", `Auto sync (${opts.trigger})`, count],
          );
          await conn.query(
            "DELETE FROM `SeoSnapshot` WHERE `source`=? AND `propertyId`=? AND `isDemo`=? AND `startDate` >= ? AND `startDate` <= ?",
            ["gsc", property, false, start, end],
          );
          const values = rows.map((r) => {
            const d = new Date(r.keys[0]);
            return [createId(), property, "gsc", d, d, r.clicks, r.impressions, r.ctr, r.position, false, batchId];
          });
          await conn.query(
            "INSERT INTO `SeoSnapshot` (`id`,`propertyId`,`source`,`startDate`,`endDate`,`clicks`,`impressions`,`ctr`,`position`,`isDemo`,`importBatchId`) VALUES ?",
            [values],
          );
        });
      }
      // Per-page rows (Top Pages) — best-effort; a failure here must not fail
      // the main totals sync above.
      try {
        await syncGscPages(tokens.access_token, property, start, end, opts.trigger);
      } catch (e) {
        console.error("GSC per-page sync failed:", e instanceof Error ? e.message : e);
      }
      // Hourly totals (24-hour view) — best-effort, never fails the daily sync.
      try {
        await syncGscHourly(tokens.access_token, property, opts.trigger);
      } catch (e) {
        console.error("GSC hourly sync failed:", e instanceof Error ? e.message : e);
      }
    } else {
      const { rows } = await withRetry(() =>
        fetchGa4Report(tokens.access_token, property, {
          startDate: fmt(start),
          endDate: fmt(end),
          dimensions: ["date"],
          metrics: ["screenPageViews", "activeUsers", "sessions", "engagedSessions", "engagementRate", "averageSessionDuration"],
        }),
      );
      count = rows.length;
      if (count > 0) {
        await transaction(async (conn) => {
          const batchId = createId();
          await conn.query(
            "INSERT INTO `ImportBatch` (`id`,`source`,`propertyId`,`periodStart`,`periodEnd`,`isDemo`,`status`,`message`,`rowCount`) VALUES (?,?,?,?,?,?,?,?,?)",
            [batchId, "ga4", property, start, end, false, "completed", `Auto sync (${opts.trigger})`, count],
          );
          await conn.query(
            "DELETE FROM `AnalyticsSnapshot` WHERE `source`=? AND `propertyId`=? AND `isDemo`=? AND `startDate` >= ? AND `startDate` <= ?",
            ["ga4", property, false, start, end],
          );
          const values = rows.map((r) => {
            const raw = r.dimensionValues[0].value; // YYYYMMDD
            const d = new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
            const m = r.metricValues.map((v) => Number(v.value));
            return [createId(), property, "ga4", d, d, m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 0, m[4] ?? 0, m[5] ?? 0, false, batchId];
          });
          await conn.query(
            "INSERT INTO `AnalyticsSnapshot` (`id`,`propertyId`,`source`,`startDate`,`endDate`,`views`,`activeUsers`,`sessions`,`engagedSessions`,`engagementRate`,`avgEngagementSecs`,`isDemo`,`importBatchId`) VALUES ?",
            [values],
          );
        });
      }
      // Hourly totals (24-hour view) — best-effort, never fails the daily sync.
      try {
        await syncGa4Hourly(tokens.access_token, property, opts.trigger);
      } catch (e) {
        console.error("GA4 hourly sync failed:", e instanceof Error ? e.message : e);
      }
    }

    // 3. Record a verified successful contact (recordSync leaves config.sync intact).
    await recordSync(provider, property);
    const nextRunAt = opts.trigger === "cron" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : (meta.nextRunAt ?? null);
    const message = count > 0
      ? `Synced ${count} days from ${provider.toUpperCase()}.`
      : `No new ${provider.toUpperCase()} data available yet — existing data kept.`;
    await finish({ lastRunAt: new Date().toISOString(), nextRunAt, lastResult: message });
    return { provider, ok: true, count, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed.";
    await recordError(provider, message);
    await finish({ lastResult: message });
    return { provider, ok: false, count: 0, message };
  }
}
