import "server-only";
import { query, queryOne } from "./db";
import { type DateRange, previousPeriod, toISODate } from "./dates";
import { percentChange, safeDivide } from "./utils";
import { eachDayLabels } from "./series";
import { type DataScope, demoFilter, metricsScope } from "./data-scope";
import type { WebsitePage } from "./models";

export interface SeoSummary {
  clicks: number;
  impressions: number;
  ctr: number; // 0-1
  position: number;
  hasData: boolean;
  isDemo: boolean;
}

export interface AnalyticsSummary {
  views: number;
  activeUsers: number;
  sessions: number;
  engagedSessions: number;
  engagementRate: number; // 0-1
  avgEngagementSecs: number;
  hasData: boolean;
  isDemo: boolean;
}

/** Aggregate GSC metrics for a range. pageId null = site-wide aggregate rows. */
export async function getSeoSummary(
  range: DateRange,
  opts: { pageId?: string | null; scope?: DataScope } = {},
): Promise<SeoSummary> {
  const scope = opts.scope ?? (await metricsScope());
  const rows = await query<{ clicks: number; impressions: number; position: number; isDemo: boolean }>(
    "SELECT `clicks`, `impressions`, `position`, `isDemo` FROM `SeoSnapshot` " +
      "WHERE `startDate` >= ? AND `startDate` <= ? AND `pageId` <=> ? AND `query` IS NULL AND `isDemo` = ?",
    [range.start, range.end, opts.pageId ?? null, demoFilter(scope)],
  );
  if (rows.length === 0) {
    return { clicks: 0, impressions: 0, ctr: 0, position: 0, hasData: false, isDemo: false };
  }
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  // Impression-weighted average position.
  const weighted = rows.reduce((s, r) => s + r.position * r.impressions, 0);
  const position = impressions > 0 ? weighted / impressions : 0;
  return {
    clicks,
    impressions,
    ctr: safeDivide(clicks, impressions) ?? 0,
    position,
    hasData: true,
    isDemo: rows.some((r) => r.isDemo),
  };
}

export async function getAnalyticsSummary(
  range: DateRange,
  opts: { pageId?: string | null; scope?: DataScope } = {},
): Promise<AnalyticsSummary> {
  const scope = opts.scope ?? (await metricsScope());
  const rows = await query<{
    views: number; activeUsers: number; sessions: number; engagedSessions: number;
    avgEngagementSecs: number; isDemo: boolean;
  }>(
    "SELECT `views`, `activeUsers`, `sessions`, `engagedSessions`, `avgEngagementSecs`, `isDemo` FROM `AnalyticsSnapshot` " +
      "WHERE `startDate` >= ? AND `startDate` <= ? AND `pageId` <=> ? AND `channel` IS NULL AND `isDemo` = ?",
    [range.start, range.end, opts.pageId ?? null, demoFilter(scope)],
  );
  if (rows.length === 0) {
    return {
      views: 0, activeUsers: 0, sessions: 0, engagedSessions: 0,
      engagementRate: 0, avgEngagementSecs: 0, hasData: false, isDemo: false,
    };
  }
  const views = rows.reduce((s, r) => s + r.views, 0);
  const activeUsers = rows.reduce((s, r) => s + r.activeUsers, 0);
  const sessions = rows.reduce((s, r) => s + r.sessions, 0);
  const engagedSessions = rows.reduce((s, r) => s + r.engagedSessions, 0);
  const avgEngagementSecs =
    rows.reduce((s, r) => s + r.avgEngagementSecs, 0) / rows.length;
  return {
    views, activeUsers, sessions, engagedSessions,
    engagementRate: safeDivide(engagedSessions, sessions) ?? 0,
    avgEngagementSecs,
    hasData: true,
    isDemo: rows.some((r) => r.isDemo),
  };
}

/** Summary plus percent change vs a comparison period (default: previous period). */
export async function getSeoWithComparison(
  range: DateRange,
  opts: { pageId?: string | null; compareRange?: DateRange } = {},
) {
  const prev = opts.compareRange ?? previousPeriod(range);
  // Resolve the scope once so the current and previous periods are always on
  // the same side (both real or both demo) — never one of each.
  const scope = await metricsScope();
  const [current, previous] = await Promise.all([
    getSeoSummary(range, { pageId: opts.pageId, scope }),
    getSeoSummary(prev, { pageId: opts.pageId, scope }),
  ]);
  return {
    current,
    previous,
    delta: {
      clicks: percentChange(current.clicks, previous.hasData ? previous.clicks : null),
      impressions: percentChange(current.impressions, previous.hasData ? previous.impressions : null),
      ctr: percentChange(current.ctr, previous.hasData ? previous.ctr : null),
      position: percentChange(current.position, previous.hasData ? previous.position : null),
    },
  };
}

export async function getAnalyticsWithComparison(
  range: DateRange,
  opts: { pageId?: string | null; compareRange?: DateRange } = {},
) {
  const prev = opts.compareRange ?? previousPeriod(range);
  // Resolve the scope once so the current and previous periods match.
  const scope = await metricsScope();
  const [current, previous] = await Promise.all([
    getAnalyticsSummary(range, { pageId: opts.pageId, scope }),
    getAnalyticsSummary(prev, { pageId: opts.pageId, scope }),
  ]);
  return {
    current,
    previous,
    delta: {
      views: percentChange(current.views, previous.hasData ? previous.views : null),
      activeUsers: percentChange(current.activeUsers, previous.hasData ? previous.activeUsers : null),
      sessions: percentChange(current.sessions, previous.hasData ? previous.sessions : null),
      engagementRate: percentChange(current.engagementRate, previous.hasData ? previous.engagementRate : null),
    },
  };
}

export interface TrendPoint {
  date: string;
  clicks?: number;
  impressions?: number;
  views?: number;
  activeUsers?: number;
}

/** Daily combined trend (clicks/impressions/views/users) for charts. */
export async function getTrend(
  range: DateRange,
  opts: { pageId?: string | null; scope?: DataScope } = {},
): Promise<TrendPoint[]> {
  const scope = opts.scope ?? (await metricsScope());
  const [seo, ga] = await Promise.all([
    query<{ startDate: Date; clicks: number; impressions: number }>(
      "SELECT `startDate`, `clicks`, `impressions` FROM `SeoSnapshot` " +
        "WHERE `startDate` >= ? AND `startDate` <= ? AND `pageId` <=> ? AND `query` IS NULL AND `isDemo` = ? " +
        "ORDER BY `startDate` ASC",
      [range.start, range.end, opts.pageId ?? null, demoFilter(scope)],
    ),
    query<{ startDate: Date; views: number; activeUsers: number }>(
      "SELECT `startDate`, `views`, `activeUsers` FROM `AnalyticsSnapshot` " +
        "WHERE `startDate` >= ? AND `startDate` <= ? AND `pageId` <=> ? AND `channel` IS NULL AND `isDemo` = ? " +
        "ORDER BY `startDate` ASC",
      [range.start, range.end, opts.pageId ?? null, demoFilter(scope)],
    ),
  ]);

  const map = new Map<string, TrendPoint>();
  for (const label of eachDayLabels(range)) {
    map.set(label.iso, { date: label.short, clicks: 0, impressions: 0, views: 0, activeUsers: 0 });
  }
  for (const r of seo) {
    const iso = toISODate(r.startDate);
    const p = map.get(iso);
    if (p) {
      p.clicks = (p.clicks ?? 0) + r.clicks;
      p.impressions = (p.impressions ?? 0) + r.impressions;
    }
  }
  for (const r of ga) {
    const iso = toISODate(r.startDate);
    const p = map.get(iso);
    if (p) {
      p.views = (p.views ?? 0) + r.views;
      p.activeUsers = (p.activeUsers ?? 0) + r.activeUsers;
    }
  }
  return [...map.values()];
}

/** Top landing pages by clicks for a range (site-wide page rows). */
export async function getTopPages(range: DateRange, limit = 8, opts: { scope?: DataScope } = {}) {
  const scope = opts.scope ?? (await metricsScope());
  const rows = await query<{ pageId: string; clicks: string | number; impressions: string | number }>(
    "SELECT `pageId`, SUM(`clicks`) AS `clicks`, SUM(`impressions`) AS `impressions` FROM `SeoSnapshot` " +
      "WHERE `startDate` >= ? AND `startDate` <= ? AND `pageId` IS NOT NULL AND `query` IS NULL AND `isDemo` = ? " +
      "GROUP BY `pageId` ORDER BY SUM(`clicks`) DESC LIMIT ?",
    [range.start, range.end, demoFilter(scope), limit],
  );
  const pageIds = rows.map((r) => r.pageId).filter(Boolean);
  let pageMap = new Map<string, WebsitePage>();
  if (pageIds.length > 0) {
    const placeholders = pageIds.map(() => "?").join(", ");
    const pages = await query<WebsitePage>(
      `SELECT * FROM \`WebsitePage\` WHERE \`id\` IN (${placeholders})`,
      pageIds,
    );
    pageMap = new Map(pages.map((p) => [p.id, p]));
  }
  return rows.map((r) => {
    const clicks = Number(r.clicks ?? 0);
    const impressions = Number(r.impressions ?? 0);
    return {
      page: pageMap.get(r.pageId),
      clicks,
      impressions,
      ctr: safeDivide(clicks, impressions) ?? 0,
    };
  });
}

/** The most recent day that has site-wide SEO/GA data for the current scope. */
export async function getLatestDataDate(): Promise<Date | null> {
  const scope = await metricsScope();
  const demo = demoFilter(scope);
  const row = await queryOne<{ d: Date | null }>(
    "SELECT MAX(`d`) AS `d` FROM (" +
      "SELECT MAX(`startDate`) AS `d` FROM `SeoSnapshot` WHERE `isDemo`=? AND `query` IS NULL AND `pageId` IS NULL " +
      "UNION ALL " +
      "SELECT MAX(`startDate`) AS `d` FROM `AnalyticsSnapshot` WHERE `isDemo`=? AND `channel` IS NULL AND `pageId` IS NULL" +
      ") t",
    [demo, demo],
  );
  return row?.d ?? null;
}

/** Whether any non-demo SEO/GA data exists (for honest "connected" messaging). */
export async function hasRealMetrics(): Promise<boolean> {
  const seo = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM `SeoSnapshot` WHERE `isDemo` = ?", [false]);
  const ga = await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM `AnalyticsSnapshot` WHERE `isDemo` = ?", [false]);
  return Number(seo?.c ?? 0) + Number(ga?.c ?? 0) > 0;
}
