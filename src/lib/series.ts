import { eachDayOfInterval, format } from "date-fns";
import { type DateRange, toISODate, toISOHour } from "./dates";

export interface DayLabel {
  iso: string; // yyyy-MM-dd
  short: string; // e.g. "14 Oct"
}

/** Enumerate each day in a range with an ISO key and a short display label. */
export function eachDayLabels(range: DateRange): DayLabel[] {
  const days = eachDayOfInterval({ start: range.start, end: range.end });
  return days.map((d) => ({ iso: toISODate(d), short: format(d, "d MMM") }));
}

/**
 * Enumerate each hour in a range, bucketed by UTC hour so Search Console
 * (stored as a true UTC instant) and GA4 hourly rows share one consistent
 * x-axis. The label is "HH:00" (UTC). Used by the 24-hour view.
 */
export function eachHourLabels(range: DateRange): DayLabel[] {
  const out: DayLabel[] = [];
  const start = new Date(range.start);
  start.setUTCMinutes(0, 0, 0);
  for (let t = start.getTime(); t <= range.end.getTime(); t += 3_600_000) {
    const d = new Date(t);
    out.push({ iso: toISOHour(d), short: `${String(d.getUTCHours()).padStart(2, "0")}:00` });
  }
  return out;
}
