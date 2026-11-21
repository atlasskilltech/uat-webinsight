"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createInvoiceOrganization } from "./actions";
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

export function SetupOrganizationForm() {
  const [state, action] = useActionState(createInvoiceOrganization, idleState);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Organization created.", "success");
      router.refresh();
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
  }, [state, toast, router]);

  return (
    <form action={action} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Organization name" htmlFor="name" required className="sm:col-span-2"
        error={state.fieldErrors?.name}>
        <Input id="name" name="name" placeholder="Atlas University Finance" required />
      </Field>
      <Field label="Legal name" htmlFor="legalName" error={state.fieldErrors?.legalName}>
        <Input id="legalName" name="legalName" placeholder="Optional" />
      </Field>
      <Field label="GSTIN" htmlFor="gstin" hint="15 characters, optional" error={state.fieldErrors?.gstin}>
        <Input id="gstin" name="gstin" placeholder="27AAAAA0000A1Z5" maxLength={15} />
      </Field>
      <Field label="Base currency" htmlFor="baseCurrency" error={state.fieldErrors?.baseCurrency}>
        <Select id="baseCurrency" name="baseCurrency" defaultValue="INR">
          <Options options={CURRENCIES} />
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Creating…">Create organization</SubmitButton>
      </div>
    </form>
  );
}
