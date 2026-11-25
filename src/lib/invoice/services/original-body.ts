import "server-only";
import type { GmailMessage, GmailPart } from "../gmail/api";
import { gmailGetAttachment } from "../gmail/api";
import { sanitizeEmailHtml } from "../html-sanitize";

/**
 * Extract the original email's readable body from the Gmail-parsed message and
 * return a SANITIZED HTML fragment to inline into the forward, so recipients can
 * read it without opening original.eml. Prefers the HTML part (sanitized),
 * falling back to the plain-text part (escaped). Inline images referenced by
 * `cid:` are resolved to bounded `data:` URIs; everything else unsafe is removed
 * by the sanitizer. The complete original is still attached as original.eml, so
 * anything we can't safely inline is never lost.
 */

const MAX_INLINE_IMAGES = 20;
const MAX_INLINE_IMAGE_BYTES = 300_000; // per image
const MAX_TOTAL_INLINE_BYTES = 2_000_000; // across all inline images
const MAX_HTML_OUTPUT = 500_000;

function header(part: GmailPart, name: string): string | null {
  return part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodeText(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/** Walk the payload tree, picking the first text/html and first text/plain body. */
function pickBodies(part: GmailPart | undefined, acc: { html?: string; text?: string }): void {
  if (!part) return;
  const mt = (part.mimeType ?? "").toLowerCase();
  // Only treat a part as a BODY when it is not an attachment (no filename).
  if (!part.filename) {
    if (mt === "text/html" && part.body?.data && acc.html === undefined) acc.html = decodeText(part.body.data);
    else if (mt === "text/plain" && part.body?.data && acc.text === undefined) acc.text = decodeText(part.body.data);
  }
  for (const p of part.parts ?? []) pickBodies(p, acc);
}

interface InlineImage {
  cid: string;
  mimeType: string;
  attachmentId?: string;
  data?: string;
  size: number;
}

function collectInlineImages(part: GmailPart | undefined, acc: InlineImage[]): void {
  if (!part) return;
  const mt = (part.mimeType ?? "").toLowerCase();
  if (mt.startsWith("image/")) {
    const cidRaw = header(part, "content-id");
    const disp = header(part, "content-disposition") ?? "";
    if (cidRaw || /inline/i.test(disp)) {
      const cid = (cidRaw ?? "").replace(/^<|>$/g, "").trim();
      if (cid) acc.push({ cid, mimeType: part.mimeType ?? "image/png", attachmentId: part.body?.attachmentId, data: part.body?.data, size: part.body?.size ?? 0 });
    }
  }
  for (const p of part.parts ?? []) collectInlineImages(p, acc);
}

function textToHtml(text: string): string {
  // Escape, then preserve line breaks. The sanitizer is not needed (no markup),
  // but escaping guarantees no injection.
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<pre style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;white-space:pre-wrap;word-break:break-word;color:#0f172a;">${escaped}</pre>`;
}

/**
 * Build the sanitized, inline-ready HTML of the original body. Returns "" when
 * there is no usable body (the recipient then relies on original.eml).
 */
export async function buildOriginalBodyHtml(
  token: string,
  messageId: string,
  msg: GmailMessage,
): Promise<string> {
  const bodies: { html?: string; text?: string } = {};
  pickBodies(msg.payload, bodies);

  if (bodies.html) {
    // Pre-fetch inline images referenced by cid (bounded), build cid -> data URI.
    const inline: InlineImage[] = [];
    collectInlineImages(msg.payload, inline);
    const cidMap = new Map<string, string>();
    let total = 0;
    for (const img of inline.slice(0, MAX_INLINE_IMAGES)) {
      if (img.size && img.size > MAX_INLINE_IMAGE_BYTES) continue;
      if (/svg/i.test(img.mimeType)) continue; // SVG can carry script — never inline it
      if (!/^image\/(png|jpeg|jpg|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)$/i.test(img.mimeType)) continue;
      try {
        let b64: string;
        if (img.data) b64 = Buffer.from(img.data, "base64url").toString("base64");
        else if (img.attachmentId) b64 = (await gmailGetAttachment(token, messageId, img.attachmentId)).toString("base64");
        else continue;
        const bytes = Math.floor((b64.length * 3) / 4);
        if (bytes > MAX_INLINE_IMAGE_BYTES || total + bytes > MAX_TOTAL_INLINE_BYTES) continue;
        total += bytes;
        const mime = /^image\//i.test(img.mimeType) ? img.mimeType : "image/png";
        cidMap.set(img.cid, `data:${mime};base64,${b64}`);
      } catch {
        /* skip an inline image we can't fetch — the sanitizer drops its <img> */
      }
    }
    return sanitizeEmailHtml(bodies.html, {
      resolveCid: (cid) => cidMap.get(cid.trim()) ?? null,
      maxLength: MAX_HTML_OUTPUT,
    });
  }

  if (bodies.text && bodies.text.trim()) return textToHtml(bodies.text);
  return "";
}
