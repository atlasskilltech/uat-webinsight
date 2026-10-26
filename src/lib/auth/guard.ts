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

/** Require an authenticated admin. Throws AuthError(401/403) otherwise. */
export async function requireAdmin(): Promise<SafeUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new AuthError("Admin access is required.", 403);
  return user;
}

export function isAuthError(e: unknown): e is AuthError {
  return e instanceof AuthError;
}
