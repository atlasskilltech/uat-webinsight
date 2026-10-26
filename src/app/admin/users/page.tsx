import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
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

  const where: Prisma.UserWhereInput = {};
  if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  if (roleFilter) where.role = roleFilter;
  if (statusFilter) where.status = statusFilter;

  const [users, total, auditLogs] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      // Explicit select — passwordHash is never read or sent to the client.
      select: { id: true, name: true, email: true, role: true, status: true, lastLoginAt: true, createdAt: true },
    }),
    prisma.user.count({ where }),
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, action: true, actorEmail: true, targetEmail: true, createdAt: true },
    }),
  ]);

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
