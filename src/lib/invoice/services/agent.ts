import "server-only";
import { iQuery, iQueryOne, iExecute, ijson } from "../db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { getTool, type AgentContext } from "../agent/tools";
import { canUseTool } from "../agent/policy";
import { recordPayment } from "./payments";

// --- Conversations & messages ----------------------------------------------

export interface ConversationRow {
  id: string;
  organization_id: string;
  user_id: string;
  title: string | null;
  status: string;
  last_message_at: Date | null;
  created_at: Date;
}
export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string | null;
  tool_calls: unknown;
  created_at: Date;
}

export async function createConversation(organizationId: string, userId: string, title?: string): Promise<string> {
  const id = createId();
  await iExecute(
    "INSERT INTO `agent_conversations` (`id`,`organization_id`,`user_id`,`title`,`last_message_at`) VALUES (?,?,?,?,NOW(3))",
    [id, organizationId, userId, title ?? null],
  );
  return id;
}

export async function listConversations(organizationId: string, userId: string): Promise<ConversationRow[]> {
  return iQuery<ConversationRow>(
    "SELECT * FROM `agent_conversations` WHERE organization_id=? AND user_id=? AND status='active' ORDER BY last_message_at DESC LIMIT 100",
    [organizationId, userId],
  );
}

export async function getConversation(organizationId: string, userId: string, id: string): Promise<ConversationRow | null> {
  return iQueryOne<ConversationRow>(
    "SELECT * FROM `agent_conversations` WHERE organization_id=? AND user_id=? AND id=?",
    [organizationId, userId, id],
  );
}

export async function getMessages(conversationId: string, limit = 50): Promise<MessageRow[]> {
  const rows = await iQuery<MessageRow>(
    "SELECT * FROM `agent_messages` WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?",
    [conversationId, limit],
  );
  return rows.reverse();
}

export async function addMessage(
  organizationId: string,
  conversationId: string,
  role: "user" | "assistant" | "tool" | "system",
  content: string,
  toolCalls?: unknown,
  runId?: string,
): Promise<string> {
  const id = createId();
  await iExecute(
    "INSERT INTO `agent_messages` (`id`,`organization_id`,`conversation_id`,`role`,`content`,`tool_calls`,`run_id`) VALUES (?,?,?,?,?,?,?)",
    [id, organizationId, conversationId, role, content, ijson(toolCalls ?? null), runId ?? null],
  );
  await iExecute(
    "UPDATE `agent_conversations` SET `last_message_at`=NOW(3), `title`=COALESCE(`title`,?) WHERE id=?",
    [role === "user" ? content.slice(0, 60) : null, conversationId],
  );
  return id;
}

// --- Runs / steps / tool calls ---------------------------------------------

export async function createRun(organizationId: string, conversationId: string, userId: string, instruction: string): Promise<string> {
  const id = createId();
  await iExecute(
    "INSERT INTO `agent_runs` (`id`,`organization_id`,`conversation_id`,`user_id`,`instruction`,`status`) VALUES (?,?,?,?,?,'running')",
    [id, organizationId, conversationId, userId, instruction.slice(0, 2000)],
  );
  return id;
}

export async function finishRun(runId: string, status: string, result?: unknown, error?: string): Promise<void> {
  await iExecute(
    "UPDATE `agent_runs` SET `status`=?, `result`=?, `error`=?, `finished_at`=NOW(3) WHERE id=?",
    [status, ijson(result ?? null), error ?? null, runId],
  );
}

export async function addStep(organizationId: string, runId: string, order: number, kind: string, summary: string, data?: unknown): Promise<void> {
  await iExecute(
    "INSERT INTO `agent_steps` (`id`,`organization_id`,`run_id`,`step_order`,`kind`,`summary`,`data`) VALUES (?,?,?,?,?,?,?)",
    [createId(), organizationId, runId, order, kind, summary.slice(0, 2000), ijson(data ?? null)],
  );
}

export async function addToolCall(
  organizationId: string,
  runId: string,
  toolName: string,
  args: unknown,
  info: { allowed: boolean; requiresApproval: boolean; status: string; output?: unknown; error?: string; durationMs?: number },
): Promise<string> {
  const id = createId();
  await iExecute(
    "INSERT INTO `agent_tool_calls` (`id`,`organization_id`,`run_id`,`tool_name`,`arguments`,`permission_checked`,`allowed`,`requires_approval`,`status`,`output`,`error`,`duration_ms`) " +
      "VALUES (?,?,?,?,?,1,?,?,?,?,?,?)",
    [id, organizationId, runId, toolName, ijson(args), info.allowed, info.requiresApproval, info.status, ijson(info.output ?? null), info.error ?? null, info.durationMs ?? null],
  );
  return id;
}

export async function logActivity(organizationId: string, runId: string | null, userId: string | null, event: string, summary: string, data?: unknown): Promise<void> {
  await iExecute(
    "INSERT INTO `agent_activity_logs` (`id`,`organization_id`,`run_id`,`user_id`,`event`,`summary`,`data`) VALUES (?,?,?,?,?,?,?)",
    [createId(), organizationId, runId, userId, event, summary.slice(0, 2000), ijson(data ?? null)],
  );
}

export async function listActivity(organizationId: string, limit = 50) {
  return iQuery<{ id: string; event: string; summary: string; created_at: Date }>(
    "SELECT id, event, summary, created_at FROM `agent_activity_logs` WHERE organization_id=? ORDER BY created_at DESC LIMIT ?",
    [organizationId, limit],
  );
}

// --- Approvals (human-in-the-loop for write tools) -------------------------

export interface AgentApprovalRow {
  id: string;
  organization_id: string;
  run_id: string | null;
  tool_call_id: string | null;
  action: string;
  summary: string | null;
  payload: unknown;
  status: string;
  created_at: Date;
}

export async function createAgentApproval(
  organizationId: string,
  runId: string | null,
  toolCallId: string | null,
  requestedByUserId: string,
  action: string,
  summary: string,
  payload: unknown,
): Promise<string> {
  const id = createId();
  await iExecute(
    "INSERT INTO `agent_approvals` (`id`,`organization_id`,`run_id`,`tool_call_id`,`requested_by_user_id`,`action`,`summary`,`payload`) VALUES (?,?,?,?,?,?,?,?)",
    [id, organizationId, runId, toolCallId, requestedByUserId, action, summary.slice(0, 2000), ijson(payload)],
  );
  return id;
}

export async function listAgentApprovals(organizationId: string, status = "pending"): Promise<AgentApprovalRow[]> {
  return iQuery<AgentApprovalRow>(
    "SELECT * FROM `agent_approvals` WHERE organization_id=? AND status=? ORDER BY created_at DESC LIMIT 100",
    [organizationId, status],
  );
}

/**
 * Approve or reject an agent-requested write. On approval the server re-validates
 * the tool arguments and the APPROVER's capability, then executes the mapped
 * service (never arbitrary SQL, never the LLM). Rejection records the reason.
 */
export async function decideAgentApproval(
  ctx: AgentContext,
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<{ ok: boolean; message: string }> {
  const approval = await iQueryOne<AgentApprovalRow>(
    "SELECT * FROM `agent_approvals` WHERE organization_id=? AND id=?",
    [ctx.organizationId, approvalId],
  );
  if (!approval) return { ok: false, message: "Approval not found." };
  if (approval.status !== "pending") return { ok: false, message: "Already decided." };

  if (decision === "rejected") {
    await iExecute("UPDATE `agent_approvals` SET `status`='rejected', `decided_by_user_id`=?, `decided_at`=NOW(3) WHERE id=?", [ctx.user.id, approvalId]);
    await logActivity(ctx.organizationId, approval.run_id, ctx.user.id, "approval.rejected", `Rejected ${approval.action}.`);
    return { ok: true, message: "Rejected." };
  }

  const tool = getTool(approval.action);
  if (!tool || tool.kind !== "write") return { ok: false, message: "Unknown or non-write action." };
  if (!canUseTool(ctx, tool)) return { ok: false, message: "You lack permission to approve this action." };

  const parsed = tool.input.safeParse((approval.payload as { args?: unknown })?.args ?? approval.payload);
  if (!parsed.success) return { ok: false, message: "Stored arguments are no longer valid." };

  // Execute the mapped service for the write tool.
  try {
    if (tool.name === "record_payment") {
      const a = parsed.data as { invoiceId: string; amount: string; paidOn: string; method?: string; reference?: string };
      await recordPayment(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, {
        invoiceId: a.invoiceId,
        amount: a.amount,
        paidOn: a.paidOn,
        method: a.method as never,
        txnReference: a.reference,
      });
    } else {
      return { ok: false, message: `No executor mapped for ${tool.name}.` };
    }
    await iExecute("UPDATE `agent_approvals` SET `status`='approved', `decided_by_user_id`=?, `decided_at`=NOW(3) WHERE id=?", [ctx.user.id, approvalId]);
    await logActivity(ctx.organizationId, approval.run_id, ctx.user.id, "approval.approved", `Approved and executed ${approval.action}.`);
    await logInvoiceAudit({
      organizationId: ctx.organizationId,
      actorType: "agent",
      actorUserId: ctx.user.id,
      actorLabel: `${ctx.user.email} (agent-approved)`,
      action: `agent.${tool.name}`,
      entityType: "agent_approval",
      entityId: approvalId,
    });
    return { ok: true, message: "Approved and executed." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Execution failed." };
  }
}
