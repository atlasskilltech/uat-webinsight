"use server";

import { revalidatePath } from "next/cache";
import { queryOne, execute } from "@/lib/db";
import { createId } from "@/lib/id";
import type { Task } from "@/lib/models";
import { taskSchema, workLogSchema } from "@/lib/validation";
import {
  parseForm,
  successState,
  errorState,
  type FormState,
} from "@/lib/form-state";
import { labelOf, TASK_STATUSES } from "@/lib/enums";

function revalidateWork() {
  revalidatePath("/work");
  revalidatePath("/");
}

export async function createTask(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(taskSchema, formData);
  if (!parsed.success) return parsed.state;
  const data = parsed.data;

  try {
    const id = createId();
    const completedDate =
      data.status === "completed" ? data.completedDate ?? new Date() : data.completedDate;
    const progress = data.status === "completed" ? 100 : data.progress;
    await execute(
      "INSERT INTO `Task` " +
        "(`id`,`title`,`description`,`category`,`status`,`priority`,`projectId`,`issueId`," +
        "`startDate`,`dueDate`,`completedDate`,`estimatedMinutes`,`actualMinutes`,`progress`," +
        "`relatedUrl`,`notes`,`completionSummary`,`blocker`,`nextAction`) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        data.title,
        data.description ?? null,
        data.category,
        data.status,
        data.priority,
        data.projectId ?? null,
        data.issueId ?? null,
        data.startDate ?? null,
        data.dueDate ?? null,
        completedDate ?? null,
        data.estimatedMinutes ?? null,
        data.actualMinutes ?? null,
        progress,
        data.relatedUrl ?? null,
        data.notes ?? null,
        data.completionSummary ?? null,
        data.blocker ?? null,
        data.nextAction ?? null,
      ],
    );
    await execute(
      "INSERT INTO `TaskActivity` (`id`,`taskId`,`type`,`message`) VALUES (?,?,?,?)",
      [createId(), id, "created", "Task created"],
    );
    revalidateWork();
    return successState("Task created.", id);
  } catch {
    return errorState("Could not create the task. Please try again.");
  }
}

export async function updateTask(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return errorState("Missing task id.");
  const parsed = parseForm(taskSchema, formData);
  if (!parsed.success) return parsed.state;
  const data = parsed.data;

  try {
    const before = await queryOne<Task>("SELECT * FROM `Task` WHERE `id` = ?", [id]);
    if (!before) return errorState("Task not found.");

    const completedDate =
      data.status === "completed"
        ? before.completedDate ?? data.completedDate ?? new Date()
        : null;

    await execute(
      "UPDATE `Task` SET " +
        "`title`=?,`description`=?,`category`=?,`status`=?,`priority`=?,`projectId`=?,`issueId`=?," +
        "`startDate`=?,`dueDate`=?,`completedDate`=?,`estimatedMinutes`=?,`actualMinutes`=?,`progress`=?," +
        "`relatedUrl`=?,`notes`=?,`completionSummary`=?,`blocker`=?,`nextAction`=? " +
        "WHERE `id`=?",
      [
        data.title,
        data.description ?? null,
        data.category,
        data.status,
        data.priority,
        data.projectId ?? null,
        data.issueId ?? null,
        data.startDate ?? null,
        data.dueDate ?? null,
        completedDate,
        data.estimatedMinutes ?? null,
        data.actualMinutes ?? null,
        data.status === "completed" ? 100 : data.progress,
        data.relatedUrl ?? null,
        data.notes ?? null,
        data.completionSummary ?? null,
        data.blocker ?? null,
        data.nextAction ?? null,
        id,
      ],
    );

    if (before.status !== data.status) {
      await execute(
        "INSERT INTO `TaskActivity` (`id`,`taskId`,`type`,`message`,`fromValue`,`toValue`) VALUES (?,?,?,?,?,?)",
        [
          createId(),
          id,
          data.status === "completed" ? "completed" : "status_change",
          `Status changed to ${labelOf(TASK_STATUSES, data.status)}`,
          before.status,
          data.status,
        ],
      );
    } else {
      await execute(
        "INSERT INTO `TaskActivity` (`id`,`taskId`,`type`,`message`) VALUES (?,?,?,?)",
        [createId(), id, "edited", "Task details updated"],
      );
    }
    revalidateWork();
    revalidatePath(`/work/${id}`);
    return successState("Task updated.", id);
  } catch {
    return errorState("Could not update the task.");
  }
}

/** Quick status change (board columns / detail). Not a full form. */
export async function setTaskStatus(id: string, status: string): Promise<void> {
  const before = await queryOne<Task>("SELECT * FROM `Task` WHERE `id` = ?", [id]);
  if (!before) return;
  await execute(
    "UPDATE `Task` SET `status`=?,`completedDate`=?,`progress`=? WHERE `id`=?",
    [
      status,
      status === "completed" ? before.completedDate ?? new Date() : null,
      status === "completed" ? 100 : before.progress,
      id,
    ],
  );
  await execute(
    "INSERT INTO `TaskActivity` (`id`,`taskId`,`type`,`message`,`fromValue`,`toValue`) VALUES (?,?,?,?,?,?)",
    [
      createId(),
      id,
      status === "completed" ? "completed" : "status_change",
      `Status changed to ${labelOf(TASK_STATUSES, status)}`,
      before.status,
      status,
    ],
  );
  revalidateWork();
  revalidatePath(`/work/${id}`);
}

export async function deleteTask(id: string): Promise<void> {
  await execute("DELETE FROM `Task` WHERE `id` = ?", [id]);
  revalidateWork();
}

export async function addWorkLog(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(workLogSchema, formData);
  if (!parsed.success) return parsed.state;
  const data = parsed.data;
  try {
    await execute(
      "INSERT INTO `WorkLog` (`id`,`date`,`summary`,`category`,`minutes`,`taskId`) VALUES (?,?,?,?,?,?)",
      [createId(), data.date, data.summary, data.category, data.minutes ?? null, data.taskId ?? null],
    );
    revalidateWork();
    return successState("Work log added.");
  } catch {
    return errorState("Could not add the work log.");
  }
}

export async function deleteWorkLog(id: string): Promise<void> {
  await execute("DELETE FROM `WorkLog` WHERE `id` = ?", [id]);
  revalidateWork();
}
