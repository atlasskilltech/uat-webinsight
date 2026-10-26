"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { UserPlus, Search, Pencil, Power, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { ROLE_OPTIONS } from "@/lib/auth/types";
import {
  createUserAction,
  updateUserAction,
  changeRoleAction,
  setStatusAction,
} from "./actions";
import type { AdminActionState } from "./types";

interface Row {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: Date | string | null;
  createdAt: Date | string;
}
interface AuditRow {
  id: string;
  action: string;
  actorEmail: string | null;
  targetEmail: string | null;
  createdAt: Date | string;
}

export function AdminUsersClient({
  users,
  total,
  page,
  pageSize,
  filters,
  currentUserId,
  auditLogs,
}: {
  users: Row[];
  total: number;
  page: number;
  pageSize: number;
  filters: { q: string; role: string; status: string };
  currentUserId: string;
  auditLogs: AuditRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [q, setQ] = useState(filters.q);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<Row | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pushFilter = (next: Partial<{ q: string; role: string; status: string }>) => {
    const merged = { ...filters, q, ...next };
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.role) params.set("role", merged.role);
    if (merged.status) params.set("status", merged.status);
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  };

  const goPage = (p: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.role) params.set("role", filters.role);
    if (filters.status) params.set("status", filters.status);
    if (p > 1) params.set("page", String(p));
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  };

  const onRole = (row: Row, role: string) => {
    if (role === row.role) return;
    if (row.role === "admin" && role === "user") {
      if (!confirm(`Demote ${row.email} to Standard User? They will lose admin access.`)) return;
    }
    start(async () => {
      const res = await changeRoleAction(row.id, role as "admin" | "user");
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  };

  const onStatus = (row: Row) => {
    const next = row.status === "active" ? "inactive" : "active";
    if (next === "inactive" && !confirm(`Deactivate ${row.email}? They will be signed out and blocked from signing in.`)) return;
    start(async () => {
      const res = await setStatusAction(row.id, next);
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            pushFilter({ q });
          }}
          className="relative flex-1 min-w-[200px]"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email…"
            className="pl-9"
            aria-label="Search users"
          />
        </form>
        <Select
          value={filters.role}
          onChange={(e) => pushFilter({ role: e.target.value })}
          className="w-auto"
          aria-label="Filter by role"
        >
          <Options options={[{ value: "", label: "All roles" }, ...ROLE_OPTIONS]} />
        </Select>
        <Select
          value={filters.status}
          onChange={(e) => pushFilter({ status: e.target.value })}
          className="w-auto"
          aria-label="Filter by status"
        >
          <Options
            options={[
              { value: "", label: "All statuses" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
        </Select>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4" /> New user
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={ShieldCheck} title="No users found" description="Adjust your search or filters, or create a new user." />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH>Last login</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              <TBody>
                {users.map((u) => (
                  <TR key={u.id}>
                    <TD className="font-medium">
                      {u.name}
                      {u.id === currentUserId && <span className="ml-1.5 text-xs text-muted-2">(you)</span>}
                    </TD>
                    <TD className="text-muted">{u.email}</TD>
                    <TD>
                      <Select
                        value={u.role}
                        disabled={pending}
                        onChange={(e) => onRole(u, e.target.value)}
                        className="h-8 w-auto py-0 text-xs"
                        aria-label={`Role for ${u.email}`}
                      >
                        <Options options={ROLE_OPTIONS} />
                      </Select>
                    </TD>
                    <TD>
                      <Badge tone={u.status === "active" ? "success" : "neutral"} dot>
                        {u.status === "active" ? "Active" : "Inactive"}
                      </Badge>
                    </TD>
                    <TD className="text-muted-2">{fmtDate(u.createdAt)}</TD>
                    <TD className="text-muted-2">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "Never"}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditUser(u)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => onStatus(u)} title={u.status === "active" ? "Deactivate" : "Activate"}>
                          <Power className="h-3.5 w-3.5" /> {u.status === "active" ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Page {page} of {totalPages} · {total} users
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => goPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => goPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent account activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditLogs.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={ShieldCheck} title="No activity yet" description="Administrative actions will be recorded here." />
            </div>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {auditLogs.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                  <span className="text-foreground">
                    <span className="font-mono text-xs text-accent">{a.action}</span>
                    {a.targetEmail && <span className="text-muted"> · {a.targetEmail}</span>}
                    {a.actorEmail && <span className="text-muted-2"> · by {a.actorEmail}</span>}
                  </span>
                  <span className="text-muted-2">{fmtDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {createOpen && <CreateUserDialog onClose={() => setCreateOpen(false)} />}
      {editUser && <EditUserDialog user={editUser} onClose={() => setEditUser(null)} />}
    </div>
  );
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const [state, action] = useActionState<AdminActionState, FormData>(createUserAction, idleState);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "User created.");
      router.refresh();
      onClose();
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const err = (f: string) => state.fieldErrors?.[f];

  return (
    <Dialog open onClose={onClose} title="Add user" description="Approve an account. The user signs in with Google using this email — no password is set here.">
      <form action={action} className="space-y-4">
        <Field label="Full name" required error={err("name")}>
          <Input name="name" required autoFocus />
        </Field>
        <Field label="Email" required error={err("email")}>
          <Input name="email" type="email" required />
        </Field>
        <Field label="Role" required error={err("role")}>
          <Select name="role" defaultValue="user">
            <Options options={ROLE_OPTIONS} />
          </Select>
        </Field>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton pendingLabel="Creating…">Create user</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: Row; onClose: () => void }) {
  const [state, action] = useActionState<AdminActionState, FormData>(updateUserAction, idleState);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "User updated.");
      router.refresh();
      onClose();
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const err = (f: string) => state.fieldErrors?.[f];

  return (
    <Dialog open onClose={onClose} title="Edit user" description={`Update details for ${user.email}. Role and status are changed from the table.`}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="userId" value={user.id} />
        <Field label="Full name" required error={err("name")}>
          <Input name="name" defaultValue={user.name} required autoFocus />
        </Field>
        <Field label="Email" required error={err("email")}>
          <Input name="email" type="email" defaultValue={user.email} required />
        </Field>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}
