"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateOrganizationAction } from "./actions";
import { idleState } from "@/lib/form-state";
import { Field, Input, Select, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";

const CURRENCIES = [
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — Pound Sterling" },
] as const;

export interface OrgProfile {
  name: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  base_currency: string;
}

/**
 * Edit the single shared organization (GST/company) profile. Finance Admin only
 * (the server action enforces org.manage). Every member sees these details.
 */
export function OrgProfileForm({ org }: { org: OrgProfile }) {
  const [state, action] = useActionState(updateOrganizationAction, idleState);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Saved.", "success");
      router.refresh();
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
  }, [state, toast, router]);

  return (
    <form action={action} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Organization name" htmlFor="name" required className="sm:col-span-2" error={state.fieldErrors?.name}>
        <Input id="name" name="name" defaultValue={org.name} required />
      </Field>
      <Field label="Legal name" htmlFor="legalName" error={state.fieldErrors?.legalName}>
        <Input id="legalName" name="legalName" defaultValue={org.legal_name ?? ""} placeholder="Optional" />
      </Field>
      <Field label="GSTIN" htmlFor="gstin" hint="15 characters, optional" error={state.fieldErrors?.gstin}>
        <Input id="gstin" name="gstin" defaultValue={org.gstin ?? ""} placeholder="27AAAAA0000A1Z5" maxLength={15} />
      </Field>
      <Field label="PAN" htmlFor="pan" hint="10 characters, optional" error={state.fieldErrors?.pan}>
        <Input id="pan" name="pan" defaultValue={org.pan ?? ""} placeholder="AAAAA0000A" maxLength={10} />
      </Field>
      <Field label="Base currency" htmlFor="baseCurrency" error={state.fieldErrors?.baseCurrency}>
        <Select id="baseCurrency" name="baseCurrency" defaultValue={org.base_currency || "INR"}>
          <Options options={CURRENCIES} />
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </form>
  );
}
