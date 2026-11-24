import { describe, it, expect } from "vitest";
import { buildGmailQuery } from "@/lib/invoice/agent/tools";

describe("buildGmailQuery: assistant filters -> Gmail search", () => {
  it("maps each field to the right Gmail operator", () => {
    const q = buildGmailQuery({
      from: "billing@acme.com",
      to: "invoices@atlas.test",
      subject: "Tax Invoice",
      query: "INV-9 total due",
      after: "2024-01-01",
      before: "2024-12-31",
      hasAttachment: true,
      filename: "pdf",
      invoiceNumber: "INV-9",
    });
    expect(q).toContain("from:billing@acme.com");
    expect(q).toContain("to:invoices@atlas.test");
    expect(q).toContain("subject:(Tax Invoice)");
    expect(q).toContain("filename:pdf");
    expect(q).toContain("has:attachment");
    expect(q).toContain("after:2024/1/1");
    expect(q).toContain("before:2024/12/31");
    expect(q).toContain('"INV-9"'); // invoice number as an exact term
    expect(q).toContain("INV-9 total due"); // free text (searches body server-side)
  });

  it("searches all mail by default; only adds in:anywhere (spam/trash) when asked", () => {
    expect(buildGmailQuery({ query: "x" })).not.toContain("in:anywhere");
    expect(buildGmailQuery({ query: "x", includeSpamTrash: true })).toContain("in:anywhere");
  });

  it("normalizes dates to Gmail's YYYY/M/D and returns empty for no filters", () => {
    expect(buildGmailQuery({ after: "2024/05/06" })).toBe("after:2024/5/6");
    expect(buildGmailQuery({ before: "2024-05-06" })).toBe("before:2024/5/6");
    expect(buildGmailQuery({})).toBe("");
  });
});
