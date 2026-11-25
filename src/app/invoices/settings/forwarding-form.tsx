"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Field, Input } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { saveForwardingSettingsAction } from "../forwarding-actions";

/**
 * Per-organization destination email. Simple by design: the single address this
 * organization's documents are forwarded to. CC recipients are managed in their
 * own card. These settings are independent for every organization.
 */
export function ForwardingSettingsForm({ destination }: { destination: string }) {
  const [state, action] = useActionState(saveForwardingSettingsAction, idleState);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Saved.", "success");
      router.refresh();
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="grid max-w-xl grid-cols-1 gap-4">
      <Field
        label="Destination email"
        htmlFor="financeDestination"
        hint="Documents detected for this organization are forwarded to this address."
        error={state.fieldErrors?.financeDestination}
      >
        <Input id="financeDestination" name="financeDestination" type="email" defaultValue={destination} placeholder="accounts@your-company.com" />
      </Field>
      <div>
        <SubmitButton>Save destination</SubmitButton>
      </div>
    </form>
  );
}
