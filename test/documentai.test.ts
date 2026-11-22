import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { DocumentAiOcr, _clearDocAiTokenCache } from "@/lib/invoice/ai/documentai";
import { getDocAiConfig, ocrProviderConfigured } from "@/lib/invoice/config";
import { getOcrProvider } from "@/lib/invoice/ai/ocr";

/**
 * Document AI provider tests — fully mocked. A throwaway RSA key signs the JWT
 * (exercising the real auth path), and fetch is stubbed for BOTH the OAuth2
 * token endpoint and the Document AI :process endpoint. No network, no real GCP.
 */

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const CREDS_JSON = JSON.stringify({
  type: "service_account",
  client_email: "invoice-ocr@example-project.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

function setDocAiEnv() {
  process.env.OCR_PROVIDER = "documentai";
  process.env.DOCAI_PROJECT_ID = "example-project";
  process.env.DOCAI_LOCATION = "us";
  process.env.DOCAI_PROCESSOR_ID = "abc123processor";
  process.env.GOOGLE_APPLICATION_CREDENTIALS = CREDS_JSON; // inline JSON form
}

function clearDocAiEnv() {
  for (const k of [
    "OCR_PROVIDER",
    "DOCAI_PROJECT_ID",
    "DOCAI_LOCATION",
    "DOCAI_PROCESSOR_ID",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ]) {
    delete process.env[k];
  }
}

/** A fetch stub that routes by URL and records the requests it saw. */
function mockFetch(processResponse: { status?: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("documentai.googleapis.com")) {
      return new Response(JSON.stringify(processResponse.body), {
        status: processResponse.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch to ${u}`);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

beforeEach(() => {
  _clearDocAiTokenCache();
  setDocAiEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearDocAiEnv();
});

describe("Document AI OCR provider", () => {
  it("mints a service-account token and returns document.text", async () => {
    const calls = mockFetch({ body: { document: { text: "TAX INVOICE\nTotal ₹1,180.00" } } });

    const provider = new DocumentAiOcr();
    const out = await provider.recognize({ buffer: Buffer.from("%PDF-1.4 fake"), mimeType: "application/pdf" });

    expect(out.text).toBe("TAX INVOICE\nTotal ₹1,180.00");

    // Token call used the JWT-bearer grant.
    const tokenCall = calls.find((c) => c.url.includes("oauth2.googleapis.com/token"))!;
    expect(String(tokenCall.init.body)).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(String(tokenCall.init.body)).toContain("assertion=");

    // Process call hit the region-scoped host + processor path with the bearer token.
    const procCall = calls.find((c) => c.url.includes("documentai.googleapis.com"))!;
    expect(procCall.url).toBe(
      "https://us-documentai.googleapis.com/v1/projects/example-project/locations/us/processors/abc123processor:process",
    );
    expect((procCall.init.headers as Record<string, string>).Authorization).toBe("Bearer fake-access-token");
    const sent = JSON.parse(String(procCall.init.body));
    expect(sent.rawDocument.mimeType).toBe("application/pdf");
    expect(Buffer.from(sent.rawDocument.content, "base64").toString("utf8")).toBe("%PDF-1.4 fake");
  });

  it("caches the access token across calls (one token mint for two documents)", async () => {
    const calls = mockFetch({ body: { document: { text: "x" } } });
    const provider = new DocumentAiOcr();
    await provider.recognize({ buffer: Buffer.from("a"), mimeType: "application/pdf" });
    await provider.recognize({ buffer: Buffer.from("b"), mimeType: "application/pdf" });
    const tokenCalls = calls.filter((c) => c.url.includes("oauth2.googleapis.com/token"));
    expect(tokenCalls.length).toBe(1);
  });

  it("throws a safe error on a Document AI API failure (no invoice content leaked)", async () => {
    mockFetch({ status: 400, body: { error: { code: 400, message: "Invalid processor" } } });
    const provider = new DocumentAiOcr();
    await expect(
      provider.recognize({ buffer: Buffer.from("secret invoice bytes"), mimeType: "application/pdf" }),
    ).rejects.toThrow(/Document AI failed: 400/);
  });

  it("throws a clear error when the credential is missing", async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    mockFetch({ body: { document: { text: "x" } } });
    const provider = new DocumentAiOcr();
    await expect(
      provider.recognize({ buffer: Buffer.from("a"), mimeType: "application/pdf" }),
    ).rejects.toThrow(/GOOGLE_APPLICATION_CREDENTIALS is not set/);
  });

  it("throws a clear error when the processor config is incomplete", async () => {
    delete process.env.DOCAI_PROCESSOR_ID;
    mockFetch({ body: { document: { text: "x" } } });
    const provider = new DocumentAiOcr();
    await expect(
      provider.recognize({ buffer: Buffer.from("a"), mimeType: "application/pdf" }),
    ).rejects.toThrow(/Document AI is not fully configured/);
  });
});

describe("OCR configuration validation", () => {
  it("getDocAiConfig returns the coordinates when all vars are set", () => {
    expect(getDocAiConfig()).toEqual({
      projectId: "example-project",
      location: "us",
      processorId: "abc123processor",
    });
  });

  it("getDocAiConfig is null when any var is missing", () => {
    delete process.env.DOCAI_LOCATION;
    expect(getDocAiConfig()).toBeNull();
  });

  it("ocrProviderConfigured is true only when fully configured", () => {
    expect(ocrProviderConfigured()).toBe(true);
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    expect(ocrProviderConfigured()).toBe(false);
  });

  it("ocrProviderConfigured is false for an unknown provider, true for tesseract", () => {
    process.env.OCR_PROVIDER = "nope";
    expect(ocrProviderConfigured()).toBe(false);
    process.env.OCR_PROVIDER = "tesseract";
    expect(ocrProviderConfigured()).toBe(true);
  });

  it("getOcrProvider returns a Document AI provider when configured, null when half-set", () => {
    expect(getOcrProvider()?.name).toBe("documentai");
    delete process.env.DOCAI_PROCESSOR_ID;
    expect(getOcrProvider()).toBeNull();
  });
});
