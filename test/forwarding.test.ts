import { describe, it, expect } from "vitest";
import { buildForwardMime, normalizeEmail, renderForwardBody, isAccountForwardable } from "@/lib/invoice/services/forwarding";

describe("forwarding: account-health gate (auto-forward only on a connected account)", () => {
  it("permits a connected account and blocks disconnected / expired / disabled ones", () => {
    expect(isAccountForwardable("connected")).toBe(true);
    expect(isAccountForwardable("disconnected")).toBe(false);
    expect(isAccountForwardable("reauth_required")).toBe(false);
    expect(isAccountForwardable("error")).toBe(false);
    expect(isAccountForwardable("")).toBe(false);
    expect(isAccountForwardable(null)).toBe(false);
  });
});

describe("forwarding: renderForwardBody (professional HTML template)", () => {
  it("renders a professional HTML body under the Finance & Accounts label + original From/To/Date/Subject", () => {
    const r = renderForwardBody({
      organisationName: "Atlas ISME",
      accountName: "Prasun Pakhira",
      subject: "Tax Invoice INV-9",
      from: "vendor@acme.com",
      to: "ap@atlas.edu",
      date: "Sat, 22 Nov 2026 00:00:00 +0000",
      confidence: "90",
      attachmentFilenames: ["Invoice-INV-9.pdf"],
    });
    // Subject names the CONNECTED mailbox that received the mail, not the sender.
    expect(r.subject).toBe("You have received an email from Prasun Pakhira");
    expect(r.contentType).toBe('text/html; charset="UTF-8"'); // HTML, not plain text
    expect(r.encoding).toBe("8bit");
    expect(r.body).toContain("<!doctype html>");
    expect(r.body).toContain("Finance &amp; Accounts"); // fixed branding label (HTML-escaped &)
    expect(r.body).not.toContain("Atlas ISME"); // the raw organisation name is NOT shown
    expect(r.body).toContain("email assistant"); // clearly an automated forward
    expect(r.body).toContain("vendor@acme.com"); // original sender
    expect(r.body).toContain("ap@atlas.edu"); // original recipient
    expect(r.body).toContain("Tax Invoice INV-9"); // subject
    expect(r.body).toContain("Invoice-INV-9.pdf"); // attachment listed
    expect(r.body).toContain("original.eml"); // full original preserved
    expect(r.body).not.toContain("Invoice confidence"); // internal metric not shown to recipients
  });

  it("escapes untrusted header values (no HTML injection from the sender/subject)", () => {
    const r = renderForwardBody({
      organisationName: "Org",
      subject: "<script>alert(1)</script>",
      from: "a@b.com",
      to: "c@d.com",
      date: "",
      confidence: null,
      attachmentFilenames: ['<img src=x onerror="evil()">.pdf'],
    });
    expect(r.body).not.toContain("<script>alert(1)</script>");
    expect(r.body).toContain("&lt;script&gt;");
    expect(r.body).not.toContain('onerror="evil()"');
  });

  it("subject uses the connected account's display NAME when present", () => {
    const r1 = renderForwardBody({ organisationName: "Org", accountName: "Procurement Team", subject: "x", from: "v@x.com", to: "", date: "", confidence: null, attachmentFilenames: [] });
    expect(r1.subject).toBe("You have received an email from Procurement Team");
    // A different connected account produces its own name (multi-account).
    const r2 = renderForwardBody({ organisationName: "Org", accountName: "Prasun Pakhira", subject: "x", from: "v@x.com", to: "", date: "", confidence: null, attachmentFilenames: [] });
    expect(r2.subject).toBe("You have received an email from Prasun Pakhira");
  });

  it("subject falls back to the account EMAIL when no display name is available", () => {
    // The caller passes the account email as accountName when display_name is null.
    const r = renderForwardBody({ organisationName: "Org", accountName: "procurement@atlasuniversity.edu.in", subject: "x", from: "v@x.com", to: "", date: "", confidence: null, attachmentFilenames: [] });
    expect(r.subject).toBe("You have received an email from procurement@atlasuniversity.edu.in");
  });

  it("uses a generic fallback when neither a name nor an email is given", () => {
    const r = renderForwardBody({ organisationName: "", subject: "", from: "v@x.com", to: "", date: "", confidence: null, attachmentFilenames: [] });
    expect(r.subject).toBe("You have received an email from the connected mailbox");
    expect(r.body).toContain("Finance &amp; Accounts"); // body branding is still the fixed label
  });

  it("inlines the sanitized original body under an 'Original message' section", () => {
    const r = renderForwardBody({
      organisationName: "Org", subject: "s", from: "a@b.com", to: "c@d.com", date: "", confidence: null,
      attachmentFilenames: [], originalBodyHtml: "<p>Hello the full body is here</p>",
    });
    expect(r.body).toContain("Original message");
    expect(r.body).toContain("<p>Hello the full body is here</p>"); // readable inline, no original.eml needed
  });

  it("shows an original.eml note when no inline body could be produced", () => {
    const r = renderForwardBody({
      organisationName: "Org", subject: "s", from: "a@b.com", to: "c@d.com", date: "", confidence: null,
      attachmentFilenames: [],
    });
    expect(r.body).toContain("attached as <b>original.eml</b>");
  });
});

describe("forwarding: .eml MIME builder", () => {
  const original = "From: vendor@acme.com\r\nSubject: Tax Invoice INV-9\r\n\r\nPlease find attached.";
  const rawB64Url = Buffer.from(original, "utf8").toString("base64url");

  it("addresses the Finance destination and subjects it from the connected account", () => {
    const mime = buildForwardMime({
      destination: "finance.accounts@uni.edu",
      organisationName: "Atlas ISME",
      accountName: "Prasun Pakhira",
      subject: "Tax Invoice INV-9",
      from: "vendor@acme.com",
      to: "ap@atlas.edu",
      date: "Sat, 22 Nov 2026 00:00:00 +0000",
      confidence: "90",
      rawOriginalBase64Url: rawB64Url,
    });
    expect(mime).toContain("To: finance.accounts@uni.edu");
    expect(mime).toContain("Subject: You have received an email from Prasun Pakhira");
    expect(mime).toContain("Content-Type: message/rfc822");
    expect(mime).toContain('filename="original.eml"');
    // The body part is the redesigned HTML with the Finance & Accounts label + metadata.
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(mime).toContain("Finance &amp; Accounts");
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

  it("RFC2047-encodes a non-ASCII subject (from a non-ASCII account name) and uses an 8bit body", () => {
    const mime = buildForwardMime({
      destination: "fa@uni.edu",
      accountName: "Müller & Co ₹",
      subject: "Invoice",
      from: "v@acme.com",
      date: "",
      confidence: null,
      rawOriginalBase64Url: rawB64Url,
    });
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(mime).not.toContain("Subject: You have received an email from Müller"); // raw non-ASCII not in header
    expect(mime).toContain("Content-Transfer-Encoding: 8bit");
    // The encoded subject decodes back to the full subject line.
    const m = mime.match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);
    expect(Buffer.from(m![1], "base64").toString("utf8")).toBe("You have received an email from Müller & Co ₹");
  });

  it("strips CR/LF from the account name (no header injection into Subject)", () => {
    const mime = buildForwardMime({
      destination: "fa@uni.edu",
      accountName: "Procurement\r\nBcc: attacker@evil.com",
      subject: "Invoice",
      from: "v@acme.com",
      date: "",
      confidence: null,
      rawOriginalBase64Url: rawB64Url,
    });
    // The CRLF is collapsed, so no injected header LINE exists…
    expect(mime).not.toContain("\r\nBcc:");
    // …and the text stays on the Subject line instead.
    expect(mime).toContain("Subject: You have received an email from Procurement Bcc: attacker@evil.com");
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
