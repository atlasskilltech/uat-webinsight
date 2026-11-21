import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import type { SafeUser } from "@/lib/auth/types";
import { iQuery, iQueryOne } from "./db";
import type { FinanceRole } from "./types";

/**
 * Resolve the caller's Invoice-Agent context: the app user, their organization,
 * and their finance role within it. ORGANIZATION ISOLATION is anchored here —
 * every invoice query must be scoped to `context.organizationId`, which is
 * resolved server-side from membership and NEVER taken from client input.
 *
 * Single-org bootstrap: while no organization exists yet, an app admin is
 * allowed into the module in "setup" mode (organization === null) so they can
 * create the first organization and membership from Settings. All data actions
 * still require a resolved organization + capability.
 */
export interface OrganizationRow {
  id: string;
  name: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  base_currency: string;
  status: string;
}

export interface MemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  user_email: string;
  role: FinanceRole;
  status: string;
}

export interface InvoiceContext {
  user: SafeUser;
  /** Null only in setup mode (app admin, no org yet). */
  organization: OrganizationRow | null;
  organizationId: string | null;
  member: MemberRow | null;
  role: FinanceRole | null;
  /** True when the user may reach the module to set up the first org. */
  canSetup: boolean;
}

/** List organizations the current user belongs to (active memberships). */
async function membershipsFor(user: SafeUser): Promise<MemberRow[]> {
  return iQuery<MemberRow>(
    "SELECT * FROM `organization_members` WHERE (`user_id` = ? OR `user_email` = ?) " +
      "AND `status` = 'active' ORDER BY `created_at` ASC",
    [user.id, user.email.toLowerCase()],
  );
}

/**
 * Resolve the invoice context. `requestedOrgId` (e.g. from a validated cookie/
 * param) is honored ONLY if the user is actually a member of that org.
 */
export const getInvoiceContext = cache(
  async (requestedOrgId?: string | null): Promise<InvoiceContext | null> => {
    const user = await getCurrentUser();
    if (!user) return null;

    // The invoice DB may not be migrated yet. Don't let that lock an app admin
    // out of the module they need to initialize.
    let memberships: MemberRow[] = [];
    try {
      memberships = await membershipsFor(user);
    } catch {
      return {
        user,
        organization: null,
        organizationId: null,
        member: null,
        role: null,
        canSetup: user.role === "admin",
      };
    }

    if (memberships.length === 0) {
      // No membership yet. App admins may enter setup mode.
      const canSetup = user.role === "admin";
      return {
        user,
        organization: null,
        organizationId: null,
        member: null,
        role: null,
        canSetup,
      };
    }

    const chosen =
      (requestedOrgId && memberships.find((m) => m.organization_id === requestedOrgId)) ||
      memberships[0];

    const organization = await iQueryOne<OrganizationRow>(
      "SELECT `id`,`name`,`legal_name`,`gstin`,`pan`,`base_currency`,`status` " +
        "FROM `organizations` WHERE `id` = ? AND `status` = 'active'",
      [chosen.organization_id],
    );

    return {
      user,
      organization,
      organizationId: organization?.id ?? null,
      member: chosen,
      role: chosen.role,
      canSetup: user.role === "admin",
    };
  },
);

/** Narrow a context to one with a resolved organization, or throw. */
export function assertOrganization(
  ctx: InvoiceContext | null,
): asserts ctx is InvoiceContext & { organizationId: string; role: FinanceRole } {
  if (!ctx) throw new Error("Not authenticated.");
  if (!ctx.organizationId || !ctx.role) {
    throw new Error("No active organization. Complete Invoice Agent setup first.");
  }
}
