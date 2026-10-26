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
  const days = differenceInCalendarDays(range.end, range.start) + 1;
  return {
    start: subDays(range.start, days),
    end: subDays(range.end, days),
  };
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

/** Preset keys offered by the SEO & Analytics date-range picker. */
export const SEO_RANGE_PRESETS = [
  { key: "6mo", label: "Last 6 months", months: 6 },
  { key: "12mo", label: "Last 12 months", months: 12 },
  { key: "16mo", label: "Last 16 months", months: 16 },
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
  const months = preset?.months ?? 6;
  return { range: lastNMonths(months), key: preset?.key ?? SEO_DEFAULT_RANGE_KEY, custom: null, invalid: false };
}

export const PRESET_RANGES = [
  { key: "7d", label: "Last 7 days", resolve: () => lastNDays(7) },
  { key: "28d", label: "Last 28 days", resolve: () => lastNDays(28) },
  { key: "90d", label: "Last 90 days", resolve: () => lastNDays(90) },
  { key: "this_week", label: "This week", resolve: () => thisWeek() },
  { key: "this_month", label: "This month", resolve: () => thisMonth() },
] as const;

export { subDays, subMonths, differenceInCalendarDays };
