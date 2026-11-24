import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import type { SafeUser } from "@/lib/auth/types";
import { iQuery, iQueryOne } from "./db";
import { anyActiveOrganizationExists } from "./services/org-admin";
import type { FinanceRole } from "./types";

/**
 * Cookie that remembers which organization the user is currently acting in
 * (multi-org). It is only a HINT: getInvoiceContext honors it solely when the
 * user is an active member of that org AND the org is active, so it can never be
 * used to reach an org the user doesn't belong to.
 */
export const ACTIVE_ORG_COOKIE = "inv_active_org";

async function readActiveOrgCookie(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(ACTIVE_ORG_COOKIE)?.value ?? null;
  } catch {
    return null; // called outside a request scope — no hint available
  }
}

/** Remember the active org (call only from a Server Action / Route Handler). */
export async function setActiveOrgCookie(organizationId: string): Promise<void> {
  const store = await cookies();
  store.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Forget the active org (e.g. after deactivating the current one). */
export async function clearActiveOrgCookie(): Promise<void> {
  try {
    const store = await cookies();
    store.delete(ACTIVE_ORG_COOKIE);
  } catch {
    /* not in a mutable request scope */
  }
}

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
  address: unknown; // JSON column; { text?: string } or null
}

const ORG_COLUMNS = "`id`,`name`,`legal_name`,`gstin`,`pan`,`base_currency`,`status`,`address`";

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
  /** True when the user may reach the module to set up the FIRST org. */
  canSetup: boolean;
  /** True when at least one active organization already exists. */
  orgExists: boolean;
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
        orgExists: false,
      };
    }

    if (memberships.length === 0) {
      // No membership yet. An app admin may provision an organization (the first
      // one, or a genuinely separate one such as ISDI). Accidental duplicates of
      // an EXISTING org are prevented at creation time by a GSTIN/name match, not
      // by blocking all creation — so multiple legitimate orgs are supported.
      // A non-admin is never shown setup; they must be added by a Finance Admin.
      const orgExists = await anyActiveOrganizationExists().catch(() => false);
      return {
        user,
        organization: null,
        organizationId: null,
        member: null,
        role: null,
        canSetup: user.role === "admin",
        orgExists,
      };
    }

    // MULTI-ORG: a user may belong to several organizations. Load the ACTIVE org
    // rows for their memberships, then pick the one to act in:
    //   1. the explicit requestedOrgId (server-validated against membership), else
    //   2. the active-org cookie (same validation), else
    //   3. the first membership whose org is active.
    // The cookie/param is a HINT only — a value the user is not a member of, or
    // that names an inactive org, is ignored. This is the org-isolation anchor.
    const orgIds = memberships.map((m) => m.organization_id);
    const placeholders = orgIds.map(() => "?").join(",");
    const activeOrgs = await iQuery<OrganizationRow>(
      `SELECT ${ORG_COLUMNS} FROM \`organizations\` WHERE \`id\` IN (${placeholders}) AND \`status\`='active'`,
      orgIds,
    );
    const activeById = new Map(activeOrgs.map((o) => [o.id, o]));

    const wanted = requestedOrgId ?? (await readActiveOrgCookie());
    const chosen =
      (wanted && memberships.find((m) => m.organization_id === wanted && activeById.has(m.organization_id))) ||
      memberships.find((m) => activeById.has(m.organization_id)) ||
      null;

    if (!chosen) {
      // The user has memberships, but every one of their orgs is deactivated.
      const orgExists = await anyActiveOrganizationExists().catch(() => false);
      return {
        user,
        organization: null,
        organizationId: null,
        member: null,
        role: null,
        canSetup: user.role === "admin",
        orgExists,
      };
    }

    const organization = activeById.get(chosen.organization_id) ?? null;
    return {
      user,
      organization,
      organizationId: organization?.id ?? null,
      member: chosen,
      role: chosen.role,
      canSetup: false, // already a member — no bootstrap needed
      orgExists: true,
    };
  },
);

/**
 * All organizations the user is an active member of, with their role and the
 * org's active/inactive status — for the org switcher and management list.
 * Includes inactive orgs (so a Finance Admin can reactivate one). Scoped to
 * the user's own memberships: never lists an org they don't belong to.
 */
export interface UserOrganization {
  id: string;
  name: string;
  legal_name: string | null;
  gstin: string | null;
  role: FinanceRole;
  status: string; // 'active' when the org itself is active
}

export const listUserOrganizations = cache(async (user: SafeUser): Promise<UserOrganization[]> => {
  return iQuery<UserOrganization>(
    "SELECT o.`id`, o.`name`, o.`legal_name`, o.`gstin`, m.`role`, o.`status` " +
      "FROM `organization_members` m JOIN `organizations` o ON o.`id` = m.`organization_id` " +
      "WHERE (m.`user_id` = ? OR m.`user_email` = ?) AND m.`status`='active' " +
      "ORDER BY (o.`status`='active') DESC, o.`name` ASC",
    [user.id, user.email.toLowerCase()],
  );
});

/** Is the user an active member of this org? (server-side isolation check) */
export async function isMemberOf(user: SafeUser, organizationId: string): Promise<boolean> {
  const row = await iQueryOne<{ id: string }>(
    "SELECT `id` FROM `organization_members` WHERE `organization_id`=? AND (`user_id`=? OR `user_email`=?) AND `status`='active' LIMIT 1",
    [organizationId, user.id, user.email.toLowerCase()],
  );
  return Boolean(row);
}

/** Narrow a context to one with a resolved organization, or throw. */
export function assertOrganization(
  ctx: InvoiceContext | null,
): asserts ctx is InvoiceContext & { organizationId: string; role: FinanceRole } {
  if (!ctx) throw new Error("Not authenticated.");
  if (!ctx.organizationId || !ctx.role) {
    throw new Error("No active organization. Complete Invoice Agent setup first.");
  }
}
