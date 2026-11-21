import { describe, it, expect } from "vitest";
import {
  sniffType,
  validateUpload,
  makeLocalSignedToken,
  verifyLocalSignedToken,
} from "@/lib/invoice/storage";

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);

describe("storage: file signature sniffing", () => {
  it("detects supported types by magic bytes", () => {
    expect(sniffType(PDF)?.mime).toBe("application/pdf");
    expect(sniffType(PNG)?.mime).toBe("image/png");
    expect(sniffType(JPG)?.mime).toBe("image/jpeg");
    expect(sniffType(WEBP)?.mime).toBe("image/webp");
  });
  it("rejects unknown content", () => {
    expect(sniffType(Buffer.from("hello world"))).toBeNull();
  });
});

describe("storage: upload validation", () => {
  it("accepts a valid PDF and returns a sha256", () => {
    const v = validateUpload(PDF, "application/pdf");
    expect(v.ok).toBe(true);
    expect(v.mime).toBe("application/pdf");
    expect(v.sha256).toHaveLength(64);
  });
  it("rejects an empty file", () => {
    expect(validateUpload(Buffer.alloc(0)).ok).toBe(false);
  });
  it("rejects a declared/content mismatch (png claimed for a pdf)", () => {
    const v = validateUpload(PDF, "image/png");
    expect(v.ok).toBe(false);
  });
  it("tolerates image/jpg vs image/jpeg", () => {
    expect(validateUpload(JPG, "image/jpg").ok).toBe(true);
  });
  it("rejects an unsupported type", () => {
    expect(validateUpload(Buffer.from("plain text file"), "text/plain").ok).toBe(false);
  });
});

describe("storage: signed download tokens", () => {
  it("round-trips a key", () => {
    const token = makeLocalSignedToken("org/abc/2026-11/file.pdf", 300);
    expect(verifyLocalSignedToken(token)).toBe("org/abc/2026-11/file.pdf");
  });
  it("rejects an expired token", () => {
    const token = makeLocalSignedToken("org/abc/x.pdf", -1); // already expired
    expect(verifyLocalSignedToken(token)).toBeNull();
  });
  it("rejects a tampered token", () => {
    const token = makeLocalSignedToken("org/abc/x.pdf", 300);
    const bad = Buffer.from(Buffer.from(token, "base64url").toString("utf8").replace("x.pdf", "y.pdf")).toString("base64url");
    expect(verifyLocalSignedToken(bad)).toBeNull();
  });
});
