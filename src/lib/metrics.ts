import "server-only";
import { prisma } from "./prisma";
import { type DateRange, previousPeriod, toISODate } from "./dates";
import { percentChange, safeDivide } from "./utils";
import { eachDayLabels } from "./series";
import { type DataScope, demoFilter, metricsScope } from "./data-scope";

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
  const rows = await prisma.seoSnapshot.findMany({
    where: {
      startDate: { gte: range.start, lte: range.end },
      pageId: opts.pageId ?? null,
      query: null,
      isDemo: demoFilter(scope),
    },
    select: { clicks: true, impressions: true, position: true, isDemo: true },
  });
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
  const rows = await prisma.analyticsSnapshot.findMany({
    where: {
      startDate: { gte: range.start, lte: range.end },
      pageId: opts.pageId ?? null,
      channel: null,
      isDemo: demoFilter(scope),
    },
    select: {
      views: true, activeUsers: true, sessions: true, engagedSessions: true,
      avgEngagementSecs: true, isDemo: true,
    },
  });
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

/** Summary plus percent change vs the equivalent previous period. */
export async function getSeoWithComparison(range: DateRange, opts: { pageId?: string | null } = {}) {
  const prev = previousPeriod(range);
  // Resolve the scope once so the current and previous periods are always on
  // the same side (both real or both demo) — never one of each.
  const scope = await metricsScope();
  const [current, previous] = await Promise.all([
    getSeoSummary(range, { ...opts, scope }),
    getSeoSummary(prev, { ...opts, scope }),
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

export async function getAnalyticsWithComparison(range: DateRange, opts: { pageId?: string | null } = {}) {
  const prev = previousPeriod(range);
  // Resolve the scope once so the current and previous periods match.
  const scope = await metricsScope();
  const [current, previous] = await Promise.all([
    getAnalyticsSummary(range, { ...opts, scope }),
    getAnalyticsSummary(prev, { ...opts, scope }),
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
    prisma.seoSnapshot.findMany({
      where: { startDate: { gte: range.start, lte: range.end }, pageId: opts.pageId ?? null, query: null, isDemo: demoFilter(scope) },
      select: { startDate: true, clicks: true, impressions: true },
      orderBy: { startDate: "asc" },
    }),
    prisma.analyticsSnapshot.findMany({
      where: { startDate: { gte: range.start, lte: range.end }, pageId: opts.pageId ?? null, channel: null, isDemo: demoFilter(scope) },
      select: { startDate: true, views: true, activeUsers: true },
      orderBy: { startDate: "asc" },
    }),
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
  const rows = await prisma.seoSnapshot.groupBy({
    by: ["pageId"],
    where: {
      startDate: { gte: range.start, lte: range.end },
      pageId: { not: null },
      query: null,
      isDemo: demoFilter(scope),
    },
    _sum: { clicks: true, impressions: true },
    orderBy: { _sum: { clicks: "desc" } },
    take: limit,
  });
  const pageIds = rows.map((r) => r.pageId!).filter(Boolean);
  const pages = await prisma.websitePage.findMany({ where: { id: { in: pageIds } } });
  const pageMap = new Map(pages.map((p) => [p.id, p]));
  return rows.map((r) => {
    const clicks = r._sum.clicks ?? 0;
    const impressions = r._sum.impressions ?? 0;
    return {
      page: pageMap.get(r.pageId!),
      clicks,
      impressions,
      ctr: safeDivide(clicks, impressions) ?? 0,
    };
  });
}

/** Whether any non-demo SEO/GA data exists (for honest "connected" messaging). */
export async function hasRealMetrics(): Promise<boolean> {
  const real = await prisma.seoSnapshot.count({ where: { isDemo: false } });
  const realGa = await prisma.analyticsSnapshot.count({ where: { isDemo: false } });
  return real + realGa > 0;
}
