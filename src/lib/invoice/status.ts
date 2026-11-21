import "server-only";
import { iQuery } from "./db";

/**
 * Health of the dedicated invoice database, so the UI can show an honest state
 * (not configured / not migrated / ready) instead of crashing or faking data.
 */
export interface InvoiceDbStatus {
  reachable: boolean;
  migrated: boolean;
  error?: string;
}

export async function getInvoiceDbStatus(): Promise<InvoiceDbStatus> {
  try {
    await iQuery("SELECT 1 AS ok");
  } catch (e) {
    return { reachable: false, migrated: false, error: e instanceof Error ? e.message : "unreachable" };
  }
  try {
    // organizations is created by the first migration; its presence => migrated.
    await iQuery("SELECT 1 FROM `organizations` LIMIT 1");
    return { reachable: true, migrated: true };
  } catch {
    return { reachable: true, migrated: false };
  }
}
