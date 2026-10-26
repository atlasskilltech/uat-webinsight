import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { query } from "@/lib/db";
import type { User, AdminAuditLog } from "@/lib/models";
import { getCurrentUser } from "@/lib/auth/session";
import { AdminUsersClient } from "./users-client";

export const metadata: Metadata = { title: "User Management" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }>;
}) {
  // Authoritative server-side gate (not just hidden nav).
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  if (current.role !== "admin") {
    return (
      <div>
        <PageHeader title="User Management" description="Manage accounts, roles and access." />
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-foreground">
            <ShieldAlert className="h-5 w-5 text-danger" />
            <span>
              <strong>Access denied.</strong> You need an administrator account to view user management.
            </span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const roleFilter = sp.role === "admin" || sp.role === "user" ? sp.role : "";
  const statusFilter = sp.status === "active" || sp.status === "inactive" ? sp.status : "";
  const page = Math.max(1, Number(sp.page) || 1);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (q) {
    conditions.push("(`name` LIKE ? OR `email` LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (roleFilter) {
    conditions.push("`role` = ?");
    params.push(roleFilter);
  }
  if (statusFilter) {
    conditions.push("`status` = ?");
    params.push(statusFilter);
  }
  const whereSql = conditions.length ? conditions.join(" AND ") : "1=1";

  const [users, totalRows, auditLogs] = await Promise.all([
    // Explicit column list — passwordHash is never read or sent to the client.
    query<Pick<User, "id" | "name" | "email" | "role" | "status" | "lastLoginAt" | "createdAt">>(
      "SELECT `id`, `name`, `email`, `role`, `status`, `lastLoginAt`, `createdAt` FROM `User` WHERE " +
        whereSql +
        " ORDER BY `createdAt` DESC LIMIT ? OFFSET ?",
      [...params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    ),
    query<{ c: number }>("SELECT COUNT(*) AS c FROM `User` WHERE " + whereSql, params),
    query<Pick<AdminAuditLog, "id" | "action" | "actorEmail" | "targetEmail" | "createdAt">>(
      "SELECT `id`, `action`, `actorEmail`, `targetEmail`, `createdAt` FROM `AdminAuditLog` ORDER BY `createdAt` DESC LIMIT 25",
    ),
  ]);
  const total = Number(totalRows[0]?.c ?? 0);

  return (
    <div>
      <PageHeader title="User Management" description="Create and manage accounts, roles and access for Atlas Web Insight." />
      <AdminUsersClient
        users={users}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        filters={{ q, role: roleFilter, status: statusFilter }}
        currentUserId={current.id}
        auditLogs={auditLogs}
      />
    </div>
  );
}
