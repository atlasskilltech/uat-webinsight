import {
  format,
  formatDistanceToNow,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  differenceInCalendarDays,
  isValid,
  parseISO,
} from "date-fns";

export function fmtDate(date?: Date | string | null, pattern = "d MMM yyyy"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "—";
  return format(d, pattern);
}

export function fmtDateTime(date?: Date | string | null): string {
  return fmtDate(date, "d MMM yyyy, HH:mm");
}

export function fmtRelative(date?: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseISO(date) : date;
  if (!isValid(d)) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
}

export interface DateRange {
  start: Date;
  end: Date;
  /**
   * Row granularity this range queries. "day" (default) reads daily snapshots;
   * "hour" reads the hourly breakdown used by the Search Console-style
   * "24 hours" view. It flows through previousPeriod so a comparison period
   * matches the main range.
   */
  granularity?: "day" | "hour";
}

/** The current week (Mon–Sun). */
export function thisWeek(now = new Date()): DateRange {
  return {
    start: startOfWeek(now, { weekStartsOn: 1 }),
    end: endOfWeek(now, { weekStartsOn: 1 }),
  };
}

export function lastWeek(now = new Date()): DateRange {
  const prev = subWeeks(now, 1);
  return {
    start: startOfWeek(prev, { weekStartsOn: 1 }),
    end: endOfWeek(prev, { weekStartsOn: 1 }),
  };
}

export function thisMonth(now = new Date()): DateRange {
  return { start: startOfMonth(now), end: endOfMonth(now) };
}

/** A trailing N-day window ending today (inclusive). */
export function lastNDays(n: number, now = new Date()): DateRange {
  return { start: subDays(now, n - 1), end: now };
}

/** A trailing N-month window ending now (used by the SEO date-range picker). */
export function lastNMonths(n: number, now = new Date()): DateRange {
  return { start: subMonths(now, n), end: now };
}

/** The equivalent window immediately before the given range. */
export function previousPeriod(range: DateRange): DateRange {
  // Hourly ranges compare against the immediately preceding window of the same
  // length (e.g. the previous 24 hours), not a calendar-day shift.
  if (range.granularity === "hour") {
    const ms = range.end.getTime() - range.start.getTime();
    return {
      start: new Date(range.start.getTime() - ms),
      end: new Date(range.end.getTime() - ms),
      granularity: "hour",
    };
  }
  const days = differenceInCalendarDays(range.end, range.start) + 1;
  return {
    start: subDays(range.start, days),
    end: subDays(range.end, days),
  };
}

/** ISO key truncated to the hour (yyyy-MM-ddTHH, UTC) — the hourly bucket id. */
export function toISOHour(date: Date): string {
  return date.toISOString().slice(0, 13);
}

/** A trailing N-hour window ending now, tagged for hourly granularity. */
function trailingHours(hours: number): DateRange {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3_600_000);
  return { start, end, granularity: "hour" };
}

export function rangeLabel(range: DateRange): string {
  return `${fmtDate(range.start)} – ${fmtDate(range.end)}`;
}

export function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Resolve a URL range key (7d/28d/90d/this_week/this_month) to a DateRange. */
export function resolveRange(key?: string | null): { range: DateRange; key: string } {
  switch (key) {
    case "7d": return { range: lastNDays(7), key: "7d" };
    case "90d": return { range: lastNDays(90), key: "90d" };
    case "this_week": return { range: thisWeek(), key: "this_week" };
    case "this_month": return { range: thisMonth(), key: "this_month" };
    case "28d":
    default: return { range: lastNDays(28), key: "28d" };
  }
}

/** Start of the given day in UTC (snapshots are stored at UTC midnight). */
function startOfUtcDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

/** The full UTC day containing `d` (00:00:00 — 23:59:59.999). */
export function utcDayWindow(d: Date): DateRange {
  const start = new Date(d);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * A trailing window whose start is snapped to the beginning of the UTC day, so
 * daily snapshots stored at UTC midnight are always included (otherwise a
 * window starting at the current time-of-day would drop that day's row — which
 * made "24 hours" show nothing).
 */
function trailingDays(days: number): DateRange {
  return { start: startOfUtcDay(subDays(new Date(), days)), end: new Date() };
}
function trailingMonths(months: number): DateRange {
  return { start: startOfUtcDay(subMonths(new Date(), months)), end: new Date() };
}

/**
 * Preset keys offered by the SEO & Analytics date-range picker (Search
 * Console-style): short day windows plus trailing-month windows. Each carries a
 * `resolve()` that builds the concrete DateRange.
 */
export const SEO_RANGE_PRESETS = [
  { key: "24h", label: "24 hours", resolve: () => trailingHours(24) },
  { key: "7d", label: "7 days", resolve: () => trailingDays(7) },
  { key: "28d", label: "28 days", resolve: () => trailingDays(28) },
  { key: "3mo", label: "3 months", resolve: () => trailingMonths(3) },
  { key: "6mo", label: "6 months", resolve: () => trailingMonths(6) },
  { key: "12mo", label: "12 months", resolve: () => trailingMonths(12) },
  { key: "16mo", label: "16 months", resolve: () => trailingMonths(16) },
] as const;

export const SEO_DEFAULT_RANGE_KEY = "6mo";

export interface SeoRangeResolution {
  range: DateRange;
  key: string; // 6mo | 12mo | 16mo | custom
  custom: { start: string; end: string } | null; // ISO yyyy-mm-dd when key === custom
  invalid: boolean; // true when a custom range was supplied but failed validation
}

/**
 * Resolve the SEO page's URL params into a concrete DateRange.
 *  - Presets 6mo / 12mo / 16mo map to trailing month windows.
 *  - key === "custom" reads `start`/`end` (yyyy-mm-dd) and validates them:
 *    both must be valid dates and end must not precede start. On failure it
 *    falls back to the default range and sets `invalid` so the UI can explain.
 */
export function resolveSeoRange(sp: {
  range?: string | null;
  start?: string | null;
  end?: string | null;
}): SeoRangeResolution {
  const key = sp.range ?? SEO_DEFAULT_RANGE_KEY;

  if (key === "custom") {
    const start = sp.start ? parseISO(sp.start) : null;
    const end = sp.end ? parseISO(sp.end) : null;
    const ok = !!start && !!end && isValid(start) && isValid(end) && end >= start;
    if (ok) {
      const s = new Date(start!);
      s.setHours(0, 0, 0, 0);
      const e = new Date(end!);
      e.setHours(23, 59, 59, 999);
      return {
        range: { start: s, end: e },
        key: "custom",
        custom: { start: toISODate(s), end: toISODate(e) },
        invalid: false,
      };
    }
    return { range: lastNMonths(6), key: SEO_DEFAULT_RANGE_KEY, custom: null, invalid: true };
  }

  const preset = SEO_RANGE_PRESETS.find((p) => p.key === key);
  return {
    range: preset ? preset.resolve() : lastNMonths(6),
    key: preset?.key ?? SEO_DEFAULT_RANGE_KEY,
    custom: null,
    invalid: false,
  };
}

/** How the comparison period is chosen on the SEO page. */
export type CompareMode = "previous" | "yoy" | "custom";

export const SEO_COMPARE_PRESETS = [
  { key: "previous", label: "Previous period" },
  { key: "yoy", label: "Year over year" },
  { key: "custom", label: "Custom" },
] as const;

export interface SeoCompareResolution {
  compareRange: DateRange;
  mode: CompareMode;
  custom: { start: string; end: string } | null;
  invalid: boolean;
}

/**
 * Resolve the comparison period from the URL (`cmp`, plus `cmpStart`/`cmpEnd`
 * for a custom compare) relative to the main range:
 *  - "previous" (default) — the equivalent window immediately before `range`.
 *  - "yoy" — the same window one year earlier.
 *  - "custom" — explicit `cmpStart`/`cmpEnd`; falls back to "previous" if invalid.
 */
export function resolveSeoCompare(
  sp: { cmp?: string | null; cmpStart?: string | null; cmpEnd?: string | null },
  range: DateRange,
): SeoCompareResolution {
  const mode = (sp.cmp as CompareMode) ?? "previous";

  if (mode === "yoy") {
    return {
      compareRange: { start: subYears(range.start, 1), end: subYears(range.end, 1) },
      mode: "yoy",
      custom: null,
      invalid: false,
    };
  }

  if (mode === "custom") {
    const start = sp.cmpStart ? parseISO(sp.cmpStart) : null;
    const end = sp.cmpEnd ? parseISO(sp.cmpEnd) : null;
    const ok = !!start && !!end && isValid(start) && isValid(end) && end >= start;
    if (ok) {
      const s = new Date(start!);
      s.setHours(0, 0, 0, 0);
      const e = new Date(end!);
      e.setHours(23, 59, 59, 999);
      return { compareRange: { start: s, end: e }, mode: "custom", custom: { start: toISODate(s), end: toISODate(e) }, invalid: false };
    }
    return { compareRange: previousPeriod(range), mode: "previous", custom: null, invalid: true };
  }

  return { compareRange: previousPeriod(range), mode: "previous", custom: null, invalid: false };
}

/** Short phrase describing the comparison period, for the page description. */
export function compareLabel(mode: CompareMode): string {
  return mode === "yoy" ? "the same period last year" : mode === "custom" ? "a custom period" : "the previous period";
}

export const PRESET_RANGES = [
  { key: "7d", label: "Last 7 days", resolve: () => lastNDays(7) },
  { key: "28d", label: "Last 28 days", resolve: () => lastNDays(28) },
  { key: "90d", label: "Last 90 days", resolve: () => lastNDays(90) },
  { key: "this_week", label: "This week", resolve: () => thisWeek() },
  { key: "this_month", label: "This month", resolve: () => thisMonth() },
] as const;

export { subDays, subMonths, differenceInCalendarDays };
