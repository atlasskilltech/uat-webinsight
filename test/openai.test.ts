import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  toOpenAiTools,
  toOpenAiMessages,
  fromOpenAiResponse,
  callOpenAiLlm,
  type OpenAiChatResponse,
} from "@/lib/invoice/ai/openai";
import { getExtractor } from "@/lib/invoice/ai/extract";
import { callLlm, type LlmMessage, type LlmToolDef } from "@/lib/invoice/agent/llm";

/**
 * OpenAI provider tests — fully mocked. Covers the pure Anthropic<->OpenAI
 * translation, the invoice extractor's OpenAI path, and the agent dispatch.
 * No network: global fetch is stubbed per test.
 */

function setEnv() {
  process.env.AI_PROVIDER = "openai";
  process.env.AI_MODEL = "gpt-4.1";
  process.env.AI_API_KEY = "sk-test-key";
}
function clearEnv() {
  for (const k of ["AI_PROVIDER", "AI_MODEL", "AI_API_KEY"]) delete process.env[k];
}

/** Stub fetch for the OpenAI endpoint; record the request body it received. */
function mockOpenAi(response: { status?: number; body: unknown }) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

beforeEach(setEnv);
afterEach(() => {
  vi.unstubAllGlobals();
  clearEnv();
});

describe("OpenAI translation helpers", () => {
  it("maps Anthropic tool defs to OpenAI function tools", () => {
    const tools: LlmToolDef[] = [
      { name: "search_emails", description: "Search", input_schema: { type: "object", properties: {} } },
    ];
    expect(toOpenAiTools(tools)).toEqual([
      { type: "function", function: { name: "search_emails", description: "Search", parameters: { type: "object", properties: {} } } },
    ]);
  });

  it("translates messages: system first, tool_use -> tool_calls, tool_result -> tool message", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "list accounts" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "call_1", name: "list_connected_accounts", input: { limit: 5 } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "2 accounts" }] },
    ];
    const out = toOpenAiMessages("SYS", messages);
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(out[1]).toEqual({ role: "user", content: "list accounts" });
    expect(out[2].role).toBe("assistant");
    expect(out[2].content).toBe("checking");
    expect(out[2].tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "list_connected_accounts", arguments: JSON.stringify({ limit: 5 }) } },
    ]);
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "2 accounts" });
  });

  it("translates an OpenAI response back to text + tool_use blocks with mapped stop_reason", () => {
    const resp: OpenAiChatResponse = {
      choices: [
        {
          message: {
            content: "working",
            tool_calls: [{ id: "call_9", function: { name: "get_email_details", arguments: '{"id":"abc"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const out = fromOpenAiResponse(resp);
    expect(out.stop_reason).toBe("tool_use");
    expect(out.content).toEqual([
      { type: "text", text: "working" },
      { type: "tool_use", id: "call_9", name: "get_email_details", input: { id: "abc" } },
    ]);
  });

  it("maps finish_reason stop->end_turn and length->max_tokens", () => {
    expect(fromOpenAiResponse({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }).stop_reason).toBe("end_turn");
    expect(fromOpenAiResponse({ choices: [{ message: { content: "hi" }, finish_reason: "length" }] }).stop_reason).toBe("max_tokens");
  });
});

describe("callOpenAiLlm", () => {
  it("sends model/tools/messages and returns a translated tool_use response", async () => {
    const calls = mockOpenAi({
      body: {
        choices: [
          { message: { content: null, tool_calls: [{ id: "call_1", function: { name: "search_emails", arguments: "{}" } }] }, finish_reason: "tool_calls" },
        ],
      },
    });
    const out = await callOpenAiLlm({
      system: "SYS",
      messages: [{ role: "user", content: "find invoices" }],
      tools: [{ name: "search_emails", description: "Search", input_schema: { type: "object" } }],
    });
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0].body.model).toBe("gpt-4.1");
    expect(calls[0].body.tool_choice).toBe("auto");
    expect((calls[0].body.tools as unknown[]).length).toBe(1);
    expect(out.content[0]).toEqual({ type: "tool_use", id: "call_1", name: "search_emails", input: {} });
  });

  it("omits tools when none are provided", async () => {
    const calls = mockOpenAi({ body: { choices: [{ message: { content: "done" }, finish_reason: "stop" }] } });
    await callOpenAiLlm({ system: "SYS", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(calls[0].body.tools).toBeUndefined();
    expect(calls[0].body.tool_choice).toBeUndefined();
  });
});

describe("OpenAI invoice extractor", () => {
  it("getExtractor returns the OpenAI extractor and extracts validated JSON", async () => {
    const invoice = { invoiceNumber: "INV-42", supplierName: "Acme", grandTotal: "1180.00" };
    mockOpenAi({ body: { choices: [{ message: { content: JSON.stringify(invoice) }, finish_reason: "stop" }] } });
    const extractor = getExtractor();
    expect(extractor?.provider).toBe("openai");
    const res = await extractor!.extract({ text: "TAX INVOICE INV-42 ..." });
    expect(res.provider).toBe("openai");
    expect(res.model).toBe("gpt-4.1");
    expect(res.data.invoiceNumber).toBe("INV-42");
    expect(res.data.grandTotal).toBe("1180.00");
  });

  it("throws a safe error on an OpenAI API failure", async () => {
    mockOpenAi({ status: 429, body: { error: { message: "rate limited" } } });
    const extractor = getExtractor();
    await expect(extractor!.extract({ text: "secret invoice text" })).rejects.toThrow(/OpenAI request failed: 429/);
  });

  it("throws when AI_MODEL is unset", async () => {
    delete process.env.AI_MODEL;
    mockOpenAi({ body: { choices: [{ message: { content: "{}" } }] } });
    const extractor = getExtractor();
    await expect(extractor!.extract({ text: "x" })).rejects.toThrow(/AI_MODEL is not set/);
  });
});

describe("agent callLlm dispatch", () => {
  it("routes to OpenAI when AI_PROVIDER=openai", async () => {
    const calls = mockOpenAi({ body: { choices: [{ message: { content: "hello" }, finish_reason: "stop" }] } });
    const out = await callLlm({ system: "SYS", messages: [{ role: "user", content: "hi" }], tools: [] });
    expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(out.content[0]).toEqual({ type: "text", text: "hello" });
  });
});
