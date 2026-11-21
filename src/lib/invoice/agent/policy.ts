import "server-only";
import { roleHasCapability, type FinanceRole } from "../types";
import type { AgentContext, ToolDef } from "./tools";

/**
 * Policy engine. Every tool call is independently authorized by the server:
 * identity + organization are already resolved in AgentContext; here we check
 * the tool's required capability and whether it needs human approval.
 */
export function canUseTool(ctx: AgentContext, tool: ToolDef): boolean {
  return roleHasCapability(ctx.role as FinanceRole, tool.capability);
}

/** Write/sensitive tools always require explicit human approval. */
export function needsApproval(tool: ToolDef): boolean {
  return tool.kind === "write";
}
