import "server-only";
import { AuthError } from "@/lib/auth/guard";
import { getInvoiceContext, type InvoiceContext } from "./org";
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
