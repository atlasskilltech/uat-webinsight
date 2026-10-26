import type { FormState } from "@/lib/form-state";

/** Form-action result for the admin user forms. */
export type AdminActionState = FormState;

/** Result of a direct (non-form) admin action. */
export interface ActionResult {
  ok: boolean;
  message: string;
}
