"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createOpsLog, updateOpsLog } from "./actions";
import { idleState } from "@/lib/form-state";
import { Field, Input, Textarea, Select, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  OPS_KINDS,
  OPS_STATUSES,
  VERIFICATION_STATUSES,
} from "@/lib/enums";

export interface OpsLogFormValues {
  id?: string;
  occurredAt?: Date | string | null;
  system?: string;
  title?: string;
  kind?: string;
  status?: string;
  verificationStatus?: string;
  httpStatus?: number | null;
  symptoms?: string | null;
  investigation?: string | null;
  resolution?: string | null;
  approvedBy?: string | null;
  responsiblePerson?: string | null;
}

function dateTimeInput(d?: Date | string | null): string {
  const date = d ? (typeof d === "string" ? new Date(d) : d) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  // yyyy-MM-ddThh:mm in local time
  const tzOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
}

export function OpsLogForm({
  log,
  onDone,
}: {
  log?: OpsLogFormValues;
  onDone?: () => void;
}) {
  const editing = Boolean(log?.id);
  const action = editing ? updateOpsLog : createOpsLog;
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
      {editing && <input type="hidden" name="id" value={log!.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="When it occurred" required error={err("occurredAt")}>
          <Input type="datetime-local" name="occurredAt" defaultValue={dateTimeInput(log?.occurredAt)} required />
        </Field>
        <Field label="System affected" required error={err("system")}>
          <Input name="system" defaultValue={log?.system ?? ""} placeholder="e.g. cPanel / Apache" required />
        </Field>
      </div>

      <Field label="Task or incident title" required error={err("title")}>
        <Input name="title" defaultValue={log?.title ?? ""} placeholder="e.g. Investigated intermittent 503 errors" required />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Type" error={err("kind")}>
          <Select name="kind" defaultValue={log?.kind ?? "task"}>
            <Options options={OPS_KINDS} />
          </Select>
        </Field>
        <Field label="Status" error={err("status")}>
          <Select name="status" defaultValue={log?.status ?? "open"}>
            <Options options={OPS_STATUSES} />
          </Select>
        </Field>
        <Field label="Verification" error={err("verificationStatus")}>
          <Select name="verificationStatus" defaultValue={log?.verificationStatus ?? "pending"}>
            <Options options={VERIFICATION_STATUSES} />
          </Select>
        </Field>
      </div>

      <Field label="HTTP status code (if relevant)" error={err("httpStatus")}>
        <Input type="number" name="httpStatus" defaultValue={log?.httpStatus ?? ""} placeholder="e.g. 503" />
      </Field>

      <Field label="Symptoms & evidence" error={err("symptoms")}>
        <Textarea name="symptoms" defaultValue={log?.symptoms ?? ""} className="min-h-16" placeholder="What was observed." />
      </Field>
      <Field label="Investigation performed" error={err("investigation")}>
        <Textarea name="investigation" defaultValue={log?.investigation ?? ""} className="min-h-16" placeholder="What you checked." />
      </Field>
      <Field label="Resolution or next action" error={err("resolution")}>
        <Textarea name="resolution" defaultValue={log?.resolution ?? ""} className="min-h-16" placeholder="How it was resolved, or the next step." />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Responsible person" error={err("responsiblePerson")}>
          <Input name="responsiblePerson" defaultValue={log?.responsiblePerson ?? ""} placeholder="e.g. Web team" />
        </Field>
        <Field label="Approved by" error={err("approvedBy")}>
          <Input name="approvedBy" defaultValue={log?.approvedBy ?? ""} placeholder="For changes requiring approval" />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <SubmitButton>{editing ? "Save changes" : "Record entry"}</SubmitButton>
      </div>
    </form>
  );
}
