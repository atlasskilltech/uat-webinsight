import "server-only";
import { aiConfigured } from "../ai/extract";
import { callOpenAiLlm } from "../ai/openai";

/**
 * Anthropic Messages API client for the agent's tool-use loop. Uses the caller's
 * own AI_API_KEY. Provider-independent at the call site (orchestrator depends on
 * this thin interface), so another provider's tool-use could be slotted in.
 */

export interface LlmBlock {
  type: string; // "text" | "tool_use" | "tool_result" | ...
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result blocks sent back to the model:
  tool_use_id?: string;
  content?: unknown;
}
export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmBlock[];
}
export interface LlmToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
export interface LlmResponse {
  content: LlmBlock[];
  stop_reason: string;
}

export { aiConfigured };

/**
 * Whether the tool-use agent (Web Insight Agent) can run. This matches what
 * `callLlm` actually requires — an API key — and treats the provider as
 * optional (it defaults to anthropic). The invoice extractor's stricter
 * `aiConfigured` (which also requires AI_PROVIDER) is unchanged; using it here
 * would wrongly disable the agent whenever only AI_API_KEY is set.
 */
export function webAgentConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim());
}

export function agentModel(): string {
  return process.env.AI_MODEL?.trim() || "claude-sonnet-5-5";
}

export async function callLlm(input: {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  maxTokens?: number;
}): Promise<LlmResponse> {
  const key = process.env.AI_API_KEY?.trim();
  if (!key) throw new Error("AI is not configured (set AI_PROVIDER, AI_MODEL, AI_API_KEY).");
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (provider === "openai") {
    return callOpenAiLlm(input);
  }
  if (provider && provider !== "anthropic") {
    throw new Error(`AI_PROVIDER '${provider}' is not supported (use anthropic or openai).`);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: agentModel(),
      max_tokens: input.maxTokens ?? 1500,
      system: input.system,
      tools: input.tools,
      messages: input.messages,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    throw new Error(`AI request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { content?: LlmBlock[]; stop_reason?: string };
  return { content: json.content ?? [], stop_reason: json.stop_reason ?? "end_turn" };
}
