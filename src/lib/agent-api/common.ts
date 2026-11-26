import "server-only";
import type { DateRange } from "@/lib/dates";

/** An error carrying an HTTP status for the Agent API handler. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** The person an action runs as (delegated keys), or null for a key-only call. */
export interface AgentUser {
  email: string;
  name: string;
  role: "admin" | "user";
  accessScope: "full" | "invoice_only";
}

export const MAX_LIMIT = 200;
const MAX_RANGE_DAYS = 400;

/** Today as YYYY-MM-DD in UTC (data is stored/queried in UTC). */
export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD / "today" / "yesterday" value, or return `fallback`. */
export function isoDate(value: unknown, name: string, fallback: string): string {
  if (value == null || value === "") return fallback;
  const s = String(value).trim().toLowerCase();
  if (s === "today") return todayUtc();
  if (s === "yesterday") return addDays(todayUtc(), -1);
  const ok =
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s + "T00:00:00Z")) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
  if (!ok) throw new ApiError(400, `${name} must be a date as YYYY-MM-DD, "today" or "yesterday"`);
  return s;
}

/** A {from,to} window plus a day-granularity DateRange, bounded to MAX_RANGE_DAYS. */
export function dateRange(
  query: Record<string, string>,
  { defaultDays = 28 }: { defaultDays?: number } = {},
): { from: string; to: string; range: DateRange } {
  const to = isoDate(query.to, "to", todayUtc());
  const from = isoDate(query.from, "from", addDays(to, -(defaultDays - 1)));
  if (from > to) throw new ApiError(400, "from must be on or before to");
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  if (span > MAX_RANGE_DAYS) throw new ApiError(400, `The date range can be at most ${MAX_RANGE_DAYS} days`);
  return {
    from,
    to,
    range: { start: new Date(from + "T00:00:00.000Z"), end: new Date(to + "T23:59:59.999Z") },
  };
}

/** A positive integer limit, default 50, capped at MAX_LIMIT. */
export function limitParam(value: unknown, fallback = 50): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "limit must be a positive whole number");
  return Math.min(n, MAX_LIMIT);
}

/** Validate a value against an optional enum; returns it trimmed, or null when blank. */
export function enumParam(value: unknown, name: string, allowed: readonly string[]): string | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!allowed.includes(s)) throw new ApiError(400, `${name} must be one of: ${allowed.join(", ")}`);
  return s;
}

/** Trimmed free text used in a LIKE search (wildcards escaped), or null when blank. */
export function likeParam(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  return "%" + String(value).trim().replace(/[\\%_]/g, "\\$&").slice(0, 100) + "%";
}
