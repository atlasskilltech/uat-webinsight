import "server-only";
import type { LlmMessage, LlmBlock, LlmResponse, LlmToolDef } from "../agent/llm";

/**
 * OpenAI Chat Completions client + translation layer for the Invoice Agent.
 *
 * The agent orchestrator and the invoice extractor both speak an Anthropic-shaped
 * message/tool protocol (text / tool_use / tool_result blocks). This module
 * provides a thin fetch-based OpenAI client (no SDK, consistent with the rest of
 * the codebase) and PURE functions that translate that protocol to OpenAI's
 * chat/completions format and back, so neither the orchestrator nor the
 * extractor pipeline needs to change.
 *
 * SECURITY: the API key is sent only in the Authorization header; it is never
 * logged or placed in an error message. Errors carry only the HTTP status + a
 * short slice of OpenAI's error JSON (which does not echo the request content).
 */

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;

function openAiApiKey(): string {
  const key = process.env.AI_API_KEY?.trim();
  if (!key) throw new Error("AI_API_KEY is not set.");
  return key;
}

/** The OpenAI model id to use. Required for the OpenAI provider (no silent default). */
export function openAiModel(): string {
  const m = process.env.AI_MODEL?.trim();
  if (!m) {
    throw new Error("AI_MODEL is not set. Set it to an OpenAI model id (e.g. gpt-4.1) for AI_PROVIDER=openai.");
  }
  return m;
}

// --- OpenAI wire types (only the fields we use) -----------------------------

interface OpenAiToolCall {
  id: string;
  type?: "function";
  function: { name: string; arguments: string };
}
export interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}
export interface OpenAiTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface OpenAiChatResponse {
  choices?: {
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason?: string;
  }[];
}

/** Low-level call to OpenAI chat/completions. Throws a safe error on non-2xx. */
export async function openAiChat(
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<OpenAiChatResponse> {
  let res: Response;
  try {
    res = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "failed";
    throw new Error(`OpenAI request ${reason}.`);
  }
  if (!res.ok) {
    // OpenAI error body is an error JSON (message/type/code); it never echoes the prompt.
    throw new Error(`OpenAI request failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as OpenAiChatResponse;
}

// --- Translation: Anthropic-shaped protocol <-> OpenAI ----------------------

/** Anthropic-style tool defs -> OpenAI function tools. */
export function toOpenAiTools(tools: LlmToolDef[]): OpenAiTool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/**
 * Anthropic-style messages -> OpenAI messages. A `tool_use` block on an assistant
 * turn becomes a `tool_calls` entry; each `tool_result` block on a user turn
 * becomes its own `role:"tool"` message (OpenAI's required shape), keeping the
 * ids so results line up with the calls that produced them.
 */
export function toOpenAiMessages(system: string, messages: LlmMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const blocks: LlmBlock[] = m.content;
    if (m.role === "assistant") {
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")
        .trim();
      const toolCalls: OpenAiToolCall[] = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: b.id ?? "",
          type: "function",
          function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
        }));
      const msg: OpenAiMessage = { role: "assistant", content: text || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
    } else {
      // user turn: tool_result blocks -> tool messages; any text -> user message.
      for (const b of blocks) {
        if (b.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: b.tool_use_id ?? "",
            content: typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""),
          });
        } else if (b.type === "text") {
          out.push({ role: "user", content: b.text ?? "" });
        }
      }
    }
  }
  return out;
}

/** OpenAI chat response -> Anthropic-shaped LlmResponse (text + tool_use blocks). */
export function fromOpenAiResponse(resp: OpenAiChatResponse): LlmResponse {
  const choice = resp.choices?.[0];
  const msg = choice?.message;
  const blocks: LlmBlock[] = [];
  if (msg?.content) blocks.push({ type: "text", text: msg.content });
  for (const tc of msg?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.function.arguments || "{}");
    } catch {
      input = {};
    }
    blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
  }
  const fr = choice?.finish_reason;
  const stop_reason = fr === "tool_calls" ? "tool_use" : fr === "length" ? "max_tokens" : "end_turn";
  return { content: blocks, stop_reason };
}

/** Agent tool-use call via OpenAI, returning the Anthropic-shaped response. */
export async function callOpenAiLlm(input: {
  system: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  maxTokens?: number;
}): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: openAiModel(),
    max_completion_tokens: input.maxTokens ?? 1500,
    messages: toOpenAiMessages(input.system, input.messages),
  };
  if (input.tools.length) {
    body.tools = toOpenAiTools(input.tools);
    body.tool_choice = "auto";
  }
  return fromOpenAiResponse(await openAiChat(body));
}
