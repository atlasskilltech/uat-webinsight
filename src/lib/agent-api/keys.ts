import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Key helpers for the ATLAS Agent API (docs/AGENT-API.md).
 *
 * A key is a random, opaque secret shown to the admin exactly once. Only its
 * SHA-256 hash is persisted, so a database leak never leaks usable keys. The
 * hash is compared in constant time.
 */

export const KEY_PREFIX = "atl_";

/** SHA-256 hex digest of a key (what we store and compare). */
export function hashKey(key: string): string {
  return createHash("sha256").update(String(key)).digest("hex");
}

/** A fresh random key: `atl_` + 32 random bytes (base64url) — well over 32 chars. */
export function generateKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

/** Last 4 characters of a key, shown later so admins can tell keys apart. */
export function keyLast4(key: string): string {
  return key.slice(-4);
}

/** Constant-time comparison of two hex digests of equal length. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Extracts the key from an `Authorization: Bearer <key>` header, or null. */
export function bearerKey(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(String(header || "").trim());
  return m && m[1].startsWith(KEY_PREFIX) ? m[1] : null;
}

/** Strips the IPv4-mapped IPv6 prefix from a client IP. */
export function normaliseIp(ip: string | null | undefined): string {
  return String(ip || "").replace(/^::ffff:/, "").trim();
}

/** True when `ip` is allowed by a comma-separated allowlist (empty list = any). */
export function ipAllowed(allowedIps: string | null | undefined, ip: string): boolean {
  const list = String(allowedIps || "")
    .split(",")
    .map((s) => normaliseIp(s))
    .filter(Boolean);
  if (!list.length) return true;
  return list.includes(normaliseIp(ip));
}
