import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { baseUrl } from "@/lib/base-url";
import { getGmailAuthUrl } from "@/lib/invoice/gmail/oauth";

const KEYS = ["APP_URL", "AUTH_URL", "NEXTAUTH_URL", "GMAIL_REDIRECT_URI", "GMAIL_CLIENT_ID"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const reqFrom = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("baseUrl(): public URL resolution for OAuth redirects", () => {
  it("prefers the configured APP_URL (and strips a trailing slash)", () => {
    process.env.APP_URL = "https://webinsight.atlasskilltech.app/";
    expect(baseUrl(reqFrom("http://localhost:9091/api/x"))).toBe("https://webinsight.atlasskilltech.app");
  });

  it("falls back to AUTH_URL / NEXTAUTH_URL when APP_URL is unset", () => {
    process.env.AUTH_URL = "https://uat.example";
    expect(baseUrl(reqFrom("http://localhost:9091/api/x"))).toBe("https://uat.example");
    delete process.env.AUTH_URL;
    process.env.NEXTAUTH_URL = "https://prod.example";
    expect(baseUrl(reqFrom("http://localhost:9091/api/x"))).toBe("https://prod.example");
  });

  it("uses reverse-proxy forwarded headers (NOT the internal localhost origin) when no env is set", () => {
    const req = reqFrom("http://localhost:9091/api/x", {
      "x-forwarded-host": "webinsight.atlasskilltech.app",
      "x-forwarded-proto": "https",
    });
    expect(baseUrl(req)).toBe("https://webinsight.atlasskilltech.app");
  });

  it("falls back to the request origin only in local dev (no env, no proxy headers)", () => {
    expect(baseUrl(reqFrom("http://localhost:3000/api/x"))).toBe("http://localhost:3000");
  });
});

describe("Gmail OAuth redirect_uri (sent to Google)", () => {
  function redirectUriOf(authUrl: string): string | null {
    return new URL(authUrl).searchParams.get("redirect_uri");
  }

  it("uses the explicit GMAIL_REDIRECT_URI when set", () => {
    process.env.GMAIL_CLIENT_ID = "client-123";
    process.env.GMAIL_REDIRECT_URI = "https://webinsight.atlasskilltech.app/api/invoices/gmail/callback";
    expect(redirectUriOf(getGmailAuthUrl("state"))).toBe(
      "https://webinsight.atlasskilltech.app/api/invoices/gmail/callback",
    );
  });

  it("derives it from APP_URL when GMAIL_REDIRECT_URI is unset (no hardcoded env URL)", () => {
    process.env.GMAIL_CLIENT_ID = "client-123";
    process.env.APP_URL = "https://uat.example/";
    expect(redirectUriOf(getGmailAuthUrl("state"))).toBe("https://uat.example/api/invoices/gmail/callback");
  });

  it("falls back to localhost only when nothing is configured (local dev)", () => {
    process.env.GMAIL_CLIENT_ID = "client-123";
    expect(redirectUriOf(getGmailAuthUrl("state"))).toBe("http://localhost:3000/api/invoices/gmail/callback");
  });
});
