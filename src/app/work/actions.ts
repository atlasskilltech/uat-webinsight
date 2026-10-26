"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
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
    const task = await prisma.task.create({
      data: {
        ...data,
        completedDate:
          data.status === "completed" ? data.completedDate ?? new Date() : data.completedDate,
        progress: data.status === "completed" ? 100 : data.progress,
      },
    });
    await prisma.taskActivity.create({
      data: { taskId: task.id, type: "created", message: "Task created" },
    });
    revalidateWork();
    return successState("Task created.", task.id);
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
    const before = await prisma.task.findUnique({ where: { id } });
    if (!before) return errorState("Task not found.");

    const completedDate =
      data.status === "completed"
        ? before.completedDate ?? data.completedDate ?? new Date()
        : null;

    await prisma.task.update({
      where: { id },
      data: {
        ...data,
        completedDate,
        progress: data.status === "completed" ? 100 : data.progress,
      },
    });

    if (before.status !== data.status) {
      await prisma.taskActivity.create({
        data: {
          taskId: id,
          type: data.status === "completed" ? "completed" : "status_change",
          message: `Status changed to ${labelOf(TASK_STATUSES, data.status)}`,
          fromValue: before.status,
          toValue: data.status,
        },
      });
    } else {
      await prisma.taskActivity.create({
        data: { taskId: id, type: "edited", message: "Task details updated" },
      });
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
  const before = await prisma.task.findUnique({ where: { id } });
  if (!before) return;
  await prisma.task.update({
    where: { id },
    data: {
      status,
      completedDate: status === "completed" ? before.completedDate ?? new Date() : null,
      progress: status === "completed" ? 100 : before.progress,
    },
  });
  await prisma.taskActivity.create({
    data: {
      taskId: id,
      type: status === "completed" ? "completed" : "status_change",
      message: `Status changed to ${labelOf(TASK_STATUSES, status)}`,
      fromValue: before.status,
      toValue: status,
    },
  });
  revalidateWork();
  revalidatePath(`/work/${id}`);
}

export async function deleteTask(id: string): Promise<void> {
  await prisma.task.delete({ where: { id } });
  revalidateWork();
}

export async function addWorkLog(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(workLogSchema, formData);
  if (!parsed.success) return parsed.state;
  try {
    await prisma.workLog.create({ data: parsed.data });
    revalidateWork();
    return successState("Work log added.");
  } catch {
    return errorState("Could not add the work log.");
  }
}

export async function deleteWorkLog(id: string): Promise<void> {
  await prisma.workLog.delete({ where: { id } });
  revalidateWork();
}
