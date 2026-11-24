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
  /**
   * True when the Phase 6 forwarding-routing tables (migration 010:
   * document_categories, forwarding_destinations, forwarding_rules) are present.
   * The configurable-routing UI is hidden until this is true; the resolver falls
   * back to legacy single-destination forwarding meanwhile.
   */
  routingReady?: boolean;
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
  } catch {
    return { reachable: true, migrated: true, schemaOutdated: true };
  }
  // Phase 6 routing tables (migration 010) are optional: their absence is not
  // "schema outdated" (forwarding still works via the legacy path); it just
  // hides the configurable-routing UI until the migration runs.
  let routingReady = false;
  try {
    await iQuery("SELECT 1 FROM `forwarding_rules` LIMIT 1");
    routingReady = true;
  } catch {
    routingReady = false;
  }
  return { reachable: true, migrated: true, routingReady };
}

export interface GstinUniquenessStatus {
  /** The DB unique index on organizations.gstin is actually present. */
  enforced: boolean;
  /** Count of non-NULL GSTINs currently shared by more than one organization. */
  duplicateGroups: number;
}

/**
 * Report whether database-level GSTIN uniqueness (migration 009) is really
 * active. The migration SKIPS adding the index when pre-existing duplicates
 * would break it, so the app must read the live index state rather than assume
 * it exists — and never claim enforcement that isn't there.
 */
export async function getGstinUniquenessStatus(): Promise<GstinUniquenessStatus> {
  try {
    const idx = await iQuery<{ c: number }>(
      "SELECT COUNT(*) c FROM information_schema.STATISTICS " +
        "WHERE table_schema=DATABASE() AND table_name='organizations' AND index_name='organizations_gstin_key'",
    );
    const enforced = Number(idx[0]?.c ?? 0) > 0;
    const dup = await iQuery<{ c: number }>(
      "SELECT COUNT(*) c FROM (SELECT `gstin` FROM `organizations` WHERE `gstin` IS NOT NULL GROUP BY `gstin` HAVING COUNT(*) > 1) d",
    );
    return { enforced, duplicateGroups: Number(dup[0]?.c ?? 0) };
  } catch {
    return { enforced: false, duplicateGroups: 0 };
  }
}
