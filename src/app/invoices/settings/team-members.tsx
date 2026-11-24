"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Trash2 } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { addMemberAction, updateMemberRoleAction, removeMemberAction } from "./actions";

export interface MemberRowView {
  id: string;
  user_id: string;
  user_email: string;
  role: string;
  status: string;
}

/** Finance roles surfaced in the UI (labels map to the existing capability system). */
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "FINANCE_ADMIN", label: "Finance Admin — full control, manage org & members" },
  { value: "FINANCE_MANAGER", label: "Finance Manager — approve, forward & email" },
  { value: "FINANCE_USER", label: "Finance Editor — create/edit invoices, record payments" },
  { value: "APPROVER", label: "Approver — approve invoices only" },
  { value: "FINANCE_VIEWER", label: "Finance Viewer — read-only" },
];

/**
 * Admin-managed team membership for the single shared organization. The Finance
 * Admin adds employees by their existing Web Insight login email and assigns a
 * finance role. Every member shares the same organization GST/company profile.
 */
export function TeamMembers({ members, currentUserId }: { members: MemberRowView[]; currentUserId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [addState, addAction] = useActionState(addMemberAction, idleState);

  useEffect(() => {
    if (addState.status === "success") {
      toast(addState.message ?? "Member added.", "success");
      router.refresh();
    } else if (addState.status === "error" && addState.message) {
      toast(addState.message, "error");
    }
  }, [addState, toast, router]);

  function changeRole(memberId: string, role: string) {
    startTransition(async () => {
      const res = await updateMemberRoleAction({ memberId, role });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  function remove(memberId: string) {
    startTransition(async () => {
      const res = await removeMemberAction({ memberId });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
            <span className="flex-1 min-w-[12rem] truncate text-sm font-medium">
              {m.user_email}
              {m.user_id === currentUserId && <span className="ml-2 text-xs text-muted">(you)</span>}
            </span>
            <select
              value={m.role}
              onChange={(e) => changeRole(m.id, e.target.value)}
              disabled={pending}
              className="h-8 rounded-md border border-border bg-surface px-2 text-xs focus-ring"
              aria-label={`Role for ${m.user_email}`}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.value.replace("FINANCE_", "").replace("_", " ")}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => remove(m.id)}
              aria-label={`Remove ${m.user_email}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>

      <form action={addAction} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Employee email (Web Insight login)" htmlFor="member-email" required>
          <Input id="member-email" name="email" type="email" placeholder="employee@atlasuniversity.edu.in" required />
        </Field>
        <Field label="Role" htmlFor="member-role">
          <Select id="member-role" name="role" defaultValue="FINANCE_VIEWER">
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <SubmitButton pendingLabel="Adding…"><UserPlus className="h-4 w-4" /> Add member</SubmitButton>
      </form>
      <p className="text-xs text-muted">
        The employee must already have a Web Insight account. They&apos;ll share this organization&apos;s GST &amp;
        company profile the next time they sign in.
      </p>
    </div>
  );
}
