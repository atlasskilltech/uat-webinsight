import { describe, it, expect } from "vitest";
import { classifyEmail } from "@/lib/invoice/services/gmail";

describe("gmail: email classification (heuristic)", () => {
  it("flags a supplier invoice with an attachment as a candidate", () => {
    const r = classifyEmail({
      subject: "Tax Invoice INV-2026-014 from Acme",
      from: "billing@acme.com",
      snippet: "Please find attached your GST invoice.",
      hasAttachment: true,
    });
    expect(r.classification).toBe("supplier_invoice");
    expect(r.isInvoiceCandidate).toBe(true);
  });
  it("classifies a payment confirmation", () => {
    const r = classifyEmail({ subject: "Payment received", from: "x@y.com", snippet: "We confirm payment received.", hasAttachment: false });
    expect(r.classification).toBe("payment_confirmation");
    expect(r.isInvoiceCandidate).toBe(false);
  });
  it("marks an unrelated newsletter as irrelevant", () => {
    const r = classifyEmail({ subject: "Our October newsletter", from: "news@site.com", snippet: "Top stories this month.", hasAttachment: false });
    expect(r.classification).toBe("irrelevant");
    expect(r.isInvoiceCandidate).toBe(false);
  });
  it("does not treat an invoice email without an attachment as a candidate", () => {
    const r = classifyEmail({ subject: "Invoice summary", from: "x@y.com", snippet: "Your invoice total is...", hasAttachment: false });
    expect(r.isInvoiceCandidate).toBe(false);
  });
});
