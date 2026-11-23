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

  it("detects an invoice by the ATTACHMENT filename even when the subject is generic", () => {
    const r = classifyEmail({
      subject: "Document from Acme Supplies", // no invoice keyword
      from: "accounts@acme.com",
      snippet: "Please find the document attached.",
      hasAttachment: true,
      attachmentNames: ["Invoice-2026-0042.pdf"],
    });
    expect(r.isInvoiceCandidate).toBe(true);
    expect(r.classification).toBe("supplier_invoice");
    expect(Math.round(r.confidence * 100)).toBe(72); // attachment-name-only confidence
  });

  it("does not flag a generic PDF with a non-invoice name", () => {
    const r = classifyEmail({
      subject: "Monthly newsletter",
      from: "news@site.com",
      snippet: "Our latest updates.",
      hasAttachment: true,
      attachmentNames: ["newsletter-october.pdf"],
    });
    expect(r.isInvoiceCandidate).toBe(false);
  });

  it("scores a GST tax invoice highest", () => {
    const r = classifyEmail({
      subject: "Tax Invoice — GSTIN 27AACCA1234F1Z5",
      from: "billing@acme.com",
      snippet: "Tax invoice attached.",
      hasAttachment: true,
      attachmentNames: ["bill.pdf"],
    });
    expect(Math.round(r.confidence * 100)).toBe(93);
  });
});
