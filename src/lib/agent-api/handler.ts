import "server-only";
import { queryOne } from "@/lib/db";
import { ACTIONS, allowedActions, publicAction } from "./actions";
import { ApiError, type AgentUser } from "./common";
import { bearerKey, hashKey, ipAllowed, normaliseIp, sameHash } from "./keys";
import { accessLabel } from "./scopes";
import { findKeyByHash, insertLog, touchKey, type LogEntry } from "./repo";
import type { AgentApiKey } from "@/lib/models";

/**
 * The ATLAS Agent API request handler (docs/AGENT-API.md, spec
 * `atlas-agent-api/1`). Framework-agnostic: it takes the standard Request plus
 * the catch-all path segments and returns a plain JSON payload + status.
 *
 *   GET  <base>/manifest   → the actions THIS key (and user) may use
 *   GET  <base><path>      → one action's data
 *
 * Every request re-checks the key, its scopes, expiry, revocation and (when the
 * key "acts as the signed-in user") the acting user's own access.
 */

export const SPEC = "atlas-agent-api/1";
export const PROJECT_NAME = "Atlas Web Insight";
const USER_HEADER = "x-intelligenceos-user";

export interface HandlerResult {
  status: number;
  body: unknown;
}

// ─── Lightweight in-memory rate limit (per key, best effort) ──────
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120; // requests per key per minute
const hits = new Map<string, number[]>();

function rateLimited(keyId: string): boolean {
  const now = Date.now();
  const arr = (hits.get(keyId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(keyId, arr);
  return arr.length > RATE_MAX;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return normaliseIp(fwd || req.headers.get("x-real-ip") || "");
}

function headerSafe(v: string | null): string | null {
  return v ? v.replace(/[^\x20-\x7e]/g, "").slice(0, 191) : null;
}

/** Live if not revoked and not past expiry. */
function keyActive(key: AgentApiKey): boolean {
  if (key.revoked) return false;
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

/** Resolve the acting user from an email (active users only). */
async function resolveUser(email: string): Promise<AgentUser | null> {
  const row = await queryOne<{ email: string; name: string | null; role: string; status: string; accessScope: string }>(
    "SELECT `email`, `name`, `role`, `status`, `accessScope` FROM `User` WHERE LOWER(`email`) = LOWER(?) AND `status` = 'active' LIMIT 1",
    [email.trim()],
  );
  if (!row) return null;
  return {
    email: row.email,
    name: row.name ?? row.email,
    role: row.role === "admin" ? "admin" : "user",
    accessScope: row.accessScope === "invoice_only" ? "invoice_only" : "full",
  };
}

/** Build the regex that matches an action's path, capturing {name} params. */
function pathMatcher(path: string): RegExp {
  return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{(\w+)\\\}/g, "(?<$1>[^/]+)")}$`);
}

/**
 * Handle one Agent API request.
 * @param req   the incoming Request (for headers)
 * @param segs  path segments after the base, e.g. ["manifest"] or ["tasks","L1"]
 * @param method HTTP method
 */
export async function handleAgentRequest(req: Request, segs: string[], method: string): Promise<HandlerResult> {
  const started = Date.now();
  const path = "/" + segs.map((s) => s).join("/");
  const ip = clientIp(req);
  const agent = headerSafe(req.headers.get("x-intelligenceos-agent"));
  const runId = headerSafe(req.headers.get("x-intelligenceos-run"));

  const log = (status: number, extra: Partial<LogEntry> = {}) =>
    insertLog({ path, method, agent, runId, ip, status, ms: Date.now() - started, ...extra });

  // 1. Authenticate the key.
  const raw = bearerKey(req.headers.get("authorization"));
  if (!raw) {
    await log(401, { error: "Missing bearer key" });
    return { status: 401, body: { error: "Authorization: Bearer <key> is required." } };
  }
  let key: AgentApiKey | null;
  try {
    key = await findKeyByHash(hashKey(raw));
  } catch {
    await log(503, { error: "Key store unavailable" });
    return { status: 503, body: { error: "The service is temporarily unavailable. Try again shortly." } };
  }
  if (!key || !sameHash(key.keyHash, hashKey(raw)) || !keyActive(key)) {
    await log(401, { keyId: key?.id ?? null, error: "Invalid/expired/revoked key" });
    return { status: 401, body: { error: "Invalid, expired or revoked key." } };
  }
  if (!ipAllowed(key.allowedIps, ip)) {
    await log(403, { keyId: key.id, error: `IP ${ip} not allowed` });
    return { status: 403, body: { error: "This key is not allowed from this IP address." } };
  }
  if (rateLimited(key.id)) {
    await log(429, { keyId: key.id, error: "Rate limited" });
    return { status: 429, body: { error: "Too many requests. Try again shortly." } };
  }
  void touchKey(key.id);

  // 2. Resolve the acting user (delegated keys).
  const userEmail = headerSafe(req.headers.get(USER_HEADER));
  let user: AgentUser | null = null;
  if (userEmail) {
    try {
      user = await resolveUser(userEmail);
    } catch {
      await log(503, { keyId: key.id, userEmail, error: "User store unavailable" });
      return { status: 503, body: { error: "The service is temporarily unavailable. Try again shortly." } };
    }
    if (!user) {
      await log(403, { keyId: key.id, userEmail, error: "Unknown/inactive user" });
      return { status: 403, body: { error: `${userEmail} is not an active Atlas Web Insight user.` } };
    }
    if (user.accessScope !== "full") {
      await log(403, { keyId: key.id, userEmail, error: "User lacks full access" });
      return { status: 403, body: { error: `${user.email} does not have access to Web Insight data.` } };
    }
  }

  // 3. Manifest.
  if (method === "GET" && path === "/manifest") {
    const actions = allowedActions(key.scopes, user);
    await log(200, { keyId: key.id, userEmail, action: "manifest" });
    return {
      status: 200,
      body: {
        spec: SPEC,
        project: { name: PROJECT_NAME, version: "1.0" },
        key: { name: key.name, access: accessLabel(key.scopes), expiresAt: key.expiresAt ?? null },
        actions: actions.map(publicAction),
      },
    };
  }

  // 4. Action calls. "Acts as the signed-in user" keys must name a user.
  if (key.requireUser && !userEmail) {
    await log(403, { keyId: key.id, error: "Key requires a user but none was supplied" });
    return {
      status: 403,
      body: { error: "This connection acts as the signed-in user, but no user was supplied." },
    };
  }

  const allowed = new Set(allowedActions(key.scopes, user).map((a) => a.id));

  // Match the path to an action, preferring the MOST specific route: a literal
  // path (e.g. /invoices/agent-activity) beats a parameterised one
  // (/invoices/{id}) that would otherwise swallow it. Rank by fewest path
  // params, then longest literal prefix.
  const paramCount = (p: string) => (p.match(/\{/g) ?? []).length;
  const literalLen = (p: string) => p.split("{")[0].length;
  const matches = ACTIONS.filter((a) => a.method === method && pathMatcher(a.path).test(path)).sort(
    (a, b) => paramCount(a.path) - paramCount(b.path) || literalLen(b.path) - literalLen(a.path),
  );

  {
    const action = matches[0];
    if (!action) {
      await log(404, { keyId: key.id, userEmail, error: "Unknown action" });
      return { status: 404, body: { error: `No action for ${method} ${path}.` } };
    }
    const m = pathMatcher(action.path).exec(path)!;

    if (!allowed.has(action.id)) {
      await log(403, { keyId: key.id, userEmail, action: action.id, error: "Scope/user not allowed" });
      return { status: 403, body: { error: `This key does not allow "${action.id}".` } };
    }

    const url = new URL(req.url);
    const pathParams = Object.fromEntries(
      Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(String(v))]),
    );
    const queryParams = Object.fromEntries(url.searchParams);

    try {
      const data = await action.run({ path: pathParams, query: queryParams, user });
      await log(200, { keyId: key.id, userEmail, action: action.id });
      return { status: 200, body: data };
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      const message = err instanceof ApiError ? err.message : "Internal error";
      await log(status, { keyId: key.id, userEmail, action: action.id, error: message });
      return { status, body: { error: message } };
    }
  }
}
