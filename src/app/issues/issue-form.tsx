"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createIssue, updateIssue } from "./actions";
import { idleState } from "@/lib/form-state";
import { Field, Input, Textarea, Select, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  ISSUE_CATEGORIES,
  SEVERITIES,
  PRIORITIES,
  ISSUE_STATUSES,
  APPROVAL_STATUSES,
} from "@/lib/enums";

export interface IssueFormValues {
  id?: string;
  title?: string;
  /** URLs joined by newline for the textarea. */
  urls?: string;
  category?: string;
  severity?: string;
  priority?: string;
  status?: string;
  approvalStatus?: string;
  owner?: string | null;
  evidence?: string | null;
  source?: string | null;
  impact?: string | null;
  recommendedFix?: string | null;
  implementationNotes?: string | null;
  verificationResult?: string | null;
  dateDiscovered?: Date | string | null;
  dateResolved?: Date | string | null;
}

function dateInput(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function IssueForm({
  issue,
  onDone,
}: {
  issue?: IssueFormValues;
  onDone?: () => void;
}) {
  const editing = Boolean(issue?.id);
  const action = editing ? updateIssue : createIssue;
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
      {editing && <input type="hidden" name="id" value={issue!.id} />}

      <Field label="Issue title" required error={err("title")}>
        <Input
          name="title"
          defaultValue={issue?.title ?? ""}
          placeholder="e.g. Homepage LCP above 4s on mobile"
          required
        />
      </Field>

      <Field
        label="Affected URL(s)"
        hint="One URL per line."
        error={err("urls")}
      >
        <Textarea
          name="urls"
          defaultValue={issue?.urls ?? ""}
          placeholder={"https://atlasuniversity.edu.in/\nhttps://atlasuniversity.edu.in/admissions"}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Category" error={err("category")}>
          <Select name="category" defaultValue={issue?.category ?? "other"}>
            <Options options={ISSUE_CATEGORIES} />
          </Select>
        </Field>
        <Field label="Severity" error={err("severity")}>
          <Select name="severity" defaultValue={issue?.severity ?? "medium"}>
            <Options options={SEVERITIES} />
          </Select>
        </Field>
        <Field label="Priority" error={err("priority")}>
          <Select name="priority" defaultValue={issue?.priority ?? "medium"}>
            <Options options={PRIORITIES} />
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Status" error={err("status")}>
          <Select name="status" defaultValue={issue?.status ?? "open"}>
            <Options options={ISSUE_STATUSES} />
          </Select>
        </Field>
        <Field
          label="Approval"
          hint="Fixes are reviewed & approved separately."
          error={err("approvalStatus")}
        >
          <Select name="approvalStatus" defaultValue={issue?.approvalStatus ?? "pending"}>
            <Options options={APPROVAL_STATUSES} />
          </Select>
        </Field>
        <Field label="Owner" error={err("owner")}>
          <Input name="owner" defaultValue={issue?.owner ?? ""} placeholder="Assigned person" />
        </Field>
      </div>

      <Field label="Evidence" hint="What proves this issue exists?" error={err("evidence")}>
        <Textarea
          name="evidence"
          defaultValue={issue?.evidence ?? ""}
          className="min-h-16"
          placeholder="e.g. PageSpeed Insights mobile LCP 4.3s; hero image 820KB."
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Source" error={err("source")}>
          <Input name="source" defaultValue={issue?.source ?? ""} placeholder="e.g. Search Console, site crawl, PageSpeed" />
        </Field>
        <Field label="Potential impact" error={err("impact")}>
          <Input name="impact" defaultValue={issue?.impact ?? ""} placeholder="Why it matters" />
        </Field>
      </div>

      <Field label="Recommended fix" hint="A recommendation to review — the app never changes the live site." error={err("recommendedFix")}>
        <Textarea
          name="recommendedFix"
          defaultValue={issue?.recommendedFix ?? ""}
          className="min-h-16"
          placeholder="What should be done, for review and approval."
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Implementation notes" error={err("implementationNotes")}>
          <Textarea name="implementationNotes" defaultValue={issue?.implementationNotes ?? ""} className="min-h-16" />
        </Field>
        <Field label="Verification result" error={err("verificationResult")}>
          <Textarea name="verificationResult" defaultValue={issue?.verificationResult ?? ""} className="min-h-16" placeholder="How the fix was verified." />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date discovered" error={err("dateDiscovered")}>
          <Input type="date" name="dateDiscovered" defaultValue={dateInput(issue?.dateDiscovered)} />
        </Field>
        <Field label="Date resolved" hint="Auto-set when marked fixed/verified." error={err("dateResolved")}>
          <Input type="date" name="dateResolved" defaultValue={dateInput(issue?.dateResolved)} />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <SubmitButton>{editing ? "Save changes" : "Record issue"}</SubmitButton>
      </div>
    </form>
  );
}
