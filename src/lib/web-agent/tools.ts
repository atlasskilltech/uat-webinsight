import "server-only";
import { allowedActions, type Action, type ActionParam } from "@/lib/agent-api/actions";
import { SCOPE_IDS } from "@/lib/agent-api/scopes";
import type { AgentUser } from "@/lib/agent-api/common";
import { isPathAllowedForScope } from "@/lib/auth/access";

/**
 * Tools for the in-app Web Insight Agent. The READ tools reuse the exact same
 * catalogue the external IntelligenceOS Agent API exposes
 * (src/lib/agent-api/actions.ts) — one source of truth for "what the agent can
 * read". A NAVIGATE tool lets the agent take the user to a page.
 *
 * Everything here is read-only or navigation; no writes.
 */

export interface NavigateDirective {
  path: string;
  label: string;
}

export interface WebAgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Returns either data (read) or a navigation directive. */
  run: (args: Record<string, unknown>) => Promise<{ data?: unknown; navigate?: NavigateDirective }>;
}

// ─── Pages the agent may navigate to ─────────────────────────────
interface RouteDef {
  path: string;
  label: string;
  adminOnly?: boolean;
}
const ROUTES: Record<string, RouteDef> = {
  dashboard: { path: "/", label: "Executive Dashboard" },
  work: { path: "/work", label: "My Work (tasks & daily log)" },
  seo: { path: "/seo", label: "SEO & Analytics" },
  inspector: { path: "/inspector", label: "Page Inspector" },
  issues: { path: "/issues", label: "Technical SEO Issues" },
  operations: { path: "/operations", label: "Backend & Server" },
  competitors: { path: "/competitors", label: "Competitor Intelligence" },
  reports: { path: "/reports", label: "Reports & History" },
  invoices: { path: "/invoices", label: "Invoice Agent" },
  invoice_accounts: { path: "/invoices/email-accounts", label: "Connected inboxes" },
  settings: { path: "/settings", label: "Settings & Integrations", adminOnly: true },
  agent_api: { path: "/settings/agent-api", label: "Agent API (IntelligenceOS)", adminOnly: true },
  users: { path: "/admin/users", label: "User Management", adminOnly: true },
};

/** Route keys this user may be taken to (access scope + admin gated). */
function allowedRouteKeys(user: AgentUser): string[] {
  return Object.entries(ROUTES)
    .filter(([, r]) => isPathAllowedForScope(user.accessScope, r.path) && (!r.adminOnly || user.role === "admin"))
    .map(([key]) => key);
}

// ─── Read-action → LLM tool-schema conversion ────────────────────
function jsonType(t: ActionParam["type"]): string {
  return t === "integer" ? "integer" : t === "number" ? "number" : t === "boolean" ? "boolean" : "string";
}

function actionInputSchema(action: Action): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of action.params) {
    properties[p.name] = {
      type: jsonType(p.type),
      ...(p.enum ? { enum: p.enum } : {}),
      ...(p.description ? { description: p.description } : {}),
    };
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

/** Split a flat args object into the action's path vs query params. */
function splitArgs(action: Action, args: Record<string, unknown>): { path: Record<string, string>; query: Record<string, string> } {
  const path: Record<string, string> = {};
  const query: Record<string, string> = {};
  for (const p of action.params) {
    const v = args[p.name];
    if (v === undefined || v === null || v === "") continue;
    (p.in === "path" ? path : query)[p.name] = String(v);
  }
  return { path, query };
}

/**
 * The tools this user's agent can use: every read action their access allows,
 * plus a navigate tool. Read-tool names are prefixed `read_` so they never
 * collide with the navigate tool and read clearly in the transcript.
 */
export function toolsFor(user: AgentUser): WebAgentTool[] {
  const reads = allowedActions(SCOPE_IDS, user); // ACTIONS filtered by scope + access
  const readTools: WebAgentTool[] = reads.map((action) => ({
    name: `read_${action.id}`,
    description: action.description,
    inputSchema: actionInputSchema(action),
    run: async (args) => {
      const { path, query } = splitArgs(action, args);
      const data = await action.run({ path, query, user });
      return { data };
    },
  }));

  const routeKeys = allowedRouteKeys(user);
  const navTool: WebAgentTool = {
    name: "navigate",
    description:
      "Take the user to a page in Web Insight. Call this whenever the user asks to go to, open, show or see a page or view. The page opens in their browser.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["to"],
      properties: {
        to: {
          type: "string",
          enum: routeKeys,
          description:
            "Which page to open: " + routeKeys.map((k) => `${k} (${ROUTES[k].label})`).join(", ") + ".",
        },
      },
    },
    run: async (args) => {
      const key = String(args.to ?? "");
      const route = ROUTES[key];
      if (!route || !routeKeys.includes(key)) {
        return { data: { error: `Unknown or not-permitted page "${key}". Allowed: ${routeKeys.join(", ")}.` } };
      }
      return { navigate: { path: route.path, label: route.label } };
    },
  };

  return [navTool, ...readTools];
}

/** Human-readable catalogue of pages, for the system prompt. */
export function routeCatalogText(user: AgentUser): string {
  return allowedRouteKeys(user)
    .map((k) => `- ${k}: ${ROUTES[k].label} (${ROUTES[k].path})`)
    .join("\n");
}
