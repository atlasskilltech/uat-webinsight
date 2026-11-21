import { describe, it, expect } from "vitest";
import { fmtMoney, currentFinancialYear, toDateInput } from "@/lib/invoice/format";

describe("format: money", () => {
  it("formats with currency symbol and grouping", () => {
    expect(fmtMoney("1234.5", "INR")).toBe("₹1,234.50");
    expect(fmtMoney("1000000.99", "USD")).toBe("$1,000,000.99");
    expect(fmtMoney(null)).toBe("—");
  });
});

describe("format: financial year (Apr–Mar)", () => {
  it("computes FY from a date", () => {
    expect(currentFinancialYear(new Date(Date.UTC(2026, 10, 21)))).toBe("2026-2027"); // Nov
    expect(currentFinancialYear(new Date(Date.UTC(2026, 1, 15)))).toBe("2025-2026"); // Feb
    expect(currentFinancialYear(new Date(Date.UTC(2026, 3, 1)))).toBe("2026-2027"); // Apr 1
  });
});

describe("format: date input", () => {
  it("formats a Date to yyyy-mm-dd (UTC)", () => {
    expect(toDateInput(new Date(Date.UTC(2026, 10, 21)))).toBe("2026-11-21");
    expect(toDateInput(null)).toBe("");
  });
});
