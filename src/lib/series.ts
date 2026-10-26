import { eachDayOfInterval, format } from "date-fns";
import { type DateRange, toISODate } from "./dates";

export interface DayLabel {
  iso: string; // yyyy-MM-dd
  short: string; // e.g. "14 Oct"
}

/** Enumerate each day in a range with an ISO key and a short display label. */
export function eachDayLabels(range: DateRange): DayLabel[] {
  const days = eachDayOfInterval({ start: range.start, end: range.end });
  return days.map((d) => ({ iso: toISODate(d), short: format(d, "d MMM") }));
}
