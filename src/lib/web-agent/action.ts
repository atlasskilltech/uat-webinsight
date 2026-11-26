"use server";

// A "use server" file may export ONLY async functions.
import { requireUser, isAuthError } from "@/lib/auth/guard";
import { runWebAgent, type WebAgentResult, type WebAgentHistoryMsg } from "./orchestrator";
import type { AgentUser } from "@/lib/agent-api/common";

/**
 * One turn of the Web Insight Agent. Any active user may use it; the tools they
 * get (and the pages they can be navigated to) are scoped to their access.
 * Stateless: the widget passes the recent conversation back as `history`.
 */
export async function sendWebAgentMessage(input: {
  history: WebAgentHistoryMsg[];
  message: string;
}): Promise<WebAgentResult> {
  try {
    const u = await requireUser();
    const user: AgentUser = {
      email: u.email,
      name: u.name,
      role: u.role === "admin" ? "admin" : "user",
      accessScope: u.accessScope === "invoice_only" ? "invoice_only" : "full",
    };
    const text = (input.message ?? "").trim();
    if (!text) return { ok: false, error: "Empty message.", assistantText: "" };
    const history = Array.isArray(input.history) ? input.history.slice(-10) : [];
    return await runWebAgent({ user, history, message: text.slice(0, 4000) });
  } catch (e) {
    const msg = isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed.";
    return { ok: false, error: msg, assistantText: "" };
  }
}
