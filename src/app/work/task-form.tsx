"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createTask, updateTask } from "./actions";
import { idleState } from "@/lib/form-state";
import {
  Field,
  Input,
  Textarea,
  Select,
  Options,
} from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  TASK_STATUSES,
  PRIORITIES,
  TASK_CATEGORIES,
} from "@/lib/enums";

export interface TaskFormValues {
  id?: string;
  title?: string;
  description?: string | null;
  category?: string;
  status?: string;
  priority?: string;
  projectId?: string | null;
  issueId?: string | null;
  startDate?: Date | string | null;
  dueDate?: Date | string | null;
  estimatedMinutes?: number | null;
  actualMinutes?: number | null;
  progress?: number;
  relatedUrl?: string | null;
  blocker?: string | null;
  nextAction?: string | null;
  notes?: string | null;
  completionSummary?: string | null;
}

function dateInput(d?: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function TaskForm({
  task,
  projects,
  onDone,
}: {
  task?: TaskFormValues;
  projects: { id: string; name: string }[];
  onDone?: () => void;
}) {
  const editing = Boolean(task?.id);
  const action = editing ? updateTask : createTask;
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
      {editing && <input type="hidden" name="id" value={task!.id} />}

      <Field label="Task title" required error={err("title")}>
        <Input name="title" defaultValue={task?.title ?? ""} placeholder="e.g. Fix missing meta descriptions on blog posts" required />
      </Field>

      <Field label="Description" error={err("description")}>
        <Textarea name="description" defaultValue={task?.description ?? ""} placeholder="What needs to be done and why." />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Category" error={err("category")}>
          <Select name="category" defaultValue={task?.category ?? "other"}>
            <Options options={TASK_CATEGORIES} />
          </Select>
        </Field>
        <Field label="Status" error={err("status")}>
          <Select name="status" defaultValue={task?.status ?? "not_started"}>
            <Options options={TASK_STATUSES} />
          </Select>
        </Field>
        <Field label="Priority" error={err("priority")}>
          <Select name="priority" defaultValue={task?.priority ?? "medium"}>
            <Options options={PRIORITIES} />
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Project" error={err("projectId")}>
          <Select name="projectId" defaultValue={task?.projectId ?? ""}>
            <Options options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="No project" />
          </Select>
        </Field>
        <Field label="Progress (%)" hint="0–100. Completed tasks are set to 100." error={err("progress")}>
          <Input type="number" name="progress" min={0} max={100} defaultValue={task?.progress ?? 0} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Start date" error={err("startDate")}>
          <Input type="date" name="startDate" defaultValue={dateInput(task?.startDate)} />
        </Field>
        <Field label="Due date" error={err("dueDate")}>
          <Input type="date" name="dueDate" defaultValue={dateInput(task?.dueDate)} />
        </Field>
        <Field label="Completion date" hint="Set when completed." error={err("completedDate")}>
          <Input type="date" name="completedDate" defaultValue={dateInput((task as { completedDate?: Date | string | null })?.completedDate)} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Estimated time (minutes)" error={err("estimatedMinutes")}>
          <Input type="number" name="estimatedMinutes" min={0} defaultValue={task?.estimatedMinutes ?? ""} />
        </Field>
        <Field label="Actual time spent (minutes)" error={err("actualMinutes")}>
          <Input type="number" name="actualMinutes" min={0} defaultValue={task?.actualMinutes ?? ""} />
        </Field>
      </div>

      <Field label="Related URL" hint="A page this task relates to." error={err("relatedUrl")}>
        <Input name="relatedUrl" defaultValue={task?.relatedUrl ?? ""} placeholder="https://atlasuniversity.edu.in/…" />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Current blocker" error={err("blocker")}>
          <Textarea name="blocker" defaultValue={task?.blocker ?? ""} className="min-h-16" placeholder="What's stopping progress?" />
        </Field>
        <Field label="Next action" error={err("nextAction")}>
          <Textarea name="nextAction" defaultValue={task?.nextAction ?? ""} className="min-h-16" placeholder="The next concrete step." />
        </Field>
      </div>

      <Field label="Notes & evidence" error={err("notes")}>
        <Textarea name="notes" defaultValue={task?.notes ?? ""} placeholder="Links, context, evidence." />
      </Field>

      <Field label="Completion summary" hint="What was achieved (for reporting)." error={err("completionSummary")}>
        <Textarea name="completionSummary" defaultValue={task?.completionSummary ?? ""} className="min-h-16" />
      </Field>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <SubmitButton>{editing ? "Save changes" : "Create task"}</SubmitButton>
      </div>
    </form>
  );
}
