import { describe, it, expect } from "vitest";
import {
  partySchema,
  productSchema,
  lineItemSchema,
  invoiceHeaderSchema,
  paymentSchema,
} from "@/lib/invoice/validation";

describe("validation: party", () => {
  it("accepts a valid supplier and normalizes empty optionals", () => {
    const r = partySchema.safeParse({ kind: "supplier", businessName: "Acme Pvt Ltd", gstin: "", email: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.gstin).toBeUndefined();
  });
  it("rejects a bad GSTIN", () => {
    expect(partySchema.safeParse({ kind: "supplier", businessName: "Acme", gstin: "BADGSTIN" }).success).toBe(false);
  });
  it("accepts a 15-char GSTIN and a valid PAN", () => {
    const r = partySchema.safeParse({ kind: "both", businessName: "Acme", gstin: "27AAAAA0000A1Z5", pan: "ABCDE1234F" });
    expect(r.success).toBe(true);
  });
});

describe("validation: product + line item", () => {
  it("requires a valid price and gst rate", () => {
    expect(productSchema.safeParse({ name: "Hosting", defaultPrice: "100.00", defaultGstRate: "18" }).success).toBe(true);
    expect(productSchema.safeParse({ name: "X", defaultPrice: "abc", defaultGstRate: "18" }).success).toBe(false);
    expect(productSchema.safeParse({ name: "X", defaultPrice: "10", defaultGstRate: "200" }).success).toBe(false);
  });
  it("validates a line item", () => {
    expect(lineItemSchema.safeParse({ description: "Item", quantity: "2", unitPrice: "100.00", gstRate: "18" }).success).toBe(true);
    expect(lineItemSchema.safeParse({ description: "", quantity: "2", unitPrice: "100", gstRate: "18" }).success).toBe(false);
    expect(lineItemSchema.safeParse({ description: "Item", quantity: "-1", unitPrice: "100", gstRate: "18" }).success).toBe(false);
  });
});

describe("validation: invoice header + payment", () => {
  it("accepts a minimal outgoing header", () => {
    const r = invoiceHeaderSchema.safeParse({ direction: "outgoing", interState: "false", roundTotal: "false", currency: "INR" });
    expect(r.success).toBe(true);
  });
  it("rejects a bad date", () => {
    expect(invoiceHeaderSchema.safeParse({ direction: "incoming", invoiceDate: "2026/01/01" }).success).toBe(false);
  });
  it("validates a payment", () => {
    expect(paymentSchema.safeParse({ invoiceId: "abc", amount: "500.00", paidOn: "2026-11-21" }).success).toBe(true);
    expect(paymentSchema.safeParse({ invoiceId: "abc", amount: "5.0.0", paidOn: "2026-11-21" }).success).toBe(false);
    expect(paymentSchema.safeParse({ invoiceId: "abc", amount: "500", paidOn: "21-11-2026" }).success).toBe(false);
  });
});
