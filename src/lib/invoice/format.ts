/**
 * Display formatting for the Invoice Agent. Money arrives as DECIMAL strings
 * (never JS floats) and is formatted for display only.
 */

const CURRENCY_SYMBOL: Record<string, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export function fmtMoney(value: string | null | undefined, currency = "INR"): string {
  if (value == null || value === "") return "—";
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const neg = value.startsWith("-");
  const [intPart, frac = "00"] = (neg ? value.slice(1) : value).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${sym}${grouped}.${frac.padEnd(2, "0").slice(0, 2)}`;
}

/** Format a DATE/DATETIME value (string or Date) as e.g. "21 Nov 2026". */
export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** YYYY-MM-DD for a Date (UTC), for <input type="date"> and DATE columns. */
export function toDateInput(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Current Indian financial year label, e.g. "2026-2027" (Apr–Mar). */
export function currentFinancialYear(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0=Jan
  const start = m >= 3 ? y : y - 1; // FY starts in April
  return `${start}-${start + 1}`;
}
