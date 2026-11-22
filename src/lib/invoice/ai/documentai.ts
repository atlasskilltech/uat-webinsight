import "server-only";
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { getDocAiConfig, type DocAiConfig } from "../config";
import type { OcrProvider } from "./ocr";

/**
 * Google Cloud Document AI (Invoice Parser) OCR provider.
 *
 * TEXT-ONLY: this returns Document AI's recognized `document.text` to the
 * existing provider-independent OCR pipeline, which then feeds the normal AI
 * extractor. It does NOT map Document AI entities directly — extraction totals
 * and GST logic downstream are untouched.
 *
 * Auth: Google Cloud SERVICE ACCOUNT (never an API key). We mint a short-lived
 * OAuth2 access token from the service-account key using a signed JWT (RS256),
 * via fetch — consistent with the app's no-SDK Google helpers. The credential
 * comes from GOOGLE_APPLICATION_CREDENTIALS (a path to the service-account JSON,
 * or the JSON itself).
 *
 * SECURITY: never logs the private key, access token, credential contents, or
 * invoice text/bytes. Errors carry only HTTP status + a short Google error body
 * (Google's own error JSON, which contains no invoice content).
 */

const TOKEN_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const TOKEN_TIMEOUT_MS = 15_000;
const PROCESS_TIMEOUT_MS = 60_000;

interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

/**
 * Load the service-account credential from GOOGLE_APPLICATION_CREDENTIALS.
 * Accepts either a file path (standard) or the raw JSON string. Throws a clear,
 * secret-free error when missing or malformed.
 */
function loadServiceAccount(): ServiceAccount {
  const ref = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!ref) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS is not set. Point it at the Document AI " +
        "service-account JSON (a file path, or the JSON itself).",
    );
  }
  let rawJson: string;
  if (ref.startsWith("{")) {
    rawJson = ref;
  } else {
    try {
      rawJson = readFileSync(ref, "utf8");
    } catch {
      throw new Error(
        "GOOGLE_APPLICATION_CREDENTIALS points to a file that could not be read.",
      );
    }
  }
  let parsed: { client_email?: string; private_key?: string; token_uri?: string };
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS does not contain valid JSON.");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "Service-account JSON is missing client_email / private_key. Use a Google " +
        "Cloud service-account key for Document AI.",
    );
  }
  return {
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
    tokenUri: parsed.token_uri?.trim() || DEFAULT_TOKEN_URI,
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

// --- Access-token minting (signed JWT -> OAuth2 token) ----------------------

interface CachedToken {
  key: string; // client_email, so a credential swap invalidates the cache
  token: string;
  expiresAt: number; // epoch ms
}
let tokenCache: CachedToken | null = null;

/** FOR TESTS ONLY: clear the in-memory access-token cache. */
export function _clearDocAiTokenCache(): void {
  tokenCache = null;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.key === sa.clientEmail && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.token;
  }

  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.clientEmail,
      scope: TOKEN_SCOPE,
      aud: sa.tokenUri,
      iat,
      exp: iat + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(signingInput).sign(sa.privateKey, "base64url");
  } catch {
    // A malformed private_key lands here — do NOT echo the key.
    throw new Error("Failed to sign the Document AI auth token (invalid service-account private key).");
  }
  const assertion = `${signingInput}.${signature}`;

  let res: Response;
  try {
    res = await fetch(sa.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "failed";
    throw new Error(`Document AI auth request ${reason}.`);
  }
  if (!res.ok) {
    // Google's token error body is an OAuth error (e.g. invalid_grant); no invoice data.
    throw new Error(`Document AI auth failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Document AI auth returned no access token.");
  tokenCache = {
    key: sa.clientEmail,
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

// --- Document AI :process ---------------------------------------------------

function processEndpoint(cfg: DocAiConfig): string {
  // Document AI is region-scoped by host, e.g. us-documentai.googleapis.com.
  return (
    `https://${cfg.location}-documentai.googleapis.com/v1/projects/${cfg.projectId}` +
    `/locations/${cfg.location}/processors/${cfg.processorId}:process`
  );
}

export class DocumentAiOcr implements OcrProvider {
  readonly name = "documentai";

  async recognize({ buffer, mimeType }: { buffer: Buffer; mimeType: string }): Promise<{ text: string }> {
    const cfg = getDocAiConfig();
    if (!cfg) {
      throw new Error(
        "Document AI is not fully configured. Set DOCAI_PROJECT_ID, DOCAI_LOCATION and DOCAI_PROCESSOR_ID.",
      );
    }
    const sa = loadServiceAccount();
    const token = await getAccessToken(sa);

    let res: Response;
    try {
      res = await fetch(processEndpoint(cfg), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          skipHumanReview: true,
          rawDocument: { content: buffer.toString("base64"), mimeType },
        }),
        signal: AbortSignal.timeout(PROCESS_TIMEOUT_MS),
      });
    } catch (e) {
      const reason = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "failed";
      throw new Error(`Document AI request ${reason}.`);
    }
    if (!res.ok) {
      // Google's error body is a status JSON (message/code) — no invoice content.
      throw new Error(`Document AI failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { document?: { text?: string } };
    return { text: json.document?.text ?? "" };
  }
}
