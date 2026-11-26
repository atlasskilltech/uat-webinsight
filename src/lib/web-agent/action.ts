"use server";

// A "use server" file may export ONLY async functions.
import { requireUser, isAuthError } from "@/lib/auth/guard";
import { runWebAgent, executeConfirmedAction, type WebAgentResult, type WebAgentHistoryMsg } from "./orchestrator";
import type { AgentUser } from "@/lib/agent-api/common";

function agentUserFrom(u: { email: string; name: string; role: string; accessScope: string }): AgentUser {
  return {
    email: u.email,
    name: u.name,
    role: u.role === "admin" ? "admin" : "user",
    accessScope: u.accessScope === "invoice_only" ? "invoice_only" : "full",
  };
}

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
    const user = agentUserFrom(u);
    const text = (input.message ?? "").trim();
    if (!text) return { ok: false, error: "Empty message.", assistantText: "" };
    const history = Array.isArray(input.history) ? input.history.slice(-10) : [];
    return await runWebAgent({ user, history, message: text.slice(0, 4000) });
  } catch (e) {
    const msg = isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed.";
    return { ok: false, error: msg, assistantText: "" };
  }
}

/**
 * SVAP §8: run a consequential action the user has explicitly confirmed. The
 * tool name + args come straight from the PendingConfirm the agent returned.
 * Access is re-checked server-side (the tool is re-resolved for this user), so
 * a client cannot confirm an action the user was never offered.
 */
export async function confirmWebAgentAction(input: {
  tool: string;
  args: Record<string, unknown>;
}): Promise<WebAgentResult> {
  try {
    const u = await requireUser();
    const user = agentUserFrom(u);
    const tool = (input.tool ?? "").trim();
    if (!tool) return { ok: false, error: "No action to confirm.", assistantText: "" };
    const args = input.args && typeof input.args === "object" ? input.args : {};
    return await executeConfirmedAction({ user, tool, args });
  } catch (e) {
    const msg = isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed.";
    return { ok: false, error: msg, assistantText: "" };
  }
}
