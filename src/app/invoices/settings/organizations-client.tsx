"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, Pencil, Building2, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import {
  createInvoiceOrganization,
  updateOrganizationAction,
  switchOrganizationAction,
  setOrgActiveAction,
} from "./actions";

const CURRENCIES = [
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — Pound Sterling" },
  { value: "AED", label: "AED — UAE Dirham" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
] as const;

export interface OrgListItem {
  id: string;
  name: string;
  legal_name: string | null;
  gstin: string | null;
  role: string;
  status: string; // 'active' when the org itself is active
}

export interface ActiveOrgProfile {
  id: string;
  name: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  base_currency: string;
  address: string;
}

const ROLE_LABEL: Record<string, string> = {
  FINANCE_ADMIN: "Finance Admin",
  FINANCE_MANAGER: "Finance Manager",
  FINANCE_USER: "Finance Editor",
  APPROVER: "Approver",
  FINANCE_VIEWER: "Finance Viewer",
};

/**
 * Finance Admin organization management: list the organizations you belong to,
 * switch the active one, activate/deactivate, add a new organization, and edit
 * the active organization's GST/company profile. All writes are enforced
 * server-side (org.manage on the specific org); this UI only gates visibility.
 */
export function OrganizationsManager({
  organizations,
  activeOrgId,
  activeProfile,
}: {
  organizations: OrgListItem[];
  activeOrgId: string;
  activeProfile: ActiveOrgProfile;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  function switchOrg(id: string) {
    start(async () => {
      const res = await switchOrganizationAction({ organizationId: id });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }
  function setActive(id: string, active: boolean) {
    start(async () => {
      const res = await setOrgActiveAction({ organizationId: id, active });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {organizations.map((o) => {
          const isActiveOrg = o.status === "active";
          const isCurrent = o.id === activeOrgId;
          return (
            <li key={o.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
                <Building2 className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {o.name}
                  {isCurrent && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-soft-foreground">Active</span>}
                  {!isActiveOrg && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">inactive</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {o.gstin ? `GSTIN ${o.gstin} · ` : ""}You are {ROLE_LABEL[o.role] ?? o.role}
                </p>
              </div>
              {isActiveOrg && !isCurrent && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => switchOrg(o.id)}>Switch</Button>
              )}
              {o.role === "FINANCE_ADMIN" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setActive(o.id, !isActiveOrg)}
                  title={isActiveOrg ? "Deactivate" : "Activate"}
                >
                  <Power className="h-3.5 w-3.5" /> {isActiveOrg ? "Deactivate" : "Activate"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => { setShowAdd((v) => !v); setShowEdit(false); }}>
          <Plus className="h-3.5 w-3.5" /> Add organization
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setShowEdit((v) => !v); setShowAdd(false); }}>
          <Pencil className="h-3.5 w-3.5" /> Edit active organization
        </Button>
      </div>

      {showAdd && <OrgForm mode="create" onDone={() => { setShowAdd(false); router.refresh(); }} />}
      {showEdit && <OrgForm mode="edit" profile={activeProfile} onDone={() => { setShowEdit(false); router.refresh(); }} />}
    </div>
  );
}

/** Shared create/edit organization form (name, legal, GSTIN, PAN, address, currency). */
export function OrgForm({
  mode,
  profile,
  onDone,
}: {
  mode: "create" | "edit";
  profile?: ActiveOrgProfile;
  onDone?: () => void;
}) {
  const action = mode === "create" ? createInvoiceOrganization : updateOrganizationAction;
  const [state, formAction] = useActionState(action, idleState);
  const toast = useToast();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Saved.", "success");
      onDone?.();
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface-2 p-4 sm:grid-cols-2">
      {mode === "edit" && profile && <input type="hidden" name="organizationId" value={profile.id} />}
      <Field label="Organization name" htmlFor="name" required className="sm:col-span-2" error={state.fieldErrors?.name}>
        <Input id="name" name="name" defaultValue={profile?.name ?? ""} placeholder="Atlas University Finance" required />
      </Field>
      <Field label="Legal name" htmlFor="legalName" error={state.fieldErrors?.legalName}>
        <Input id="legalName" name="legalName" defaultValue={profile?.legal_name ?? ""} placeholder="Optional" />
      </Field>
      <Field label="Base currency" htmlFor="baseCurrency" error={state.fieldErrors?.baseCurrency}>
        <Select id="baseCurrency" name="baseCurrency" defaultValue={profile?.base_currency || "INR"}>
          <Options options={CURRENCIES} />
        </Select>
      </Field>
      <Field label="GSTIN" htmlFor="gstin" hint="15 characters, optional" error={state.fieldErrors?.gstin}>
        <Input id="gstin" name="gstin" defaultValue={profile?.gstin ?? ""} placeholder="27AAAAA0000A1Z5" maxLength={15} />
      </Field>
      <Field label="PAN" htmlFor="pan" hint="10 characters, optional" error={state.fieldErrors?.pan}>
        <Input id="pan" name="pan" defaultValue={profile?.pan ?? ""} placeholder="AAAAA0000A" maxLength={10} />
      </Field>
      <Field label="Address" htmlFor="address" hint="Optional" className="sm:col-span-2" error={state.fieldErrors?.address}>
        <Input id="address" name="address" defaultValue={profile?.address ?? ""} placeholder="Registered / billing address" />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel={mode === "create" ? "Creating…" : "Saving…"}>
          {mode === "create" ? "Create organization" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
