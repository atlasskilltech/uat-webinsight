import { describe, it, expect } from "vitest";
import { buildForwardMime, normalizeEmail } from "@/lib/invoice/services/forwarding";

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

  it("attaches the ACTUAL invoice attachments directly (filename + MIME + decodable bytes), plus original.eml", () => {
    const pdf = Buffer.from("%PDF-1.4 actual invoice bytes");
    const img = Buffer.from("\x89PNG actual image bytes");
    const mime = buildForwardMime({
      destination: "fa@uni.edu",
      subject: "Tax Invoice INV-9",
      from: "vendor@acme.com",
      date: "",
      confidence: "90",
      rawOriginalBase64Url: rawB64Url,
      attachments: [
        { filename: "Invoice-INV-9.pdf", mimeType: "application/pdf", contentBase64: pdf.toString("base64") },
        { filename: "annexure.png", mimeType: "image/png", contentBase64: img.toString("base64") },
      ],
    });
    // Both real attachments appear with their filenames + MIME types.
    expect(mime).toContain('Content-Type: application/pdf; name="Invoice-INV-9.pdf"');
    expect(mime).toContain('filename="Invoice-INV-9.pdf"');
    expect(mime).toContain('Content-Type: image/png; name="annexure.png"');
    expect(mime).toContain('filename="annexure.png"');
    // The actual PDF bytes are present and decodable.
    const pdfStart = mime.indexOf('filename="Invoice-INV-9.pdf"');
    const b64Marker = "Content-Transfer-Encoding: base64\r\n\r\n";
    const bodyStart = mime.indexOf(b64Marker, pdfStart) + b64Marker.length;
    const b64 = mime.slice(bodyStart, mime.indexOf("\r\n--", bodyStart)).replace(/\r\n/g, "");
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe("%PDF-1.4 actual invoice bytes");
    // original.eml is still attached as an additional option.
    expect(mime).toContain("Content-Type: message/rfc822");
    expect(mime).toContain('filename="original.eml"');
  });

  it("adds all CC recipients to the header (Finance destination stays the To)", () => {
    const mime = buildForwardMime({
      destination: "finance@uni.edu",
      cc: ["ap1@uni.edu", "ap2@uni.edu"],
      subject: "Invoice",
      from: "v@acme.com",
      date: "",
      confidence: null,
      rawOriginalBase64Url: rawB64Url,
    });
    expect(mime).toContain("To: finance@uni.edu");
    expect(mime).toContain("Cc: ap1@uni.edu, ap2@uni.edu");
  });

  it("omits the Cc header when there are no CC recipients", () => {
    const mime = buildForwardMime({
      destination: "finance@uni.edu",
      subject: "Invoice",
      from: "v@acme.com",
      date: "",
      confidence: null,
      rawOriginalBase64Url: rawB64Url,
    });
    expect(mime).not.toContain("\nCc:");
  });
});

describe("forwarding: CC email validation", () => {
  it("accepts valid emails and lowercases them", () => {
    expect(normalizeEmail("  AP@Uni.Edu ")).toBe("ap@uni.edu");
  });
  it("rejects invalid emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
  });
});
