"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createServerAsset, updateServerAsset } from "./actions";
import { idleState } from "@/lib/form-state";
import { Field, Input, Textarea, Select, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { SERVER_ASSET_TYPES, ASSET_STATUSES } from "@/lib/enums";

export interface AssetFormValues {
  id?: string;
  type?: string;
  name?: string;
  provider?: string | null;
  plan?: string | null;
  environment?: string | null;
  version?: string | null;
  status?: string;
  sslExpiry?: Date | string | null;
  notes?: string | null;
}

function dateInput(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function AssetForm({
  asset,
  onDone,
}: {
  asset?: AssetFormValues;
  onDone?: () => void;
}) {
  const editing = Boolean(asset?.id);
  const action = editing ? updateServerAsset : createServerAsset;
  const [state, formAction] = useActionState(action, idleState);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Saved.");
      onDone?.();
      router.refresh();
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
  }, [state, toast, onDone, router]);

  const err = (f: string) => state.fieldErrors?.[f];

  return (
    <form action={formAction} className="space-y-4">
      {editing && <input type="hidden" name="id" value={asset!.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Asset type" error={err("type")}>
          <Select name="type" defaultValue={asset?.type ?? "application"}>
            <Options options={SERVER_ASSET_TYPES} />
          </Select>
        </Field>
        <Field label="Status" error={err("status")}>
          <Select name="status" defaultValue={asset?.status ?? "active"}>
            <Options options={ASSET_STATUSES} />
          </Select>
        </Field>
      </div>

      <Field label="Name" required error={err("name")}>
        <Input name="name" defaultValue={asset?.name ?? ""} placeholder="e.g. cPanel shared hosting" required />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Provider" error={err("provider")}>
          <Input name="provider" defaultValue={asset?.provider ?? ""} placeholder="e.g. Hostinger" />
        </Field>
        <Field label="Plan" error={err("plan")}>
          <Input name="plan" defaultValue={asset?.plan ?? ""} placeholder="e.g. Business" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Environment" error={err("environment")}>
          <Select name="environment" defaultValue={asset?.environment ?? ""}>
            <Options
              options={[
                { value: "production", label: "Production" },
                { value: "staging", label: "Staging" },
                { value: "dev", label: "Development" },
              ]}
              placeholder="Not set"
            />
          </Select>
        </Field>
        <Field label="Version" error={err("version")}>
          <Input name="version" defaultValue={asset?.version ?? ""} placeholder="e.g. 8.2" />
        </Field>
      </div>

      <Field label="SSL / certificate expiry" hint="For SSL assets — used to warn before expiry." error={err("sslExpiry")}>
        <Input type="date" name="sslExpiry" defaultValue={dateInput(asset?.sslExpiry)} />
      </Field>

      <Field label="Notes" error={err("notes")}>
        <Textarea name="notes" defaultValue={asset?.notes ?? ""} placeholder="Configuration details, resource limits, access notes." />
      </Field>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <SubmitButton>{editing ? "Save changes" : "Add asset"}</SubmitButton>
      </div>
    </form>
  );
}
