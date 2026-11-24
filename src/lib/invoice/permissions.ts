import "server-only";
import { AuthError } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/auth/session";
import { iQueryOne } from "./db";
import {
  getInvoiceContext,
  type InvoiceContext,
  type MemberRow,
  type OrganizationRow,
} from "./org";
import { roleHasCapability, type FinanceCapability } from "./types";

/**
 * Server-side authorization for the Invoice Agent. Every API route, server
 * action and agent tool call must pass through requireCapability(). Nothing here
 * trusts client-provided roles or organization ids.
 */

/** Require an authenticated user with a resolved org + the given capability. */
export async function requireCapability(
  cap: FinanceCapability,
  requestedOrgId?: string | null,
): Promise<InvoiceContext & { organizationId: string }> {
  const ctx = await getInvoiceContext(requestedOrgId);
  if (!ctx) throw new AuthError("You must be signed in.", 401);
  if (!ctx.organizationId || !ctx.role) {
    throw new AuthError(
      "No active organization for the Invoice Agent. Complete setup first.",
      403,
    );
  }
  if (!roleHasCapability(ctx.role, cap)) {
    throw new AuthError(`Your finance role lacks permission for: ${cap}.`, 403);
  }
  return ctx as InvoiceContext & { organizationId: string };
}

/**
 * STRICT per-organization authorization for an EXPLICITLY targeted org. Unlike
 * requireCapability (which resolves the caller's active org and may fall back to
 * another membership when a hint is invalid), this validates membership + role
 * for EXACTLY `organizationId` and NEVER falls back:
 *   - not an active member of that org            -> 403
 *   - a member but the role lacks the capability  -> 403
 * It deliberately does NOT require the org to be active, so a Finance Admin can
 * still manage (e.g. reactivate) an org they administer. Use this for every
 * organization-specific WRITE where the org id comes from the client.
 */
export async function requireCapabilityForOrg(
  cap: FinanceCapability,
  organizationId: string,
): Promise<InvoiceContext & { organizationId: string; role: NonNullable<InvoiceContext["role"]> }> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("You must be signed in.", 401);
  if (!organizationId) throw new AuthError("No organization specified.", 400);

  const member = await iQueryOne<MemberRow>(
    "SELECT * FROM `organization_members` WHERE `organization_id`=? AND (`user_id`=? OR `user_email`=?) AND `status`='active' LIMIT 1",
    [organizationId, user.id, user.email.toLowerCase()],
  );
  if (!member) {
    // Explicit target, not a member — never silently act on a different org.
    throw new AuthError("You are not a member of that organization.", 403);
  }
  if (!roleHasCapability(member.role, cap)) {
    throw new AuthError(`Your finance role lacks permission for: ${cap}.`, 403);
  }
  const organization = await iQueryOne<OrganizationRow>(
    "SELECT `id`,`name`,`legal_name`,`gstin`,`pan`,`base_currency`,`status`,`address` FROM `organizations` WHERE `id`=?",
    [organizationId],
  );
  return {
    user,
    organization,
    organizationId,
    member,
    role: member.role,
    canSetup: false,
    orgExists: true,
  };
}

/** Require module access (authenticated + member OR app admin in setup mode). */
export async function requireInvoiceModuleAccess(): Promise<InvoiceContext> {
  const ctx = await getInvoiceContext();
  if (!ctx) throw new AuthError("You must be signed in.", 401);
  if (!ctx.organizationId && !ctx.canSetup) {
    throw new AuthError("You do not have access to the Invoice Agent.", 403);
  }
  return ctx;
}

/** Non-throwing capability check for conditional UI (still re-checked server-side). */
export async function hasCapability(cap: FinanceCapability): Promise<boolean> {
  const ctx = await getInvoiceContext();
  return Boolean(ctx?.role && roleHasCapability(ctx.role, cap));
}
