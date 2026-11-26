import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKey, hashKey, bearerKey, ipAllowed, keyLast4, sameHash } from "@/lib/agent-api/keys";
import { normaliseScopes, accessLabel, SCOPE_IDS, PRESETS } from "@/lib/agent-api/scopes";
import { ACTIONS, allowedActions, publicAction } from "@/lib/agent-api/actions";

/**
 * Covers the ATLAS Agent API (docs/AGENT-API.md): key helpers, the scope
 * catalogue, action/manifest shaping, and the full request handler with the DB
 * layer mocked (auth → manifest → action → 401/403 paths, acts-as-user).
 */

// ─── In-memory DB mock shared by repo + handler + actions ─────────
const KEY = generateKey();
const state = {
  keyRow: {
    id: "k1",
    name: "IntelligenceOS (read only)",
    keyHash: hashKey(KEY),
    keyLast4: keyLast4(KEY),
    scopes: ["work.read", "overview.read"] as string[],
    requireUser: false,
    allowedIps: null as string | null,
    expiresAt: null as Date | null,
    revoked: false,
    revokedAt: null,
    revokedBy: null,
    lastUsedAt: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  users: [] as Array<{ email: string; name: string; role: string; status: string; accessScope: string }>,
};

vi.mock("@/lib/db", () => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("FROM `Task`")) return [{ id: "T1", title: "Fix title tags", status: "in_progress" }];
    if (sql.includes("FROM `User`")) return [];
    return [];
  }),
  queryOne: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes("FROM `AgentApiKey`")) {
      return params[0] === state.keyRow.keyHash ? { ...state.keyRow } : null;
    }
    if (sql.includes("FROM `User`")) {
      const email = String(params[0]).toLowerCase();
      return state.users.find((u) => u.email.toLowerCase() === email && u.status === "active") ?? null;
    }
    return null;
  }),
  execute: vi.fn(async () => ({ affectedRows: 1 })),
  transaction: vi.fn(),
  json: (v: unknown) => (v == null ? null : JSON.stringify(v)),
}));

// Pull the handler + repo in after the mock is registered.
const { handleAgentRequest } = await import("@/lib/agent-api/handler");
const { ensureTables } = await import("@/lib/agent-api/repo");
const db = await import("@/lib/db");

function req(path: string, { key = KEY, user }: { key?: string | null; user?: string } = {}) {
  const headers: Record<string, string> = {};
  if (key) headers.authorization = `Bearer ${key}`;
  if (user) headers["x-intelligenceos-user"] = user;
  return new Request(`https://insight.example${path}`, { headers });
}

beforeEach(() => {
  state.keyRow.scopes = ["work.read", "overview.read"];
  state.keyRow.revoked = false;
  state.keyRow.requireUser = false;
  state.keyRow.allowedIps = null;
  state.keyRow.expiresAt = null;
  state.users = [];
});

describe("key helpers", () => {
  it("generates a prefixed key of sufficient length and hashes deterministically", () => {
    expect(KEY.startsWith("atl_")).toBe(true);
    expect(KEY.length).toBeGreaterThanOrEqual(32);
    expect(hashKey(KEY)).toEqual(hashKey(KEY));
    expect(hashKey(KEY)).not.toEqual(hashKey(KEY + "x"));
  });
  it("extracts only atl_ bearer keys", () => {
    expect(bearerKey(`Bearer ${KEY}`)).toBe(KEY);
    expect(bearerKey("Bearer notprefixed")).toBeNull();
    expect(bearerKey(null)).toBeNull();
  });
  it("constant-time hash compare and IP allowlist", () => {
    expect(sameHash(hashKey(KEY), hashKey(KEY))).toBe(true);
    expect(sameHash(hashKey(KEY), hashKey("other"))).toBe(false);
    expect(ipAllowed(null, "1.2.3.4")).toBe(true);
    expect(ipAllowed("1.2.3.4", "1.2.3.4")).toBe(true);
    expect(ipAllowed("1.2.3.4", "5.6.7.8")).toBe(false);
  });
});

describe("scopes + actions catalogue", () => {
  it("read_all preset equals every scope and labels full access", () => {
    expect(PRESETS.read_all.scopes).toEqual(SCOPE_IDS);
    expect(accessLabel(SCOPE_IDS)).toMatch(/all areas/i);
    expect(normaliseScopes(["work.read", "bogus"])).toEqual(["work.read"]);
  });
  it("every action is a unique, read-only GET with a known scope", () => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const a of ACTIONS) {
      expect(a.method).toBe("GET");
      expect(a.risk).toBe("read");
      expect(SCOPE_IDS).toContain(a.scope);
      expect(ids.has(a.id)).toBe(false);
      ids.add(a.id);
      expect(paths.has(`${a.method} ${a.path}`)).toBe(false);
      paths.add(`${a.method} ${a.path}`);
    }
    expect(publicAction(ACTIONS[0])).not.toHaveProperty("run");
    expect(publicAction(ACTIONS[0])).not.toHaveProperty("scope");
  });
  it("delegated invoice-only users get no actions", () => {
    const full = { email: "a@x.com", name: "A", role: "user" as const, accessScope: "full" as const };
    const invoice = { ...full, accessScope: "invoice_only" as const };
    expect(allowedActions(SCOPE_IDS, full).length).toBeGreaterThan(0);
    expect(allowedActions(SCOPE_IDS, invoice).length).toBe(0);
  });
});

describe("auto-provisioning", () => {
  it("creates both tables on first use (CREATE TABLE IF NOT EXISTS)", async () => {
    await ensureTables();
    const creates = vi
      .mocked(db.execute)
      .mock.calls.map((c) => String(c[0]))
      .filter((sql) => /CREATE TABLE IF NOT EXISTS/i.test(sql));
    expect(creates.some((s) => s.includes("`AgentApiKey`"))).toBe(true);
    expect(creates.some((s) => s.includes("`AgentApiLog`"))).toBe(true);
  });
});

describe("handler", () => {
  it("rejects a missing or wrong key with 401", async () => {
    expect((await handleAgentRequest(req("/manifest", { key: null }), ["manifest"], "GET")).status).toBe(401);
    expect((await handleAgentRequest(req("/manifest", { key: "atl_wrong" }), ["manifest"], "GET")).status).toBe(401);
  });

  it("returns a manifest of only the key's allowed actions", async () => {
    const r = await handleAgentRequest(req("/manifest"), ["manifest"], "GET");
    expect(r.status).toBe(200);
    const body = r.body as { spec: string; actions: Array<{ id: string; scope?: string }> };
    expect(body.spec).toBe("atlas-agent-api/1");
    const ids = body.actions.map((a) => a.id);
    expect(ids).toContain("search_tasks"); // work.read
    expect(ids).toContain("overview_summary"); // overview.read
    expect(ids).not.toContain("list_issues"); // issues.read not granted
    expect(body.actions[0]).not.toHaveProperty("scope");
  });

  it("runs an allowed action", async () => {
    const r = await handleAgentRequest(req("/tasks"), ["tasks"], "GET");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("tasks");
  });

  it("refuses an action whose scope the key lacks (403)", async () => {
    const r = await handleAgentRequest(req("/issues"), ["issues"], "GET");
    expect(r.status).toBe(403);
  });

  it("revoked key is rejected", async () => {
    state.keyRow.revoked = true;
    expect((await handleAgentRequest(req("/manifest"), ["manifest"], "GET")).status).toBe(401);
  });

  it("acts-as-user: unknown user 403, active full-access user allowed", async () => {
    state.keyRow.requireUser = true;
    // No user supplied on an action call → 403.
    expect((await handleAgentRequest(req("/tasks"), ["tasks"], "GET")).status).toBe(403);
    // Unknown user → 403.
    expect(
      (await handleAgentRequest(req("/tasks", { user: "ghost@x.com" }), ["tasks"], "GET")).status,
    ).toBe(403);
    // Known active full-access user → 200.
    state.users = [{ email: "real@x.com", name: "Real", role: "user", status: "active", accessScope: "full" }];
    expect(
      (await handleAgentRequest(req("/tasks", { user: "real@x.com" }), ["tasks"], "GET")).status,
    ).toBe(200);
  });
});
