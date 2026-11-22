import "server-only";
import { GmailApiError } from "./oauth";

/** Minimal Gmail REST API helpers (read-only), via fetch. */

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a Gmail API path with bounded retry. Transient failures (429 rate limit,
 * 5xx) are retried with exponential backoff + jitter; permanent failures
 * (401/403/404 and other 4xx) throw immediately so callers can handle reauth.
 */
async function gfetch(token: string, path: string, attempt = 0): Promise<Response> {
  const MAX_ATTEMPTS = 4;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    // Network error / timeout — retry a few times.
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(Math.min(8000, 2 ** attempt * 500) + Math.random() * 250);
      return gfetch(token, path, attempt + 1);
    }
    throw new GmailApiError(`Gmail network error: ${e instanceof Error ? e.message : "failed"}`, 503);
  }
  if (res.ok) return res;

  const transient = res.status === 429 || res.status >= 500;
  if (transient && attempt < MAX_ATTEMPTS - 1) {
    const retryAfter = Number(res.headers.get("retry-after")) * 1000;
    await sleep(retryAfter > 0 ? retryAfter : Math.min(8000, 2 ** attempt * 500) + Math.random() * 250);
    return gfetch(token, path, attempt + 1);
  }
  throw new GmailApiError(
    res.status === 429 ? "Gmail rate limit reached." : `Gmail API error: ${res.status}`,
    res.status,
  );
}

export async function gmailListMessages(
  token: string,
  query: string,
  maxResults = 25,
  pageToken?: string,
): Promise<{ messages: GmailMessageRef[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  if (pageToken) params.set("pageToken", pageToken);
  const res = await gfetch(token, `/messages?${params.toString()}`);
  const json = (await res.json()) as { messages?: GmailMessageRef[]; nextPageToken?: string };
  return { messages: json.messages ?? [], nextPageToken: json.nextPageToken };
}

export async function gmailGetMessage(token: string, id: string): Promise<GmailMessage> {
  const res = await gfetch(token, `/messages/${id}?format=full`);
  return (await res.json()) as GmailMessage;
}

export async function gmailGetAttachment(
  token: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const res = await gfetch(token, `/messages/${messageId}/attachments/${attachmentId}`);
  const json = (await res.json()) as { data?: string };
  if (!json.data) throw new GmailApiError("Attachment has no data.", 404, true);
  return Buffer.from(json.data, "base64url");
}

export function getHeader(msg: GmailMessage, name: string): string | null {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

export interface AttachmentRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

/** Recursively collect downloadable attachment parts from a message payload. */
export function collectAttachments(msg: GmailMessage): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  const walk = (part?: GmailPart) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        attachmentId: part.body.attachmentId,
        size: part.body.size ?? 0,
      });
    }
    for (const p of part.parts ?? []) walk(p);
  };
  walk(msg.payload);
  return out;
}

const SUPPORTED = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function isSupportedAttachment(a: AttachmentRef): boolean {
  if (SUPPORTED.has(a.mimeType.toLowerCase())) return true;
  return /\.(pdf|jpe?g|png|webp)$/i.test(a.filename);
}
