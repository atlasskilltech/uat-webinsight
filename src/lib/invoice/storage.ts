import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getInvoiceFeatureFlags } from "./config";

/**
 * Private document storage abstraction for the Invoice Agent.
 *
 * Providers:
 *  - "local" (default): encrypted-at-rest is the host's responsibility; files
 *    live under INVOICE_STORAGE_DIR, never under /public, never web-served
 *    directly. Access is via an authorized download route + signed token.
 *  - "s3": S3-compatible object storage (requires @aws-sdk/client-s3 installed
 *    and S3_* env). Objects are private; access via presigned URLs.
 *
 * Original documents are retained; callers must validate uploads (see
 * validateUpload) before storing.
 */

export interface StoredObject {
  provider: "local" | "s3";
  key: string;
  size: number;
  sha256: string;
  contentType: string;
}

export interface StorageDriver {
  readonly provider: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Short-lived authorized URL for viewing/downloading the object. */
  signedUrl(key: string, expiresSeconds?: number): Promise<string>;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function signingSecret(): Buffer {
  const raw = process.env.INVOICE_ENCRYPTION_KEY?.trim() || "insecure-dev-storage-secret";
  return createHash("sha256").update(`storage:${raw}`).digest();
}

/** Build a tamper-proof token for the local download route. */
export function makeLocalSignedToken(key: string, expiresSeconds = 300): string {
  const exp = Date.now() + expiresSeconds * 1000;
  const payload = `${key}|${exp}`;
  const mac = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return Buffer.from(`${payload}|${mac}`).toString("base64url");
}

/** Validate a local signed token; returns the key if valid and unexpired. */
export function verifyLocalSignedToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [key, expStr, mac] = decoded.split("|");
    if (!key || !expStr || !mac) return null;
    const expected = createHmac("sha256", signingSecret())
      .update(`${key}|${expStr}`)
      .digest("base64url");
    if (mac !== expected) return null;
    if (Date.now() > Number(expStr)) return null;
    return key;
  } catch {
    return null;
  }
}

class LocalStorageDriver implements StorageDriver {
  readonly provider = "local" as const;
  private baseDir = process.env.INVOICE_STORAGE_DIR?.trim() || path.join(process.cwd(), ".invoice-storage");

  private full(key: string): string {
    // Prevent path traversal — keys are opaque, no "..".
    const safe = key.replace(/\.\.(\/|\\)/g, "");
    return path.join(this.baseDir, safe);
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const p = this.full(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, { mode: 0o600 });
    return { provider: this.provider, key, size: data.length, sha256: sha256(data), contentType };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.full(key), { force: true });
  }

  async signedUrl(key: string, expiresSeconds = 300): Promise<string> {
    // Served by an authorized route (added with the document-serving milestone).
    return `/api/invoices/documents?token=${makeLocalSignedToken(key, expiresSeconds)}`;
  }
}

class S3StorageDriver implements StorageDriver {
  readonly provider = "s3" as const;

  private async client(): Promise<{ s3: unknown; bucket: string }> {
    const bucket = process.env.S3_BUCKET?.trim();
    const region = process.env.S3_REGION?.trim();
    if (!bucket || !region) {
      throw new Error("S3 storage is selected but S3_BUCKET / S3_REGION are not set.");
    }
    // Dynamic, non-literal specifier so the build does not require the SDK to be
    // installed until S3 is actually used. Install it to enable S3:
    //   npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
    const spec = "@aws-sdk/client-s3";
    let mod: { S3Client: new (cfg: unknown) => unknown };
    try {
      mod = (await import(spec)) as typeof mod;
    } catch {
      throw new Error(
        "S3 storage selected but @aws-sdk/client-s3 is not installed. " +
          "Run: npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner",
      );
    }
    const s3 = new mod.S3Client({
      region,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
      ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}),
    });
    return { s3, bucket };
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const { s3, bucket } = await this.client();
    const spec = "@aws-sdk/client-s3";
    const mod = (await import(spec)) as { PutObjectCommand: new (i: unknown) => unknown };
    await (s3 as { send: (c: unknown) => Promise<unknown> }).send(
      new mod.PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: contentType }),
    );
    return { provider: this.provider, key, size: data.length, sha256: sha256(data), contentType };
  }

  async get(key: string): Promise<Buffer> {
    const { s3, bucket } = await this.client();
    const spec = "@aws-sdk/client-s3";
    const mod = (await import(spec)) as { GetObjectCommand: new (i: unknown) => unknown };
    const res = (await (s3 as { send: (c: unknown) => Promise<{ Body: unknown }> }).send(
      new mod.GetObjectCommand({ Bucket: bucket, Key: key }),
    )) as { Body: { transformToByteArray: () => Promise<Uint8Array> } };
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    const { s3, bucket } = await this.client();
    const spec = "@aws-sdk/client-s3";
    const mod = (await import(spec)) as { DeleteObjectCommand: new (i: unknown) => unknown };
    await (s3 as { send: (c: unknown) => Promise<unknown> }).send(
      new mod.DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  }

  async signedUrl(key: string, expiresSeconds = 300): Promise<string> {
    const { s3, bucket } = await this.client();
    const spec = "@aws-sdk/client-s3";
    const presignSpec = "@aws-sdk/s3-request-presigner";
    const cmdMod = (await import(spec)) as { GetObjectCommand: new (i: unknown) => unknown };
    const presign = (await import(presignSpec)) as {
      getSignedUrl: (c: unknown, cmd: unknown, opts: unknown) => Promise<string>;
    };
    return presign.getSignedUrl(
      s3,
      new cmdMod.GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: expiresSeconds },
    );
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const { storageProvider } = getInvoiceFeatureFlags();
  driver = storageProvider === "s3" ? new S3StorageDriver() : new LocalStorageDriver();
  return driver;
}

/** Generate an opaque storage key for an org's document. */
export function newStorageKey(organizationId: string, filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, "");
  const rand = randomBytes(16).toString("hex");
  const yyyymm = new Date().toISOString().slice(0, 7); // YYYY-MM
  return `org/${organizationId}/${yyyymm}/${rand}${ext}`;
}

// ---------------------------------------------------------------------------
// Upload validation — file signature (magic bytes) + MIME + size.
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = Math.max(
  1,
  Number(process.env.INVOICE_MAX_UPLOAD_MB) || 20,
) * 1024 * 1024;

export interface AllowedType {
  mime: string;
  ext: string;
}

export interface UploadValidationResult {
  ok: boolean;
  mime?: string;
  ext?: string;
  sha256?: string;
  error?: string;
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/** Detect a supported document type from its magic bytes. */
export function sniffType(buf: Buffer): AllowedType | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return { mime: "application/pdf", ext: ".pdf" }; // %PDF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: ".jpg" };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: "image/png", ext: ".png" };
  // WebP: "RIFF"...."WEBP"
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8))
    return { mime: "image/webp", ext: ".webp" };
  return null;
}

/**
 * Validate an uploaded document by SIGNATURE (not just the declared MIME),
 * enforce the size limit, and return the canonical mime/ext + content hash.
 */
export function validateUpload(
  buf: Buffer,
  declaredMime?: string,
): UploadValidationResult {
  if (buf.length === 0) return { ok: false, error: "Empty file." };
  if (buf.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `File too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).` };
  }
  const sniffed = sniffType(buf);
  if (!sniffed) {
    return { ok: false, error: "Unsupported file type. Allowed: PDF, JPEG, PNG, WebP." };
  }
  // If the client declared a type, it must be consistent with the signature.
  if (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== sniffed.mime) {
    // image/jpg vs image/jpeg tolerance
    const norm = declaredMime === "image/jpg" ? "image/jpeg" : declaredMime;
    if (norm !== sniffed.mime) {
      return { ok: false, error: `Declared type ${declaredMime} does not match file content.` };
    }
  }
  return { ok: true, mime: sniffed.mime, ext: sniffed.ext, sha256: sha256(buf) };
}
