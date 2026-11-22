import { describe, it, expect } from "vitest";
import { buildForwardMime } from "@/lib/invoice/services/forwarding";

describe("forwarding: .eml MIME builder", () => {
  const original = "From: vendor@acme.com\r\nSubject: Tax Invoice INV-9\r\n\r\nPlease find attached.";
  const rawB64Url = Buffer.from(original, "utf8").toString("base64url");

  it("addresses the Finance destination and uses a Fwd: subject", () => {
    const mime = buildForwardMime({
      destination: "finance.accounts@uni.edu",
      subject: "Tax Invoice INV-9",
      from: "vendor@acme.com",
      date: "Sat, 22 Nov 2026 00:00:00 +0000",
      confidence: "90",
      rawOriginalBase64Url: rawB64Url,
    });
    expect(mime).toContain("To: finance.accounts@uni.edu");
    expect(mime).toContain("Subject: Fwd: Tax Invoice INV-9");
    expect(mime).toContain("Content-Type: message/rfc822");
    expect(mime).toContain('filename="original.eml"');
    expect(mime).toContain("Invoice confidence: 90%");
  });

  it("embeds the full original as a decodable .eml attachment", () => {
    const mime = buildForwardMime({
      destination: "fa@uni.edu",
      subject: "Invoice",
      from: "v@acme.com",
      date: "",
      confidence: null,
      rawOriginalBase64Url: rawB64Url,
    });
    // Extract the base64 body of the message/rfc822 part and decode it.
    const marker = "Content-Transfer-Encoding: base64\r\n\r\n";
    const start = mime.indexOf(marker, mime.indexOf("message/rfc822"));
    const body = mime.slice(start + marker.length);
    const b64 = body.slice(0, body.indexOf("\r\n--")).replace(/\r\n/g, "");
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(original);
  });

  it("RFC2047-encodes a non-ASCII subject and uses an 8bit body", () => {
    const mime = buildForwardMime({
      destination: "fa@uni.edu",
      subject: "Invoice ₹1,180 — Müller & Co",
      from: "v@acme.com",
      date: "",
      confidence: null,
      rawOriginalBase64Url: rawB64Url,
    });
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(mime).not.toContain("Subject: Fwd: Invoice ₹"); // raw non-ASCII not in header
    expect(mime).toContain("Content-Transfer-Encoding: 8bit");
    // The encoded subject decodes back to the original text.
    const m = mime.match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);
    expect(Buffer.from(m![1], "base64").toString("utf8")).toBe("Fwd: Invoice ₹1,180 — Müller & Co");
  });

  it("strips CR/LF from header values (no header injection)", () => {
    const mime = buildForwardMime({
      destination: "fa@uni.edu",
      subject: "Invoice\r\nBcc: attacker@evil.com",
      from: "v@acme.com",
      date: "",
      confidence: null,
      rawOriginalBase64Url: rawB64Url,
    });
    // The CRLF is collapsed, so no injected header LINE exists…
    expect(mime).not.toContain("\r\nBcc:");
    // …and the text stays on the Subject line instead.
    expect(mime).toContain("Subject: Fwd: Invoice Bcc: attacker@evil.com");
  });
});
