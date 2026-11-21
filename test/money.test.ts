import { describe, it, expect } from "vitest";
import {
  toCents,
  fromCents,
  computeLine,
  computeInvoiceTotals,
  totalsMatch,
  multiplyByQuantity,
  percentOf,
} from "@/lib/invoice/money";

describe("money: parse/format (DECIMAL as BigInt minor units, no JS float)", () => {
  it("round-trips decimals", () => {
    expect(fromCents(toCents("1234.56"))).toBe("1234.56");
    expect(fromCents(toCents("0"))).toBe("0.00");
    expect(fromCents(toCents("1000000.99"))).toBe("1000000.99");
  });
  it("rounds the 3rd decimal half-up", () => {
    expect(fromCents(toCents("0.005"))).toBe("0.01");
    expect(fromCents(toCents("0.004"))).toBe("0.00");
  });
  it("rejects garbage", () => {
    expect(() => toCents("abc")).toThrow();
  });
});

describe("money: quantity and percent", () => {
  it("multiplies price by fractional quantity with half-up rounding", () => {
    expect(fromCents(multiplyByQuantity(toCents("33.33"), "1.5"))).toBe("50.00"); // 49.995 -> 50.00
    expect(fromCents(multiplyByQuantity(toCents("100.00"), "2"))).toBe("200.00");
  });
  it("computes a percentage half-up", () => {
    expect(fromCents(percentOf(toCents("200.00"), "18"))).toBe("36.00");
    expect(fromCents(percentOf(toCents("100.00"), "2.5"))).toBe("2.50");
  });
});

describe("money: line computation (GST split)", () => {
  it("intra-state splits CGST/SGST evenly", () => {
    expect(computeLine({ quantity: "2", unitPrice: "100.00", gstRate: "18", interState: false })).toEqual({
      taxableValue: "200.00",
      cgst: "18.00",
      sgst: "18.00",
      igst: "0.00",
      lineTotal: "236.00",
    });
  });
  it("inter-state uses IGST only", () => {
    expect(computeLine({ quantity: "1.5", unitPrice: "33.33", gstRate: "5", interState: true })).toEqual({
      taxableValue: "50.00",
      cgst: "0.00",
      sgst: "0.00",
      igst: "2.50",
      lineTotal: "52.50",
    });
  });
  it("keeps cgst+sgst exactly equal to the tax on odd amounts", () => {
    const c = computeLine({ quantity: "1", unitPrice: "100.01", gstRate: "18", interState: false });
    expect(c.cgst).toBe("9.00");
    expect(c.sgst).toBe("9.00");
    expect(c.lineTotal).toBe("118.01");
  });
  it("applies a line discount before tax", () => {
    const c = computeLine({ quantity: "1", unitPrice: "100.00", discount: "10.00", gstRate: "10", interState: true });
    expect(c.taxableValue).toBe("90.00");
    expect(c.igst).toBe("9.00");
    expect(c.lineTotal).toBe("99.00");
  });
});

describe("money: invoice totals", () => {
  it("sums lines deterministically", () => {
    const t = computeInvoiceTotals({
      lines: [
        { quantity: "2", unitPrice: "100.00", gstRate: "18", interState: false },
        { quantity: "1", unitPrice: "50.00", gstRate: "12", interState: false },
      ],
    });
    expect(t.subtotal).toBe("250.00");
    expect(t.taxTotal).toBe("42.00");
    expect(t.grandTotal).toBe("292.00");
  });
  it("rounds the grand total to the nearest unit and records round-off", () => {
    const t = computeInvoiceTotals({
      lines: [{ quantity: "1", unitPrice: "100.40", gstRate: "0", interState: false }],
      roundTotal: true,
    });
    expect(t.grandTotal).toBe("100.00");
    expect(t.roundOff).toBe("-0.40");
  });
  it("adds other charges", () => {
    const t = computeInvoiceTotals({
      lines: [{ quantity: "1", unitPrice: "100.00", gstRate: "0", interState: false }],
      otherCharges: "25.50",
    });
    expect(t.grandTotal).toBe("125.50");
  });
});

describe("money: claimed-total cross-check", () => {
  it("matches within tolerance and rejects beyond it", () => {
    expect(totalsMatch("236.00", "236.00")).toBe(true);
    expect(totalsMatch("236.01", "236.00")).toBe(false);
    expect(totalsMatch("236.50", "236.00", 100n)).toBe(true); // ₹1 tolerance (100 paise)
  });
});
