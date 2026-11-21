"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/invoice/permissions";
import { isAuthError } from "@/lib/auth/guard";
import { runAgent, type AgentTurnResult } from "@/lib/invoice/agent/orchestrator";
import { decideAgentApproval } from "@/lib/invoice/services/agent";
import type { AgentContext } from "@/lib/invoice/agent/tools";

async function agentContext(): Promise<AgentContext> {
  const ctx = await requireCapability("agent.use");
  return { organizationId: ctx.organizationId, user: { id: ctx.user.id, email: ctx.user.email }, role: ctx.role! };
}

export async function sendAgentMessageAction(input: {
  conversationId: string | null;
  message: string;
}): Promise<AgentTurnResult> {
  try {
    const ctx = await agentContext();
    const text = (input.message ?? "").trim();
    if (!text) {
      return { ok: false, error: "Empty message.", conversationId: input.conversationId ?? "", assistantText: "", steps: [], approvals: [] };
    }
    const result = await runAgent(ctx, input.conversationId, text.slice(0, 4000));
    revalidatePath("/invoices/assistant");
    return result;
  } catch (e) {
    const msg = isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed.";
    return { ok: false, error: msg, conversationId: input.conversationId ?? "", assistantText: "", steps: [], approvals: [] };
  }
}

export async function decideAgentApprovalAction(input: {
  approvalId: string;
  decision: "approved" | "rejected";
}): Promise<{ ok: boolean; message: string }> {
  try {
    const ctx = await agentContext();
    const res = await decideAgentApproval(ctx, input.approvalId, input.decision);
    revalidatePath("/invoices/assistant");
    revalidatePath("/invoices");
    return res;
  } catch (e) {
    return { ok: false, message: isAuthError(e) ? e.message : e instanceof Error ? e.message : "Failed." };
  }
}
