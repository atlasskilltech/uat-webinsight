import "server-only";
import { getCurrentUser } from "./session";
import type { SafeUser } from "./types";

/** Thrown by the require* guards; carries an HTTP-style status for callers. */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/** Require any authenticated, active user. Throws AuthError(401) otherwise. */
export async function requireUser(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("You must be signed in to do that.", 401);
  return user;
}

/**
 * Require an authenticated user with FULL module access. Invoice-Agent-only
 * users are rejected (403) — use this to protect server actions / API routes
 * that belong to the restricted (non-Invoice-Agent) modules. The scope is read
 * fresh from the DB each request, so a revocation takes effect immediately.
 */
export async function requireFullAccess(): Promise<SafeUser> {
  const user = await requireUser();
  if (user.accessScope !== "full") {
    throw new AuthError("This area is not available with Invoice-Agent-only access.", 403);
  }
  return user;
}

/** Require an authenticated full-access admin. Throws AuthError(401/403) otherwise. */
export async function requireAdmin(): Promise<SafeUser> {
  const user = await requireFullAccess();
  if (user.role !== "admin") throw new AuthError("Admin access is required.", 403);
  return user;
}

export function isAuthError(e: unknown): e is AuthError {
  return e instanceof AuthError;
}
