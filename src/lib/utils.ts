import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const numberFmt = new Intl.NumberFormat("en-US");
const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 12,345 */
export function formatNumber(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return numberFmt.format(value);
}

/** 12.3K */
export function formatCompact(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return compactFmt.format(value);
}

/** Accepts a ratio (0–1) OR an already-scaled percent and formats as "12.3%". */
export function formatPercent(
  value?: number | null,
  { ratio = true, digits = 1 }: { ratio?: boolean; digits?: number } = {},
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const pct = ratio ? value * 100 : value;
  return `${pct.toFixed(digits)}%`;
}

export function formatPosition(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

/** Convert minutes to a compact "2h 15m" string. */
export function formatDuration(minutes?: number | null): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Percentage change between two periods, correctly handling a zero or missing
 * denominator so we never divide by zero or invent a change.
 */
export function percentChange(
  current?: number | null,
  previous?: number | null,
): { value: number | null; label: string; direction: "up" | "down" | "flat" | "na" } {
  if (current == null || previous == null) {
    return { value: null, label: "—", direction: "na" };
  }
  if (previous === 0) {
    if (current === 0) return { value: 0, label: "0%", direction: "flat" };
    return { value: null, label: "New", direction: "up" };
  }
  const change = ((current - previous) / previous) * 100;
  const direction = change > 0.05 ? "up" : change < -0.05 ? "down" : "flat";
  return {
    value: change,
    label: `${change > 0 ? "+" : ""}${change.toFixed(1)}%`,
    direction,
  };
}

/** Safe division returning null instead of NaN/Infinity. */
export function safeDivide(a?: number | null, b?: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

export function truncate(text: string | null | undefined, length = 80): string {
  if (!text) return "";
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** Parse a value stored as Json into a string[] defensively. */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

export function initials(name?: string | null): string {
  if (!name) return "AU";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}
