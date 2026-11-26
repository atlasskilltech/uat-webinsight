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

// Mock the write actions so the agent's write tools don't hit the DB.
const W = vi.hoisted(() => ({ createTask: vi.fn(async () => ({ status: "success", message: "Task created.", id: "T9" })) }));
vi.mock("@/app/work/actions", () => ({
  createTask: W.createTask,
  addWorkLog: vi.fn(async () => ({ status: "success", message: "Work log added." })),
}));
vi.mock("@/app/issues/actions", () => ({ createIssue: vi.fn(async () => ({ status: "success", message: "Issue recorded.", id: "I9" })) }));
vi.mock("@/app/inspector/actions", () => ({ runAudit: vi.fn(async () => ({ status: "success", message: "Audit complete.", id: "A9" })) }));

const { toolsFor, routeCatalogText } = await import("@/lib/web-agent/tools");
const { runWebAgent, executeConfirmedAction } = await import("@/lib/web-agent/orchestrator");
const { isAffirmation, isNegation, isSupportedLocale, SVAP, SVAP_DEFAULT_LOCALE } = await import("@/lib/web-agent/svap-config");

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

  it("full user gets write tools; invoice-only user does not", () => {
    const full = toolsFor(fullUser).map((t) => t.name);
    expect(full).toContain("create_task");
    expect(full).toContain("add_work_log");
    expect(full).toContain("record_issue");
    expect(full).toContain("start_audit");
    const inv = toolsFor(invoiceOnly).map((t) => t.name);
    expect(inv).not.toContain("create_task");
    expect(inv).not.toContain("start_audit");
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

  it("SVAP §8: a write action is GATED — returns a confirm and does NOT run yet", async () => {
    H.responses = [
      { content: [{ type: "tool_use", id: "t1", name: "create_task", input: { title: "Fix meta description", priority: "high" } }], stop_reason: "tool_use" },
    ];
    const r = await runWebAgent({ user: fullUser, history: [], message: "create a task to fix the meta description" });
    expect(r.ok).toBe(true);
    expect(W.createTask).not.toHaveBeenCalled(); // held back until confirmed
    expect(r.confirm?.tool).toBe("create_task");
    expect(r.confirm?.args).toMatchObject({ title: "Fix meta description" });
    expect(r.confirm?.summary).toMatch(/Fix meta description/);
    expect(r.confirm?.summary).toMatch(/high/i); // read-back includes key params
    expect(r.navigate).toBeUndefined();
  });

  it("SVAP §8: executeConfirmedAction runs the confirmed write and navigates", async () => {
    const r = await executeConfirmedAction({ user: fullUser, tool: "create_task", args: { title: "Fix meta description" } });
    expect(W.createTask).toHaveBeenCalled();
    expect(r.ok).toBe(true);
    expect(r.navigate?.path).toBe("/work");
  });

  it("SVAP §8: a non-consequential or unknown tool cannot be confirmed", async () => {
    const bad = await executeConfirmedAction({ user: fullUser, tool: "navigate", args: { to: "seo" } });
    expect(bad.ok).toBe(false);
    const unknown = await executeConfirmedAction({ user: fullUser, tool: "nope", args: {} });
    expect(unknown.ok).toBe(false);
    // an invoice-only user cannot confirm a website write they were never offered
    const denied = await executeConfirmedAction({ user: invoiceOnly, tool: "create_task", args: { title: "x" } });
    expect(denied.ok).toBe(false);
  });

  it("answers from a reply with no tools", async () => {
    H.responses = [{ content: [{ type: "text", text: "You have 3 open tasks." }], stop_reason: "end_turn" }];
    const r = await runWebAgent({ user: fullUser, history: [], message: "how many open tasks" });
    expect(r.ok).toBe(true);
    expect(r.navigate).toBeUndefined();
    expect(r.assistantText).toBe("You have 3 open tasks.");
  });
});

describe("SVAP config (§21) + confirm parsing (§8)", () => {
  it("timings are within the spec's ranges", () => {
    expect(SVAP.endOfSpeechMs).toBeGreaterThanOrEqual(800);
    expect(SVAP.endOfSpeechMs).toBeLessThanOrEqual(2000);
    expect(SVAP.bargeInMs).toBeLessThanOrEqual(300);
    expect(SVAP.noSpeechMs).toBeGreaterThanOrEqual(4000);
    expect(SVAP.noSpeechMs).toBeLessThanOrEqual(15000);
    expect(SVAP.activationLatencyMs).toBeLessThanOrEqual(500);
  });

  it("affirmation / negation parse, and ambiguous counts as neither (treated as NO upstream)", () => {
    expect(isAffirmation("yes")).toBe(true);
    expect(isAffirmation("yeah go ahead")).toBe(true);
    expect(isAffirmation("okay")).toBe(true);
    expect(isNegation("no")).toBe(true);
    expect(isNegation("cancel that")).toBe(true);
    expect(isNegation("stop")).toBe(true);
    // ambiguous: not an affirmation (so the gate will not fire)
    expect(isAffirmation("maybe later")).toBe(false);
    expect(isNegation("maybe later")).toBe(false);
  });

  it("locale validation accepts the supported set and rejects others", () => {
    expect(isSupportedLocale(SVAP_DEFAULT_LOCALE)).toBe(true);
    expect(isSupportedLocale("en-IN")).toBe(true);
    expect(isSupportedLocale("fr-FR")).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
  });
});
