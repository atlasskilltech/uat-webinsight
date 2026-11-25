import { describe, it, expect, vi } from "vitest";

// Mock the inline-image fetch (attachmentId path). The data-URI inline path and
// body extraction need no network.
const getAttachment = vi.hoisted(() => vi.fn(async () => Buffer.from([1, 2, 3, 4])));
vi.mock("@/lib/invoice/gmail/api", () => ({ gmailGetAttachment: getAttachment }));

import { buildOriginalBodyHtml } from "@/lib/invoice/services/original-body";
import type { GmailMessage } from "@/lib/invoice/gmail/api";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const msg = (payload: unknown): GmailMessage => ({ id: "m", threadId: "t", payload } as GmailMessage);

describe("buildOriginalBodyHtml — body extraction", () => {
  it("renders a plain-text email as escaped, line-preserving HTML", async () => {
    const out = await buildOriginalBodyHtml("tok", "mid", msg({
      mimeType: "text/plain",
      body: { data: b64url("Dear Sir,\nPlease find attached invoice INV-9.\n<not a tag>") },
    }));
    expect(out).toContain("Please find attached invoice INV-9.");
    expect(out).toContain("&lt;not a tag&gt;"); // escaped, no injection
    expect(out).toContain("white-space:pre-wrap");
  });

  it("uses the HTML part and sanitizes it", async () => {
    const out = await buildOriginalBodyHtml("tok", "mid", msg({
      mimeType: "text/html",
      body: { data: b64url('<p>Hello <b>World</b></p><script>steal()</script>') },
    }));
    expect(out).toContain("<p>Hello <b>World</b></p>");
    expect(out).not.toContain("steal()");
    expect(out).not.toContain("<script");
  });

  it("prefers the HTML part in a multipart/alternative email", async () => {
    const out = await buildOriginalBodyHtml("tok", "mid", msg({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("plain fallback") } },
        { mimeType: "text/html", body: { data: b64url("<p>rich <i>html</i></p>") } },
      ],
    }));
    expect(out).toContain("<p>rich <i>html</i></p>");
    expect(out).not.toContain("plain fallback");
  });

  it("extracts the body and ignores attachment parts (multipart/mixed)", async () => {
    const out = await buildOriginalBodyHtml("tok", "mid", msg({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/html", body: { data: b64url("<p>See invoice attached.</p>") } },
        { mimeType: "application/pdf", filename: "INV-9.pdf", body: { attachmentId: "att1", size: 1000 } },
      ],
    }));
    expect(out).toContain("See invoice attached.");
    expect(out).not.toContain("INV-9.pdf"); // attachment is not body content
  });

  it("inlines a cid: image (from inline body data) as a data URI", async () => {
    const out = await buildOriginalBodyHtml("tok", "mid", msg({
      mimeType: "multipart/related",
      parts: [
        { mimeType: "text/html", body: { data: b64url('<p>Logo:</p><img src="cid:logo@1" alt="logo">') } },
        { mimeType: "image/png", headers: [{ name: "Content-ID", value: "<logo@1>" }], body: { data: Buffer.from([0, 1, 2]).toString("base64url"), size: 3 } },
      ],
    }));
    expect(out).toContain("data:image/png;base64,");
    expect(out).not.toContain("cid:");
  });

  it("inlines a cid: image fetched by attachmentId", async () => {
    const out = await buildOriginalBodyHtml("tok", "mid", msg({
      mimeType: "multipart/related",
      parts: [
        { mimeType: "text/html", body: { data: b64url('<img src="cid:pic">') } },
        { mimeType: "image/jpeg", headers: [{ name: "Content-ID", value: "<pic>" }], body: { attachmentId: "att9", size: 4 } },
      ],
    }));
    expect(getAttachment).toHaveBeenCalledWith("tok", "mid", "att9");
    expect(out).toContain("data:image/jpeg;base64,");
  });

  it("strips malicious HTML embedded in the body (script, onerror, javascript:)", async () => {
    const out = await buildOriginalBodyHtml("tok", "mid", msg({
      mimeType: "text/html",
      body: { data: b64url('<img src="https://x/y.png" onerror="evil()"><a href="javascript:bad()">x</a><iframe src="http://evil"></iframe>') },
    }));
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<iframe");
  });

  it("returns empty string when there is no readable body", async () => {
    const out = await buildOriginalBodyHtml("tok", "mid", msg({ mimeType: "multipart/mixed", parts: [] }));
    expect(out).toBe("");
  });
});
