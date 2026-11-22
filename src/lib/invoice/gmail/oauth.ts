import "server-only";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Gmail OAuth 2.0 for the Invoice Agent. This is a SEPARATE OAuth client from
 * the GSC/GA4 data integration (different scopes, different token storage). Uses
 * fetch (no SDK), consistent with the app's existing Google helper.
 *
 * Configure a Google Cloud OAuth client (type "Web application") with the Gmail
 * API enabled and the redirect URI registered. Gmail is a RESTRICTED scope, so
 * the consent screen must be verified by Google before external accounts work.
 */

export const GMAIL_SCOPES = [
  // Read messages + attachments to detect invoices.
  "https://www.googleapis.com/auth/gmail.readonly",
  // Send (forward) eligible invoice emails to the Finance & Accounts address.
  "https://www.googleapis.com/auth/gmail.send",
  // Identify which account was connected.
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

/** Human-readable scope summary stored on the integration row. */
export const GMAIL_SCOPE_LABEL = "gmail.readonly gmail.send";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

export class GmailApiError extends Error {
  status: number;
  permanent: boolean;
  constructor(message: string, status: number, permanent?: boolean) {
    super(message);
    this.name = "GmailApiError";
    this.status = status;
    this.permanent = permanent ?? [400, 401, 403, 404].includes(status);
  }
}

export function gmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_CLIENT_ID?.trim() && process.env.GMAIL_CLIENT_SECRET?.trim());
}

function redirectUri(): string {
  return (
    process.env.GMAIL_REDIRECT_URI?.trim() ??
    "http://localhost:3000/api/invoices/gmail/callback"
  );
}

// --- CSRF state (signed, bound to org + user) -------------------------------

function stateSecret(): Buffer {
  const raw = process.env.INVOICE_ENCRYPTION_KEY?.trim() || "insecure-dev-gmail-state";
  return createHash("sha256").update(`gmail-state:${raw}`).digest();
}

export function makeOAuthState(organizationId: string, userId: string): string {
  const nonce = randomBytes(8).toString("hex");
  const ts = Date.now().toString();
  const payload = `${organizationId}|${userId}|${nonce}|${ts}`;
  const mac = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return Buffer.from(`${payload}|${mac}`).toString("base64url");
}

export function verifyOAuthState(
  state: string,
): { organizationId: string; userId: string } | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parts = decoded.split("|");
    if (parts.length !== 5) return null;
    const [organizationId, userId, nonce, ts, mac] = parts;
    const expected = createHmac("sha256", stateSecret())
      .update(`${organizationId}|${userId}|${nonce}|${ts}`)
      .digest("base64url");
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    if (Date.now() - Number(ts) > 10 * 60 * 1000) return null; // 10-min validity
    return { organizationId, userId };
  } catch {
    return null;
  }
}

// --- OAuth flow -------------------------------------------------------------

export function getGmailAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GmailTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  obtained_at: number;
}

export async function exchangeGmailCode(code: string): Promise<GmailTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GMAIL_CLIENT_ID ?? "",
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new GmailApiError(`Gmail token exchange failed: ${res.status}`, res.status);
  const json = await res.json();
  return { ...json, obtained_at: Date.now() };
}

export async function refreshGmailToken(refreshToken: string): Promise<GmailTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GMAIL_CLIENT_ID ?? "",
      client_secret: process.env.GMAIL_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const revoked = body.includes("invalid_grant");
    throw new GmailApiError(
      revoked ? "Gmail access was revoked. Reconnect the account." : `Gmail token refresh failed: ${res.status}`,
      res.status,
      revoked || undefined,
    );
  }
  const json = await res.json();
  return { refresh_token: refreshToken, ...json, obtained_at: Date.now() };
}

export async function getGmailAccountEmail(accessToken: string): Promise<{ email: string; id: string }> {
  const res = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new GmailApiError(`Failed to read Google account: ${res.status}`, res.status);
  const json = (await res.json()) as { email?: string; id?: string };
  if (!json.email) throw new GmailApiError("Google account has no email scope.", 403, true);
  return { email: json.email.toLowerCase(), id: json.id ?? "" };
}
