import { z } from "zod";

export interface FormState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
  /** id of a created/updated record, for client-side redirects */
  id?: string;
}

export const idleState: FormState = { status: "idle" };

/** Convert a FormData into a plain object (last value wins for repeats). */
export function formToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    obj[key] = value;
  }
  return obj;
}

/**
 * Parse FormData with a Zod schema, returning either typed data or a
 * FormState carrying per-field errors. Version-proof against Zod 4 by reading
 * `error.issues` directly rather than the deprecated `.flatten()`.
 */
export function parseForm<T extends z.ZodTypeAny>(
  schema: T,
  formData: FormData,
):
  | { success: true; data: z.infer<T> }
  | { success: false; state: FormState } {
  const result = schema.safeParse(formToObject(formData));
  if (result.success) {
    return { success: true, data: result.data };
  }
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return {
    success: false,
    state: {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors,
    },
  };
}

export function errorState(message: string): FormState {
  return { status: "error", message };
}

export function successState(message: string, id?: string): FormState {
  return { status: "success", message, id };
}
