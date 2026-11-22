"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Select } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { saveForwardingSettingsAction } from "../forwarding-actions";

export function ForwardingSettingsForm({
  destination,
  minConfidence,
  enabled,
}: {
  destination: string;
  minConfidence: number;
  enabled: boolean;
}) {
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
    <form action={action} className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
      <Field
        label="Finance & Accounts destination"
        htmlFor="financeDestination"
        className="sm:col-span-2"
        hint="Invoice emails are forwarded here."
        error={state.fieldErrors?.financeDestination}
      >
        <Input id="financeDestination" name="financeDestination" type="email" defaultValue={destination} placeholder="finance.accounts@university-domain.com" />
      </Field>
      <Field label="Minimum confidence (%)" htmlFor="minConfidence" hint="Below this, emails wait for review." error={state.fieldErrors?.minConfidence}>
        <Input id="minConfidence" name="minConfidence" type="number" min={0} max={100} defaultValue={minConfidence} />
      </Field>
      <Field label="Forwarding" htmlFor="enabled">
        <Select id="enabled" name="enabled" defaultValue={enabled ? "true" : "false"}>
          <option value="true">Enabled</option>
          <option value="false">Paused</option>
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>Save forwarding settings</SubmitButton>
      </div>
    </form>
  );
}
