/**
 * Form state shared by the Agent API admin server actions and client UI.
 *
 * This is deliberately a PLAIN module (no "use server"): a "use server" file may
 * only export async functions, so the non-function `idleKeyState` constant and
 * the `KeyFormState` type must live outside `actions.ts`. Exporting a value from
 * a "use server" file throws at runtime: `A "use server" file can only export
 * async functions, found object` (Next error E352).
 */

export interface KeyFormState {
  status: "idle" | "success" | "error";
  message?: string;
  /** The plaintext key, returned exactly once right after creation. */
  newKey?: string;
  newKeyName?: string;
}

export const idleKeyState: KeyFormState = { status: "idle" };
