"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addWorkLog } from "./actions";
import { idleState } from "@/lib/form-state";
import { Field, Input, Textarea, Select, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { TASK_CATEGORIES } from "@/lib/enums";

export function WorkLogForm({
  tasks,
  onDone,
}: {
  tasks: { id: string; title: string }[];
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState(addWorkLog, idleState);
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date" required error={err("date")}>
          <Input type="date" name="date" defaultValue={today} required />
        </Field>
        <Field label="Category" error={err("category")}>
          <Select name="category" defaultValue="seo">
            <Options options={TASK_CATEGORIES} />
          </Select>
        </Field>
      </div>
      <Field label="What did you do?" required error={err("summary")}>
        <Textarea name="summary" placeholder="e.g. Reviewed GSC coverage report and flagged 3 excluded pages." required />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Time spent (minutes)" error={err("minutes")}>
          <Input type="number" name="minutes" min={0} placeholder="e.g. 90" />
        </Field>
        <Field label="Related task (optional)" error={err("taskId")}>
          <Select name="taskId" defaultValue="">
            <Options options={tasks.map((t) => ({ value: t.id, label: t.title }))} placeholder="None" />
          </Select>
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {onDone && <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}
        <SubmitButton>Add log</SubmitButton>
      </div>
    </form>
  );
}
