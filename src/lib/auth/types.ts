import type { User } from "@prisma/client";

export type Role = "admin" | "user";
export type UserStatus = "active" | "inactive";

export const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "user", label: "Standard User" },
] as const;

export const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

/** A user object safe to send to the client — never includes passwordHash. */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export function toSafeUser(u: User): SafeUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: (u.role as Role) ?? "user",
    status: (u.status as UserStatus) ?? "active",
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
  };
}

export function roleLabel(role: string): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
}
