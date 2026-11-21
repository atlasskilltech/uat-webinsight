import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * AES-256-GCM encryption for sensitive secrets (OAuth tokens, bank details).
 *
 * Key: INVOICE_ENCRYPTION_KEY — a 32-byte key provided as base64, hex, or raw
 * text (hashed to 32 bytes as a last resort). Ciphertext is stored as a single
 * compact string:  v1.<iv_b64>.<tag_b64>.<ciphertext_b64>
 *
 * NEVER log plaintext or the key. NEVER send either to the client.
 */

const PREFIX = "v1";

function resolveKey(): Buffer {
  const raw = process.env.INVOICE_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "INVOICE_ENCRYPTION_KEY is not set. Generate one, e.g. " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  // Try base64 (44 chars for 32 bytes) then hex (64 chars), else hash to 32 bytes.
  let key: Buffer | null = null;
  if (/^[A-Za-z0-9+/]+=*$/.test(raw) && Buffer.from(raw, "base64").length === 32) {
    key = Buffer.from(raw, "base64");
  } else if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  }
  if (!key) key = createHash("sha256").update(raw).digest(); // 32 bytes
  return key;
}

export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.INVOICE_ENCRYPTION_KEY?.trim());
}

/** Encrypt a UTF-8 string; returns the compact token, or null for null/empty input. */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  const key = resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}.${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

/** Decrypt a token produced by encryptSecret. Returns null for null input. */
export function decryptSecret(token: string | null | undefined): string | null {
  if (token === null || token === undefined || token === "") return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Malformed ciphertext token.");
  }
  const key = resolveKey();
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}
