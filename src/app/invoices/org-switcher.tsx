"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { switchOrganizationAction } from "./settings/actions";

export interface SwitcherOrg {
  id: string;
  name: string;
}

/**
 * Current-organization indicator + switcher. Shown wherever the active org
 * matters. Switching is server-validated (membership) via switchOrganizationAction;
 * on success the page re-renders with the new org's data.
 */
export function OrgSwitcher({ organizations, activeOrgId }: { organizations: SwitcherOrg[]; activeOrgId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const active = organizations.find((o) => o.id === activeOrgId);

  function onChange(id: string) {
    if (!id || id === activeOrgId) return;
    start(async () => {
      const res = await switchOrganizationAction({ organizationId: id });
      toast(res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  // A single org: just show it as a static indicator (nothing to switch to).
  if (organizations.length <= 1) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-foreground">
        <Building2 className="h-3.5 w-3.5 text-accent" />
        {active?.name ?? "Organization"}
      </span>
    );
  }

  return (
    <label className="relative inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-foreground focus-within:ring-2 focus-within:ring-accent/40">
      <Building2 className="h-3.5 w-3.5 text-accent" />
      <span className="sr-only">Active organization</span>
      <select
        className="cursor-pointer appearance-none bg-transparent pr-5 text-xs font-medium focus:outline-none disabled:opacity-60"
        value={activeOrgId}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-muted" />
    </label>
  );
}
