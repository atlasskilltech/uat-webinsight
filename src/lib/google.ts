import "server-only";

/**
 * Google OAuth + API client helpers for Search Console and Analytics 4.
 *
 * This is the server-side integration architecture. It is only exercised once
 * valid GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and an authorised property are
 * configured (see SETUP-INTEGRATIONS.md). All secrets and tokens stay on the
 * server — never sent to the browser, logs, or reports. Until credentials are
 * configured, the app uses the CSV import workflow instead.
 */

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Error carrying the HTTP status so callers can decide whether to retry.
 * `permanent` marks auth/permission/config failures (400/401/403/404 or a
 * revoked grant) that must NOT be retried — only transient errors (429, 5xx,
 * network) are worth a bounded retry.
 */
export class GoogleApiError extends Error {
  status: number;
  permanent: boolean;
  constructor(message: string, status: number, permanent?: boolean) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.permanent = permanent ?? [400, 401, 403, 404].includes(status);
  }
}

function redirectUri(): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    "http://localhost:3000/api/integrations/google/callback"
  );
}

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  obtained_at: number;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { ...json, obtained_at: Date.now() };
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const revoked = body.includes("invalid_grant");
    throw new GoogleApiError(
      revoked
        ? "Google access was revoked or expired. Please reconnect Google in Settings."
        : `Token refresh failed: ${res.status}`,
      res.status,
      revoked || undefined,
    );
  }
  const json = await res.json();
  return { refresh_token: refreshToken, ...json, obtained_at: Date.now() };
}

/** Return a valid access token, refreshing if it is near expiry. */
export async function validAccessToken(tokens: GoogleTokens): Promise<GoogleTokens> {
  const ageMs = Date.now() - tokens.obtained_at;
  const expiresMs = (tokens.expires_in - 60) * 1000;
  if (ageMs < expiresMs) return tokens;
  if (!tokens.refresh_token) {
    throw new GoogleApiError("Access token expired and no refresh token available. Please reconnect Google.", 401, true);
  }
  return refreshAccessToken(tokens.refresh_token);
}

// --- Search Console ---------------------------------------------------------

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export async function fetchSearchConsole(
  accessToken: string,
  property: string,
  body: {
    startDate: string;
    endDate: string;
    dimensions?: string[];
    rowLimit?: number;
  },
): Promise<GscRow[]> {
  const site = encodeURIComponent(property);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rowLimit: 1000, ...body }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new GoogleApiError(
      res.status === 429
        ? "Search Console rate limit reached. Try again later."
        : `Search Console API error: ${res.status} ${body}`,
      res.status,
    );
  }
  const json = await res.json();
  return (json.rows ?? []) as GscRow[];
}

// --- Analytics 4 ------------------------------------------------------------

export interface Ga4Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

export async function fetchGa4Report(
  accessToken: string,
  propertyId: string,
  body: {
    startDate: string;
    endDate: string;
    dimensions?: string[];
    metrics: string[];
  },
): Promise<{ rows: Ga4Row[]; metricHeaders: string[] }> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: body.startDate, endDate: body.endDate }],
        dimensions: (body.dimensions ?? []).map((name) => ({ name })),
        metrics: body.metrics.map((name) => ({ name })),
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new GoogleApiError(
      res.status === 429
        ? "Analytics API quota reached. Try again later."
        : `Analytics API error: ${res.status} ${body}`,
      res.status,
    );
  }
  const json = await res.json();
  return {
    rows: (json.rows ?? []) as Ga4Row[],
    metricHeaders: (json.metricHeaders ?? []).map((m: { name: string }) => m.name),
  };
}

// --- PageSpeed Insights (no OAuth; optional API key) ------------------------

export interface PsiResult {
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  fetched: boolean;
  error?: string;
}

export async function fetchPageSpeed(url: string, strategy: "mobile" | "desktop" = "mobile"): Promise<PsiResult> {
  const empty: PsiResult = {
    performanceScore: null, accessibilityScore: null, seoScore: null,
    lcp: null, cls: null, inp: null, fetched: false,
  };
  try {
    const params = new URLSearchParams({ url, strategy });
    for (const cat of ["performance", "accessibility", "seo"]) params.append("category", cat);
    if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);
    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`,
      { signal: AbortSignal.timeout(25000) },
    );
    if (!res.ok) return { ...empty, error: `PageSpeed API returned ${res.status}` };
    const json = await res.json();
    const lh = json.lighthouseResult;
    const cats = lh?.categories ?? {};
    const audits = lh?.audits ?? {};
    const toScore = (c?: { score?: number }) => (c?.score != null ? Math.round(c.score * 100) : null);
    const metric = (id: string) => audits[id]?.numericValue ?? null;
    return {
      performanceScore: toScore(cats.performance),
      accessibilityScore: toScore(cats.accessibility),
      seoScore: toScore(cats.seo),
      lcp: metric("largest-contentful-paint") != null ? Number(metric("largest-contentful-paint")) / 1000 : null,
      cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
      inp: metric("interaction-to-next-paint"),
      fetched: true,
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "PageSpeed request failed" };
  }
}
