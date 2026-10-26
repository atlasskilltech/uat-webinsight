"use server";

import { signIn, signOut } from "@/auth";

/** Start the Google OAuth flow, returning to `next` (local paths only) after. */
export async function googleSignInAction(formData: FormData): Promise<void> {
  const next = String(formData.get("next") ?? "/");
  const redirectTo = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  await signIn("google", { redirectTo });
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
