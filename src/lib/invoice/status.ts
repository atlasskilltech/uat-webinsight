import "server-only";
import { iQuery } from "./db";

/**
 * Health of the dedicated invoice database, so the UI can show an honest state
 * (not configured / not migrated / ready) instead of crashing or faking data.
 */
export interface InvoiceDbStatus {
  reachable: boolean;
  migrated: boolean;
  /**
   * True when the base schema is present (migrated) but a LATER migration has
   * not been applied — e.g. the app was deployed before `invoice:db:init` ran.
   * The UI surfaces this so an admin runs the migration, and read paths degrade
   * gracefully meanwhile instead of crashing.
   */
  schemaOutdated?: boolean;
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
  } catch {
    return { reachable: true, migrated: false };
  }
  // Base schema is present. Check the newest table (migration 008) so a
  // deploy-before-migrate state is reported honestly rather than crashing.
  try {
    await iQuery("SELECT 1 FROM `forwarding_cc_recipients` LIMIT 1");
    return { reachable: true, migrated: true };
  } catch {
    return { reachable: true, migrated: true, schemaOutdated: true };
  }
}
