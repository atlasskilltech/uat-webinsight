/**
 * Module access scope — which parts of Atlas Web Insight a user may use.
 *
 *   full          — all modules (the default; every existing user keeps this).
 *   invoice_only  — only the Invoice Agent (+ its connected accounts & settings),
 *                   plus the always-available login / sign-out.
 *
 * The scope is stored on the `User` row and re-read from the DB on every request
 * (Auth.js jwt callback), so an admin's change takes effect on the user's next
 * request. Enforcement is server-side: the root layout blocks restricted PAGES,
 * and the auth guards block restricted SERVER ACTIONS / API routes. Hiding nav
 * items is cosmetic only.
 */
export type AccessScope = "full" | "invoice_only";

export const DEFAULT_ACCESS_SCOPE: AccessScope = "full";

export const ACCESS_SCOPE_OPTIONS = [
  { value: "full", label: "Full Access" },
  { value: "invoice_only", label: "Invoice Agent Only" },
] as const;

/** Coerce any stored/DB value into a valid scope (unknown / null → full). */
export function normalizeAccessScope(value: string | null | undefined): AccessScope {
  return value === "invoice_only" ? "invoice_only" : "full";
}

export function accessScopeLabel(scope: string): string {
  return ACCESS_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope;
}

/**
 * Path prefixes an Invoice-Agent-only user may reach. Everything under
 * /invoices (Invoice Agent, Connected Accounts, Agent Settings, the floating
 * assistant's actions) plus the public login page. Sign-out goes through
 * /api/auth/* which is always allowed.
 */
const INVOICE_ONLY_ALLOWED_PREFIXES = ["/invoices", "/login"] as const;

/** Whether a path is reachable under the given scope (segment-boundary match). */
export function isPathAllowedForScope(scope: AccessScope, pathname: string): boolean {
  if (scope === "full") return true;
  return INVOICE_ONLY_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
