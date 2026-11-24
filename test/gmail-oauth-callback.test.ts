import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Gmail OAuth callback route: verifies the post-OAuth redirect always targets
 * the PUBLIC app URL (never the internal proxy origin, e.g. localhost:9091),
 * and that success, cancellation and callback errors are handled gracefully.
 * Heavy deps (auth/org, OAuth network, DB upsert, next/server) are mocked so the
 * redirect logic is tested in isolation.
 */
const h = vi.hoisted(() => ({
  gmailConfigured: vi.fn(() => true),
  verifyOAuthState: vi.fn(),
  exchangeGmailCode: vi.fn(),
  getGmailAccountEmail: vi.fn(),
  getInvoiceContext: vi.fn(),
  upsertGmailIntegration: vi.fn(),
}));

// Stub NextResponse.redirect so we can read the Location header without loading
// the real next/server (not resolvable in this test environment).
vi.mock("next/server", () => ({
  NextResponse: {
    redirect: (url: string | URL) => new Response(null, { status: 307, headers: { location: String(url) } }),
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
  },
}));
vi.mock("@/lib/invoice/gmail/oauth", () => ({
  gmailConfigured: h.gmailConfigured,
  verifyOAuthState: h.verifyOAuthState,
  exchangeGmailCode: h.exchangeGmailCode,
  getGmailAccountEmail: h.getGmailAccountEmail,
}));
vi.mock("@/lib/invoice/org", () => ({ getInvoiceContext: h.getInvoiceContext }));
vi.mock("@/lib/invoice/services/gmail", () => ({ upsertGmailIntegration: h.upsertGmailIntegration }));

import { GET } from "@/app/api/invoices/gmail/callback/route";

const APP = "https://webinsight.atlasskilltech.app";
const INTERNAL = "http://localhost:9091"; // the internal proxy origin (the bug)
const loc = (res: Response) => res.headers.get("location");
const req = (qs: string, headers: Record<string, string> = {}) =>
  new Request(`${INTERNAL}/api/invoices/gmail/callback${qs}`, { headers });

beforeEach(() => {
  process.env.APP_URL = APP;
  for (const k of ["verifyOAuthState", "exchangeGmailCode", "getGmailAccountEmail", "getInvoiceContext", "upsertGmailIntegration"] as const) {
    h[k].mockReset();
  }
  h.gmailConfigured.mockReturnValue(true);
});

describe("Gmail OAuth callback → redirect target", () => {
  it("redirects to the PUBLIC app URL (not localhost:9091) on user cancellation", async () => {
    const res = await GET(req("?error=access_denied"));
    expect(loc(res)).toBe(`${APP}/invoices/email-accounts?error=access_denied`);
  });

  it("handles missing params gracefully", async () => {
    expect(loc(await GET(req("")))).toBe(`${APP}/invoices/email-accounts?error=missing_params`);
  });

  it("rejects a tampered/invalid OAuth state", async () => {
    h.verifyOAuthState.mockReturnValue(null);
    expect(loc(await GET(req("?code=abc&state=tampered")))).toBe(`${APP}/invoices/email-accounts?error=bad_state`);
  });

  it("rejects a session mismatch (different signed-in user)", async () => {
    h.verifyOAuthState.mockReturnValue({ organizationId: "o1", userId: "u1" });
    h.getInvoiceContext.mockResolvedValue({ organizationId: "o1", user: { id: "someone-else", email: "x@y" } });
    expect(loc(await GET(req("?code=abc&state=s")))).toBe(`${APP}/invoices/email-accounts?error=session_mismatch`);
  });

  it("completes a successful connection and redirects with ?connected=<email>", async () => {
    h.verifyOAuthState.mockReturnValue({ organizationId: "o1", userId: "u1" });
    h.getInvoiceContext.mockResolvedValue({ organizationId: "o1", user: { id: "u1", email: "admin@co" } });
    h.exchangeGmailCode.mockResolvedValue({ access_token: "a", refresh_token: "r", expires_in: 3600, obtained_at: Date.now() });
    h.getGmailAccountEmail.mockResolvedValue({ email: "inbox@co", id: "sub123" });
    h.upsertGmailIntegration.mockResolvedValue(undefined);
    const res = await GET(req("?code=abc&state=s"));
    expect(loc(res)).toBe(`${APP}/invoices/email-accounts?connected=${encodeURIComponent("inbox@co")}`);
    expect(h.upsertGmailIntegration).toHaveBeenCalledTimes(1);
  });

  it("reports a token-exchange/callback error gracefully", async () => {
    h.verifyOAuthState.mockReturnValue({ organizationId: "o1", userId: "u1" });
    h.getInvoiceContext.mockResolvedValue({ organizationId: "o1", user: { id: "u1", email: "admin@co" } });
    h.exchangeGmailCode.mockRejectedValue(new Error("token_exchange_failed"));
    const res = await GET(req("?code=abc&state=s"));
    expect(loc(res)).toBe(`${APP}/invoices/email-accounts?error=${encodeURIComponent("token_exchange_failed")}`);
  });

  it("reports not-configured when Gmail OAuth is not set up", async () => {
    h.gmailConfigured.mockReturnValue(false);
    expect(loc(await GET(req("?code=abc&state=s")))).toBe(`${APP}/invoices/email-accounts?error=not_configured`);
  });

  it("uses forwarded proxy headers (never localhost) when APP_URL is unset", async () => {
    delete process.env.APP_URL;
    const res = await GET(
      req("?error=access_denied", { "x-forwarded-host": "webinsight.atlasskilltech.app", "x-forwarded-proto": "https" }),
    );
    expect(loc(res)).toBe(`${APP}/invoices/email-accounts?error=access_denied`);
  });
});
