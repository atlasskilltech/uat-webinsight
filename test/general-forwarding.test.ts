import { describe, it, expect } from "vitest";
import {
  classifyEmail,
  classificationCategory,
  resolveCategoryKey,
  shouldForwardEmail,
  decideForwardStatus,
} from "@/lib/invoice/services/gmail";

/**
 * General-purpose classification + forwarding (requirement 1).
 *
 * - Classification assigns a routing CATEGORY to every email (invoice, PO,
 *   statement, other), not only invoices.
 * - The forward GATE forwards an invoice candidate (rule OR legacy default) or
 *   any email matching an explicit RULE — a non-invoice email NEVER forwards via
 *   the legacy default (ordinary mail is not sent unless a rule is configured).
 * - Custom categories are detected from the email text for rule matching.
 * - Review-first: auto-forward is OFF by default and an uncertain (below
 *   threshold) classification goes to review, not auto.
 */

describe("classifyEmail — document category for every email", () => {
  it("invoice: category 'invoice', candidate, high confidence (unchanged)", () => {
    const r = classifyEmail({ subject: "Tax Invoice INV-9", from: "ap@acme.com", snippet: "GST invoice attached", hasAttachment: true, attachmentNames: ["inv.pdf"] });
    expect(r.category).toBe("invoice");
    expect(r.isInvoiceCandidate).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("purchase order: category 'purchase_order', NOT an invoice candidate, mid-high confidence", () => {
    const r = classifyEmail({ subject: "Purchase Order PO-123", from: "buyer@acme.com", snippet: "Please find our purchase order", hasAttachment: true, attachmentNames: ["po.pdf"] });
    expect(r.classification).toBe("purchase_order");
    expect(r.category).toBe("purchase_order");
    expect(r.isInvoiceCandidate).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("statement: category 'statement'", () => {
    const r = classifyEmail({ subject: "Account statement for October", from: "bank@x.com", snippet: "Your statement is attached", hasAttachment: true });
    expect(r.category).toBe("statement");
    expect(r.isInvoiceCandidate).toBe(false);
  });

  it("general business email (no attachment, no finance keywords): category 'other', low confidence", () => {
    const r = classifyEmail({ subject: "Project kickoff notes", from: "pm@x.com", snippet: "Here are the notes from today.", hasAttachment: false });
    expect(r.category).toBe("other");
    expect(r.isInvoiceCandidate).toBe(false);
    expect(r.confidence).toBeLessThan(0.3); // uncertain -> will go to review if a rule matches
  });

  it("maps every classification to a category", () => {
    expect(classificationCategory("supplier_invoice")).toBe("invoice");
    expect(classificationCategory("credit_note")).toBe("invoice");
    expect(classificationCategory("purchase_order")).toBe("purchase_order");
    expect(classificationCategory("general_finance")).toBe("statement");
    expect(classificationCategory("payment_confirmation")).toBe("other");
    expect(classificationCategory("irrelevant")).toBe("other");
  });
});

describe("resolveCategoryKey — custom category detection", () => {
  const customs = [{ categoryKey: "contract", label: "Contract" }, { categoryKey: "nda", label: "NDA" }];
  it("overrides the system category when a custom label appears in the text", () => {
    expect(resolveCategoryKey("other", "Signed Contract for review", customs)).toBe("contract");
  });
  it("keeps the system category when no custom label matches", () => {
    expect(resolveCategoryKey("statement", "Monthly account statement", customs)).toBe("statement");
  });
  it("ignores very short custom labels (noise guard)", () => {
    expect(resolveCategoryKey("other", "an nda-like mention", [{ categoryKey: "x", label: "an" }])).toBe("other");
  });
  it("cannot be overridden by a category NOT in the caller's (org-scoped) list", () => {
    // The sync passes only THIS org's custom categories (listCategories is scoped
    // to organization_id). Another org's 'Contract' category is simply absent
    // here, so it can never override this org's routing.
    const thisOrgCustoms = [{ categoryKey: "nda", label: "NDA" }];
    expect(resolveCategoryKey("other", "Signed Contract from Org B", thisOrgCustoms)).toBe("other");
  });
});

describe("shouldForwardEmail — forward gate (business documents, not just invoices)", () => {
  const dest = (source: "rule" | "rule_fallback" | "legacy" | "none") => ({ destination: "fin@x.com", source });

  it("forwards a BUSINESS DOCUMENT (invoice, PO, statement, …) to the org destination", () => {
    // Any recognized document candidate forwards to the organization's own
    // (legacy) destination — this is what makes it work for more than invoices.
    expect(shouldForwardEmail(dest("legacy"), true)).toBe(true);
  });
  it("does NOT forward ordinary mail (not a document) via the destination", () => {
    expect(shouldForwardEmail(dest("legacy"), false)).toBe(false);
  });
  it("still forwards when a rule matches, document or not", () => {
    expect(shouldForwardEmail(dest("rule"), false)).toBe(true);
    expect(shouldForwardEmail(dest("rule_fallback"), false)).toBe(true);
  });
  it("does NOT forward when there is no destination configured", () => {
    expect(shouldForwardEmail({ destination: null, source: "none" }, true)).toBe(false);
    expect(shouldForwardEmail({ destination: null, source: "none" }, false)).toBe(false);
  });

  it("a PO / statement email with an attachment is a document candidate and would forward", () => {
    // Mirror the sync's isDocumentCandidate = hasAttachment && classification !== 'irrelevant'.
    const po = classifyEmail({ subject: "Purchase Order PO-7", from: "b@x.com", snippet: "PO attached", hasAttachment: true, attachmentNames: ["po.pdf"] });
    const isDoc = po.classification !== "irrelevant"; // hasAttachment true
    expect(isDoc).toBe(true);
    expect(shouldForwardEmail(dest("legacy"), isDoc)).toBe(true);

    const newsletter = classifyEmail({ subject: "Monthly newsletter", from: "n@x.com", snippet: "updates", hasAttachment: true, attachmentNames: ["news.pdf"] });
    const isDoc2 = newsletter.classification !== "irrelevant";
    expect(isDoc2).toBe(false); // newsletter -> irrelevant -> not a document
    expect(shouldForwardEmail(dest("legacy"), isDoc2)).toBe(false);
  });
});

describe("review-first: auto OFF by default, uncertain -> review", () => {
  it("below the threshold always goes to review (even with auto on)", () => {
    expect(decideForwardStatus(40, 70, true)).toBe("review");
    expect(decideForwardStatus(40, 70, false)).toBe("review");
  });
  it("at/above threshold with auto OFF queues for approval (pending), never auto", () => {
    expect(decideForwardStatus(90, 70, false)).toBe("pending");
  });
  it("auto-forwards only when explicitly enabled AND confident", () => {
    expect(decideForwardStatus(90, 70, true)).toBe("approved");
  });
});
