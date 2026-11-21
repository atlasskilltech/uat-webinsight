import "server-only";
import { iQuery } from "../db";

/** All active organization ids (used by the worker / cron to iterate tenants). */
export async function listOrganizationIds(): Promise<string[]> {
  const rows = await iQuery<{ id: string }>("SELECT id FROM `organizations` WHERE status='active'");
  return rows.map((r) => r.id);
}
