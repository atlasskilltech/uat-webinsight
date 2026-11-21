import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "@/lib/invoice/crypto";

describe("crypto: AES-256-GCM secret storage", () => {
  it("reports configured when a key is present", () => {
    expect(isEncryptionConfigured()).toBe(true);
  });
  it("round-trips a secret", () => {
    const token = encryptSecret("ya29.super-secret-oauth-token");
    expect(token).toBeTruthy();
    expect(token).not.toContain("super-secret"); // ciphertext does not leak plaintext
    expect(decryptSecret(token)).toBe("ya29.super-secret-oauth-token");
  });
  it("handles null/empty as null", () => {
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret("")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });
  it("produces a different IV/ciphertext each time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });
  it("rejects a tampered ciphertext", () => {
    const token = encryptSecret("bank-account-1234")!;
    const parts = token.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
  it("rejects a malformed token", () => {
    expect(() => decryptSecret("not-a-valid-token")).toThrow();
  });
});
