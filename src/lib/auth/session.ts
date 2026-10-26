import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import type { SafeUser } from "./types";

/**
 * Resolve the current user from the Auth.js (Google) session. Read-only and
 * request-deduplicated. Returns null when there is no session or the user is
 * not active — so a deactivated user is blocked on their next request (the JWT
 * callback re-reads status from the DB each request).
 */
export const getCurrentUser = cache(async (): Promise<SafeUser | null> => {
  const session = await auth();
  const u = session?.user;
  if (!u?.email || !u.id) return null;
  if (u.status !== "active") return null;
  return {
    id: u.id,
    name: u.name ?? u.email,
    email: u.email,
    role: u.role === "admin" ? "admin" : "user",
    status: "active",
    lastLoginAt: null,
    createdAt: new Date(0),
  };
});
