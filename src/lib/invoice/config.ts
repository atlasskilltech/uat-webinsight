/**
 * Atlas Invoice Agent — environment configuration.
 *
 * The Invoice Agent's database is named by ATLAS_INVOICE_DB_NAME (default
 * `atlas_invoice`). Connection parts (host/user/password/port) fall back to the
 * main app's DB_* credentials, so it can run on its own dedicated schema OR share
 * the existing `atlas_dashboard` database by setting ATLAS_INVOICE_DB_NAME=
 * atlas_dashboard. Either way the Invoice Agent only ever creates/uses its own
 * snake_case tables (no name overlap with the PascalCase Web Insight tables) and
 * its migrations never modify the existing Web Insight tables.
 *
 * This module reads env only; it never connects. It is safe to import anywhere.
 */

export interface InvoiceDbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Polling-fallback staleness window in minutes. Gmail push (Pub/Sub) is the
 * primary detection path; this periodic sync only catches missed/expired
 * notifications, so it is CAPPED at 2 minutes (the maximum fallback latency).
 * An env override may lower it (min 1) but never raise it above 2.
 */
export function gmailPollFallbackMinutes(): number {
  const raw = Number(process.env.GMAIL_SYNC_INTERVAL_MIN);
  const v = Number.isFinite(raw) && raw > 0 ? raw : 2;
  return Math.max(1, Math.min(2, v));
}

/** Resolve invoice DB connection settings (INVOICE_* → fallback to main DB_*). */
export function getInvoiceDbConfig(): InvoiceDbConfig {
  const host = process.env.ATLAS_INVOICE_DB_HOST?.trim() || process.env.DB_HOST?.trim();
  const user = process.env.ATLAS_INVOICE_DB_USER?.trim() || process.env.DB_USER?.trim();
  const password =
    process.env.ATLAS_INVOICE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? "";
  // The Invoice Agent's database name. Defaults to `atlas_invoice`; set
  // ATLAS_INVOICE_DB_NAME=atlas_dashboard to share the main app's database.
  const database =
    process.env.ATLAS_INVOICE_DB_NAME?.trim() || "atlas_invoice";
  const port = Number(
    process.env.ATLAS_INVOICE_DB_PORT?.trim() || process.env.DB_PORT?.trim() || "3306",
  );

  if (!host || !user) {
    throw new Error(
      "Invoice database is not configured. Set ATLAS_INVOICE_DB_HOST/USER/PASSWORD/NAME " +
        "(or reuse the main DB_HOST/DB_USER/DB_PASSWORD with ATLAS_INVOICE_DB_NAME).",
    );
  }
  return { host, port, user, password, database };
}

// --- OCR provider configuration ---------------------------------------------
// Pure env reads (no server-only, fs or network) so this stays safe to import
// anywhere, including client components that render provider status.

export interface DocAiConfig {
  projectId: string;
  location: string;
  processorId: string;
}

/** Document AI processor coordinates, or null when any part is missing. */
export function getDocAiConfig(): DocAiConfig | null {
  const projectId = process.env.DOCAI_PROJECT_ID?.trim();
  const location = process.env.DOCAI_LOCATION?.trim();
  const processorId = process.env.DOCAI_PROCESSOR_ID?.trim();
  if (!projectId || !location || !processorId) return null;
  return { projectId, location, processorId };
}

/** Is a service-account credential pointer present for Document AI? */
export function docAiCredentialsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim());
}

/**
 * Accurately validate that the SELECTED OCR provider has everything it needs.
 * - no OCR_PROVIDER            -> false (OCR off, honest)
 * - "tesseract"               -> true (local; no env config required)
 * - "documentai"             -> requires DOCAI_PROJECT_ID/LOCATION/PROCESSOR_ID
 *                                 and GOOGLE_APPLICATION_CREDENTIALS
 * - any other / unknown name  -> false (no implementation; never faked)
 */
export function ocrProviderConfigured(): boolean {
  const name = process.env.OCR_PROVIDER?.trim().toLowerCase();
  if (!name) return false;
  if (name === "tesseract") return true;
  if (name === "documentai") return getDocAiConfig() !== null && docAiCredentialsConfigured();
  return false;
}

/** Feature/provider availability — used to render honest "connected/not set up" states. */
export interface InvoiceFeatureFlags {
  encryptionConfigured: boolean;
  aiConfigured: boolean;
  ocrConfigured: boolean;
  gmailConfigured: boolean;
  storageProvider: "local" | "s3";
  s3Configured: boolean;
}

export function getInvoiceFeatureFlags(): InvoiceFeatureFlags {
  const storageProvider =
    (process.env.INVOICE_STORAGE_PROVIDER?.trim().toLowerCase() === "s3" ? "s3" : "local") as
      | "local"
      | "s3";
  return {
    encryptionConfigured: Boolean(process.env.INVOICE_ENCRYPTION_KEY?.trim()),
    aiConfigured: Boolean(process.env.AI_API_KEY?.trim() && process.env.AI_PROVIDER?.trim()),
    ocrConfigured: ocrProviderConfigured(),
    gmailConfigured: Boolean(
      process.env.GMAIL_CLIENT_ID?.trim() && process.env.GMAIL_CLIENT_SECRET?.trim(),
    ),
    storageProvider,
    s3Configured: Boolean(
      process.env.S3_BUCKET?.trim() &&
        process.env.S3_REGION?.trim() &&
        process.env.S3_ACCESS_KEY_ID?.trim() &&
        process.env.S3_SECRET_ACCESS_KEY?.trim(),
    ),
  };
}

/** Worker tuning. */
export const WORKER_CONCURRENCY = Math.max(
  1,
  Number(process.env.INVOICE_WORKER_CONCURRENCY) || 2,
);
export const JOB_RETRY_LIMIT = Math.max(1, Number(process.env.INVOICE_JOB_RETRY_LIMIT) || 5);
