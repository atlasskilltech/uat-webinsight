/**
 * Deterministic money & GST maths for the Invoice Agent.
 *
 * Monetary values are handled as BigInt minor units (2 dp, e.g. paise) — never
 * JavaScript floating point. MySQL DECIMAL columns are read as strings (the
 * invoice pool sets decimalNumbers:false) and parsed here. All rounding is
 * half-up. This module is the authoritative calculator; LLM-provided totals are
 * only ever cross-checked against it, never trusted.
 */

export type Cents = bigint; // 2-dp minor units

const SCALE2 = 100n;

/** Parse a DECIMAL string / number into Cents (2 dp). Throws on garbage. */
export function toCents(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined || value === "") return 0n;
  const s = typeof value === "number" ? value.toFixed(6) : String(value).trim();
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  if (!/^\d+(\.\d+)?$/.test(body)) {
    throw new Error(`Invalid monetary value: ${value}`);
  }
  const [intPart, fracRaw = ""] = body.split(".");
  const frac2 = (fracRaw + "00").slice(0, 2);
  const roundDigit = fracRaw.length > 2 ? fracRaw[2] : "0";
  let cents = BigInt(intPart) * SCALE2 + BigInt(frac2);
  if (roundDigit >= "5") cents += 1n; // half-up on the 3rd decimal
  return neg ? -cents : cents;
}

/** Format Cents as a DECIMAL(…,2) string for storage / display. */
export function fromCents(cents: Cents): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const int = abs / SCALE2;
  const frac = (abs % SCALE2).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${int.toString()}.${frac}`;
}

/** Half-up division of a BigInt by a positive BigInt divisor. */
function divHalfUp(numerator: bigint, divisor: bigint): bigint {
  const neg = numerator < 0n;
  const n = neg ? -numerator : numerator;
  const q = n / divisor;
  const r = n % divisor;
  const rounded = r * 2n >= divisor ? q + 1n : q;
  return neg ? -rounded : rounded;
}

export function addCents(...values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0n);
}

export function subCents(a: Cents, b: Cents): Cents {
  return a - b;
}

/**
 * unit_price (Cents, 2dp) × quantity (DECIMAL(…,3) string/number) → Cents,
 * rounded half-up. Quantity is parsed as milli-units (3 dp).
 */
export function multiplyByQuantity(unitPriceCents: Cents, quantity: string | number): Cents {
  const q = String(quantity).trim();
  const neg = q.startsWith("-");
  const body = neg ? q.slice(1) : q;
  if (!/^\d+(\.\d+)?$/.test(body || "0")) {
    throw new Error(`Invalid quantity: ${quantity}`);
  }
  const [intPart, fracRaw = ""] = (body || "0").split(".");
  const milli = BigInt(intPart) * 1000n + BigInt((fracRaw + "000").slice(0, 3));
  const product = divHalfUp(unitPriceCents * milli, 1000n);
  return neg ? -product : product;
}

/** amount (Cents) × ratePercent (DECIMAL(5,2) string/number) / 100 → Cents, half-up. */
export function percentOf(amountCents: Cents, ratePercent: string | number): Cents {
  // rate as hundredths of a percent to preserve 2-dp rate precision.
  const r = String(ratePercent).trim();
  const [intPart, fracRaw = ""] = r.split(".");
  const rateScaled = BigInt(intPart) * 100n + BigInt((fracRaw + "00").slice(0, 2)); // rate * 100
  // amount * (rate/100) = amount * rateScaled / 10000
  return divHalfUp(amountCents * rateScaled, 10000n);
}

export interface LineInput {
  quantity: string | number;
  unitPrice: string | number; // DECIMAL(…,2)
  discount?: string | number; // absolute amount, DECIMAL(…,2)
  gstRate?: string | number; // percent
  interState: boolean; // true -> IGST; false -> CGST+SGST
}

export interface LineComputed {
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  lineTotal: string;
}

/** Deterministically compute one line's taxable value, GST split and total. */
export function computeLine(input: LineInput): LineComputed {
  const gross = multiplyByQuantity(toCents(input.unitPrice), input.quantity);
  const discount = toCents(input.discount ?? 0);
  const taxable = gross - discount;
  const tax = percentOf(taxable, input.gstRate ?? 0);

  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;
  if (input.interState) {
    igst = tax;
  } else {
    cgst = divHalfUp(tax, 2n);
    sgst = tax - cgst; // ensure cgst + sgst == tax exactly
  }
  const lineTotal = taxable + cgst + sgst + igst;
  return {
    taxableValue: fromCents(taxable),
    cgst: fromCents(cgst),
    sgst: fromCents(sgst),
    igst: fromCents(igst),
    lineTotal: fromCents(lineTotal),
  };
}

export interface InvoiceTotalsInput {
  lines: LineInput[];
  otherCharges?: string | number;
  roundTotal?: boolean; // round grand total to nearest rupee, storing round_off
}

export interface InvoiceTotals {
  subtotal: string;
  discountTotal: string;
  taxableAmount: string;
  cgst: string;
  sgst: string;
  igst: string;
  taxTotal: string;
  otherCharges: string;
  roundOff: string;
  grandTotal: string;
}

/** Deterministically compute invoice-level totals from its lines. */
export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  let subtotal = 0n; // gross before discount
  let discountTotal = 0n;
  let taxable = 0n;
  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;

  for (const line of input.lines) {
    const gross = multiplyByQuantity(toCents(line.unitPrice), line.quantity);
    const discount = toCents(line.discount ?? 0);
    const c = computeLine(line);
    subtotal += gross;
    discountTotal += discount;
    taxable += toCents(c.taxableValue);
    cgst += toCents(c.cgst);
    sgst += toCents(c.sgst);
    igst += toCents(c.igst);
  }

  const taxTotal = cgst + sgst + igst;
  const other = toCents(input.otherCharges ?? 0);
  let grand = taxable + taxTotal + other;
  let roundOff = 0n;
  if (input.roundTotal) {
    const rem = grand % SCALE2;
    if (rem !== 0n) {
      const up = SCALE2 - rem;
      if (rem * 2n >= SCALE2) {
        roundOff = up;
        grand += up;
      } else {
        roundOff = -rem;
        grand -= rem;
      }
    }
  }

  return {
    subtotal: fromCents(subtotal),
    discountTotal: fromCents(discountTotal),
    taxableAmount: fromCents(taxable),
    cgst: fromCents(cgst),
    sgst: fromCents(sgst),
    igst: fromCents(igst),
    taxTotal: fromCents(taxTotal),
    otherCharges: fromCents(other),
    roundOff: fromCents(roundOff),
    grandTotal: fromCents(grand),
  };
}

/**
 * Cross-check an extracted/claimed grand total against the deterministic total.
 * Returns whether it matches within `toleranceCents` (default 1 paisa-free: 0).
 */
export function totalsMatch(
  claimed: string | number,
  computed: string | number,
  toleranceCents = 0n,
): boolean {
  const diff = toCents(claimed) - toCents(computed);
  const abs = diff < 0n ? -diff : diff;
  return abs <= toleranceCents;
}
