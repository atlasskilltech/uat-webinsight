import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentUser } from "@/lib/agent-api/common";

/**
 * Web Insight Agent: tool scoping (reads + navigate, access-filtered) and the
 * stateless read+navigate orchestrator, with the LLM mocked.
 */

const H = vi.hoisted(() => ({
  aiOn: true as boolean,
  responses: [] as Array<{ content: Array<Record<string, unknown>>; stop_reason: string }>,
}));

vi.mock("@/lib/invoice/agent/llm", () => ({
  aiConfigured: () => H.aiOn,
  agentModel: () => "test-model",
  callLlm: vi.fn(async () => H.responses.shift() ?? { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }),
}));

const { toolsFor, routeCatalogText } = await import("@/lib/web-agent/tools");
const { runWebAgent } = await import("@/lib/web-agent/orchestrator");

const fullAdmin: AgentUser = { email: "a@x.com", name: "Admin", role: "admin", accessScope: "full" };
const fullUser: AgentUser = { email: "u@x.com", name: "User", role: "user", accessScope: "full" };
const invoiceOnly: AgentUser = { email: "f@x.com", name: "Finance", role: "user", accessScope: "invoice_only" };

beforeEach(() => {
  H.aiOn = true;
  H.responses = [];
});

describe("tool scoping", () => {
  it("full user gets navigate + read tools across modules", () => {
    const tools = toolsFor(fullUser);
    const names = tools.map((t) => t.name);
    expect(names).toContain("navigate");
    expect(names).toContain("read_seo_summary");
    expect(names).toContain("read_search_tasks");
    expect(names).toContain("read_invoice_overview");
  });

  it("navigate enum is access- and admin-scoped", () => {
    const navAdmin = toolsFor(fullAdmin).find((t) => t.name === "navigate")!;
    const enumAdmin = ((navAdmin.inputSchema.properties as Record<string, { enum: string[] }>).to).enum;
    expect(enumAdmin).toContain("seo");
    expect(enumAdmin).toContain("agent_api"); // admin-only page, admin gets it

    const navUser = toolsFor(fullUser).find((t) => t.name === "navigate")!;
    const enumUser = ((navUser.inputSchema.properties as Record<string, { enum: string[] }>).to).enum;
    expect(enumUser).toContain("seo");
    expect(enumUser).not.toContain("agent_api"); // admin-only, non-admin excluded
  });

  it("invoice-only user gets only invoice reads + invoice routes", () => {
    const tools = toolsFor(invoiceOnly);
    const names = tools.map((t) => t.name);
    expect(names).toContain("navigate");
    expect(names).toContain("read_invoice_overview");
    expect(names).not.toContain("read_seo_summary"); // website reads not allowed
    const nav = tools.find((t) => t.name === "navigate")!;
    const routes = ((nav.inputSchema.properties as Record<string, { enum: string[] }>).to).enum;
    expect(routes).toContain("invoices");
    expect(routes).not.toContain("seo"); // not allowed for invoice-only scope
    expect(routeCatalogText(invoiceOnly)).toMatch(/invoices/);
  });

  it("a read tool's schema exposes its params", () => {
    const tasks = toolsFor(fullUser).find((t) => t.name === "read_search_tasks")!;
    const props = tasks.inputSchema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("status");
    expect(props).toHaveProperty("limit");
  });

  it("navigate tool returns a directive for a valid page and refuses others", async () => {
    const nav = toolsFor(fullUser).find((t) => t.name === "navigate")!;
    expect(await nav.run({ to: "seo" })).toEqual({ navigate: { path: "/seo", label: expect.any(String) } });
    const bad = await nav.run({ to: "agent_api" }); // admin-only, this user is not admin
    expect(bad.navigate).toBeUndefined();
    expect(bad.data).toHaveProperty("error");
  });
});

describe("orchestrator", () => {
  it("returns a not-configured error when AI is off", async () => {
    H.aiOn = false;
    const r = await runWebAgent({ user: fullUser, history: [], message: "hi" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not configured/i);
  });

  it("navigates when the model calls the navigate tool", async () => {
    // Turn 1: model asks to navigate. Turn 2: model replies with text.
    H.responses = [
      { content: [{ type: "tool_use", id: "t1", name: "navigate", input: { to: "seo" } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Opening SEO & Analytics." }], stop_reason: "end_turn" },
    ];
    const r = await runWebAgent({ user: fullUser, history: [], message: "take me to SEO" });
    expect(r.ok).toBe(true);
    expect(r.navigate?.path).toBe("/seo");
    expect(r.assistantText).toMatch(/SEO/i);
  });

  it("answers from a reply with no tools", async () => {
    H.responses = [{ content: [{ type: "text", text: "You have 3 open tasks." }], stop_reason: "end_turn" }];
    const r = await runWebAgent({ user: fullUser, history: [], message: "how many open tasks" });
    expect(r.ok).toBe(true);
    expect(r.navigate).toBeUndefined();
    expect(r.assistantText).toBe("You have 3 open tasks.");
  });
});
