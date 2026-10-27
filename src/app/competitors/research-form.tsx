"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createResearch, updateResearch } from "./actions";
import { idleState } from "@/lib/form-state";
import { Field, Input, Textarea, Select, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  RESEARCH_CATEGORIES,
  RESEARCH_EFFORT,
  RECOMMENDATIONS,
  RESEARCH_STATUSES,
} from "@/lib/enums";

export interface ResearchFormValues {
  id?: string;
  organisation?: string;
  website?: string | null;
  researchDate?: Date | string | null;
  sourceUrl?: string | null;
  observation?: string;
  category?: string;
  isAssumption?: boolean;
  evidence?: string | null;
  relevance?: string | null;
  effort?: string;
  expectedBenefit?: string | null;
  measurement?: string | null;
  recommendation?: string;
  status?: string;
  followUpDate?: Date | string | null;
}

function dateInput(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function ResearchForm({
  entry,
  onDone,
}: {
  entry?: ResearchFormValues;
  onDone?: () => void;
}) {
  const editing = Boolean(entry?.id);
  const action = editing ? updateResearch : createResearch;
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
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-4">
      {editing && <input type="hidden" name="id" value={entry!.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Organisation" required error={err("organisation")}>
          <Input name="organisation" defaultValue={entry?.organisation ?? ""} placeholder="e.g. Ashoka University" required />
        </Field>
        <Field label="Website" error={err("website")}>
          <Input name="website" defaultValue={entry?.website ?? ""} placeholder="https://…" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Research date" error={err("researchDate")}>
          <Input type="date" name="researchDate" defaultValue={dateInput(entry?.researchDate) || today} />
        </Field>
        <Field label="Source URL" hint="Where you observed this." error={err("sourceUrl")}>
          <Input name="sourceUrl" defaultValue={entry?.sourceUrl ?? ""} placeholder="https://…" />
        </Field>
      </div>

      <Field label="Observation" required hint="What you actually observed on a public page." error={err("observation")}>
        <Textarea name="observation" defaultValue={entry?.observation ?? ""} placeholder="e.g. Programme pages use a persistent 'Apply / Enquire' sidebar CTA." required />
      </Field>

      <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3">
        <input
          type="checkbox"
          name="isAssumption"
          defaultChecked={entry?.isAssumption ?? false}
          className="mt-0.5 h-4 w-4 rounded border-border-strong accent-[var(--accent)]"
        />
        <span className="text-sm text-foreground">
          This is my assumption, not a verified public fact
          <span className="mt-0.5 block text-xs text-muted">
            Tick this when the entry is your interpretation rather than something you directly observed. Never record invented competitor figures.
          </span>
        </span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Category" error={err("category")}>
          <Select name="category" defaultValue={entry?.category ?? "seo"}>
            <Options options={RESEARCH_CATEGORIES} />
          </Select>
        </Field>
        <Field label="Implementation effort" error={err("effort")}>
          <Select name="effort" defaultValue={entry?.effort ?? "medium"}>
            <Options options={RESEARCH_EFFORT} />
          </Select>
        </Field>
        <Field label="Recommendation" error={err("recommendation")}>
          <Select name="recommendation" defaultValue={entry?.recommendation ?? "investigate"}>
            <Options options={RECOMMENDATIONS} />
          </Select>
        </Field>
      </div>

      <Field label="Evidence" hint="Links or notes backing the observation." error={err("evidence")}>
        <Textarea name="evidence" defaultValue={entry?.evidence ?? ""} className="min-h-16" />
      </Field>

      <Field label="Potential relevance to ATLAS" error={err("relevance")}>
        <Textarea name="relevance" defaultValue={entry?.relevance ?? ""} className="min-h-16" placeholder="Why this might matter for ATLAS." />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Expected benefit" error={err("expectedBenefit")}>
          <Input name="expectedBenefit" defaultValue={entry?.expectedBenefit ?? ""} placeholder="e.g. Higher enquiry rate" />
        </Field>
        <Field label="Suggested measurement" error={err("measurement")}>
          <Input name="measurement" defaultValue={entry?.measurement ?? ""} placeholder="e.g. Enquiry submissions per session (GA4)" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Status" error={err("status")}>
          <Select name="status" defaultValue={entry?.status ?? "new"}>
            <Options options={RESEARCH_STATUSES} />
          </Select>
        </Field>
        <Field label="Follow-up date" error={err("followUpDate")}>
          <Input type="date" name="followUpDate" defaultValue={dateInput(entry?.followUpDate)} />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <SubmitButton>{editing ? "Save changes" : "Add research"}</SubmitButton>
      </div>
    </form>
  );
}
