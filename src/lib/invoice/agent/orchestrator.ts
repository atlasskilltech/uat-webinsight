import "server-only";
import { TOOLS, getTool, type AgentContext } from "./tools";
import { canUseTool, needsApproval } from "./policy";
import { callLlm, aiConfigured, type LlmMessage, type LlmBlock } from "./llm";
import {
  createConversation,
  addMessage,
  getMessages,
  createRun,
  finishRun,
  addStep,
  addToolCall,
  createAgentApproval,
  logActivity,
} from "../services/agent";

export interface AgentStepView {
  tool: string;
  summary: string;
  ok: boolean;
}
export interface AgentApprovalView {
  id: string;
  action: string;
  summary: string;
}
export interface AgentTurnResult {
  ok: boolean;
  error?: string;
  conversationId: string;
  assistantText: string;
  steps: AgentStepView[];
  approvals: AgentApprovalView[];
}

const MAX_ITERATIONS = 5;

function systemPrompt(ctx: AgentContext): string {
  return [
    "You are the Atlas Invoice Agent, a finance assistant for one organization.",
    "You help with accounts payable (incoming) and receivable (outgoing) invoices.",
    "Use ONLY the provided tools to read or act on data — you have no other access and must never ask for raw SQL.",
    "Never invent numbers, invoices, vendors or statuses. If a tool returns nothing, say so plainly.",
    "Sensitive actions (e.g. recording a payment) are not executed by you: they create an approval request a human must approve.",
    "Be concise. Prefer tables/short lists. Always ground answers in tool results, citing invoice numbers where possible.",
    `The current user's finance role is ${ctx.role}.`,
  ].join(" ");
}

function textOf(blocks: LlmBlock[]): string {
  return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
}

/** Run one agent turn: plan, call tools, verify, persist, and return the result. */
export async function runAgent(
  ctx: AgentContext,
  conversationId: string | null,
  userText: string,
): Promise<AgentTurnResult> {
  if (!aiConfigured()) {
    return {
      ok: false,
      error: "The AI assistant is not configured. Set AI_PROVIDER, AI_MODEL and AI_API_KEY in Invoice Settings.",
      conversationId: conversationId ?? "",
      assistantText: "",
      steps: [],
      approvals: [],
    };
  }

  const convId = conversationId ?? (await createConversation(ctx.organizationId, ctx.user.id));
  await addMessage(ctx.organizationId, convId, "user", userText);
  const runId = await createRun(ctx.organizationId, convId, ctx.user.id, userText);
  await logActivity(ctx.organizationId, runId, ctx.user.id, "run.started", userText.slice(0, 200));

  // Tools the user is allowed to use (write tools excluded if no capability).
  const allowed = TOOLS.filter((t) => canUseTool(ctx, t));
  const llmTools = allowed.map((t) => ({ name: t.name, description: t.description, input_schema: t.jsonSchema }));

  // Build conversation context from stored text turns (last 10).
  const history = await getMessages(convId, 12);
  const messages: LlmMessage[] = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-10)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));
  if (messages.length === 0 || messages[messages.length - 1].content !== userText) {
    messages.push({ role: "user", content: userText });
  }

  const steps: AgentStepView[] = [];
  const approvals: AgentApprovalView[] = [];
  let assistantText = "";
  let stepOrder = 1;

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const resp = await callLlm({ system: systemPrompt(ctx), messages, tools: llmTools });
      const toolUses = resp.content.filter((b) => b.type === "tool_use");

      if (toolUses.length === 0) {
        assistantText = textOf(resp.content);
        break;
      }

      // Record the assistant's tool-use turn verbatim (required by the protocol).
      messages.push({ role: "assistant", content: resp.content });
      await addStep(ctx.organizationId, runId, stepOrder++, "plan", `Model requested ${toolUses.length} tool(s).`);

      const toolResultBlocks: LlmBlock[] = [];
      for (const call of toolUses) {
        const name = call.name ?? "";
        const args = (call.input ?? {}) as Record<string, unknown>;
        const tool = getTool(name);
        const started = Date.now();

        if (!tool || !canUseTool(ctx, tool)) {
          const msg = `Tool '${name}' is not available or not permitted.`;
          await addToolCall(ctx.organizationId, runId, name, args, { allowed: false, requiresApproval: false, status: "denied", error: msg });
          steps.push({ tool: name, summary: msg, ok: false });
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: msg });
          continue;
        }

        const parsed = tool.input.safeParse(args);
        if (!parsed.success) {
          const msg = `Invalid arguments: ${parsed.error.issues[0]?.message ?? "schema error"}.`;
          await addToolCall(ctx.organizationId, runId, name, args, { allowed: true, requiresApproval: needsApproval(tool), status: "failed", error: msg });
          steps.push({ tool: name, summary: msg, ok: false });
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: msg });
          continue;
        }

        if (needsApproval(tool)) {
          const summary = `${tool.name}(${JSON.stringify(parsed.data)})`;
          const toolCallId = await addToolCall(ctx.organizationId, runId, name, parsed.data, { allowed: true, requiresApproval: true, status: "awaiting_approval" });
          const approvalId = await createAgentApproval(ctx.organizationId, runId, toolCallId, ctx.user.id, tool.name, summary, { tool: tool.name, args: parsed.data });
          approvals.push({ id: approvalId, action: tool.name, summary });
          steps.push({ tool: name, summary: "Approval requested (awaiting human).", ok: true });
          await addStep(ctx.organizationId, runId, stepOrder++, "verify", `Write tool ${tool.name} requires approval.`);
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Approval request created (id ${approvalId}). This action is NOT executed until a human approves it. Tell the user it is pending approval.`,
          });
          continue;
        }

        // Read tool: execute now.
        try {
          const result = await tool.run(ctx, parsed.data as Record<string, unknown>);
          await addToolCall(ctx.organizationId, runId, name, parsed.data, { allowed: true, requiresApproval: false, status: result.ok ? "succeeded" : "failed", output: result.data ?? null, durationMs: Date.now() - started });
          steps.push({ tool: name, summary: result.summary, ok: result.ok });
          const payload = JSON.stringify({ summary: result.summary, data: result.data }).slice(0, 8000);
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: payload });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Tool failed.";
          await addToolCall(ctx.organizationId, runId, name, parsed.data, { allowed: true, requiresApproval: false, status: "failed", error: msg, durationMs: Date.now() - started });
          steps.push({ tool: name, summary: msg, ok: false });
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: `Error: ${msg}` });
        }
      }

      messages.push({ role: "user", content: toolResultBlocks });
    }

    if (!assistantText) {
      assistantText =
        approvals.length > 0
          ? "I've prepared the requested action — it's waiting for your approval below."
          : "I gathered the information above. Ask me to refine or take the next step.";
    }

    await addMessage(ctx.organizationId, convId, "assistant", assistantText, { steps, approvals }, runId);
    await finishRun(runId, "succeeded", { steps: steps.length, approvals: approvals.length });
    await logActivity(ctx.organizationId, runId, ctx.user.id, "run.succeeded", `${steps.length} tool step(s), ${approvals.length} approval(s).`);

    return { ok: true, conversationId: convId, assistantText, steps, approvals };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Agent run failed.";
    await finishRun(runId, "failed", null, msg);
    await logActivity(ctx.organizationId, runId, ctx.user.id, "run.failed", msg);
    await addMessage(ctx.organizationId, convId, "assistant", `Sorry — I hit an error: ${msg}`, null, runId);
    return { ok: false, error: msg, conversationId: convId, assistantText: `Sorry — I hit an error: ${msg}`, steps, approvals };
  }
}
