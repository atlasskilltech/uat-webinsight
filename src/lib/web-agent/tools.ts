import "server-only";
import { allowedActions, type Action, type ActionParam } from "@/lib/agent-api/actions";
import { SCOPE_IDS } from "@/lib/agent-api/scopes";
import type { AgentUser } from "@/lib/agent-api/common";
import { isPathAllowedForScope } from "@/lib/auth/access";
import { createTask, addWorkLog } from "@/app/work/actions";
import { createIssue } from "@/app/issues/actions";
import { runAudit } from "@/app/inspector/actions";
import { idleState } from "@/lib/form-state";

/** Build a FormData from a flat object, skipping empty values. */
function formData(obj: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && String(v) !== "") f.append(k, String(v));
  }
  return f;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

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
  // A full-access user is internal staff with access to the whole workspace, so
  // their reads are UNSCOPED (all organisations' invoices, etc.) — pass no user
  // to the action. An invoice-only user stays scoped to their own organisations.
  const runUser = user.accessScope === "full" ? null : user;

  const reads = allowedActions(SCOPE_IDS, user); // ACTIONS filtered by scope + access
  const readTools: WebAgentTool[] = reads.map((action) => ({
    name: `read_${action.id}`,
    description: action.description,
    inputSchema: actionInputSchema(action),
    run: async (args) => {
      const { path, query } = splitArgs(action, args);
      const data = await action.run({ path, query, user: runUser });
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

  // Write actions: only for full-access users (the underlying actions enforce
  // this too). The agent performs these directly for the user.
  const writeTools = runUser === null ? writeToolsFor() : [];

  return [navTool, ...writeTools, ...readTools];
}

// ─── Write tools (full-access only) ──────────────────────────────
function str(args: Record<string, unknown>, k: string): string | undefined {
  const v = args[k];
  return v === undefined || v === null || v === "" ? undefined : String(v);
}

function writeToolsFor(): WebAgentTool[] {
  return [
    {
      name: "create_task",
      description:
        "Create a new task in My Work. Use when the user asks to add/create a task or to-do. Returns the created task; then the user is taken to My Work.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          title: { type: "string", description: "Short task title" },
          description: { type: "string" },
          category: { type: "string", description: "e.g. seo, content, technical, other" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          dueDate: { type: "string", description: "Due date, YYYY-MM-DD (optional)" },
        },
      },
      run: async (args) => {
        const res = await createTask(idleState, formData({
          title: str(args, "title"),
          description: str(args, "description"),
          category: str(args, "category"),
          priority: str(args, "priority"),
          dueDate: str(args, "dueDate"),
        }));
        return {
          data: { ok: res.status === "success", message: res.message ?? "", taskId: res.id ?? null },
          navigate: res.status === "success" ? { path: "/work", label: "My Work" } : undefined,
        };
      },
    },
    {
      name: "add_work_log",
      description: "Add a daily work-log entry (what was done). Use when the user wants to log work they did.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: {
          summary: { type: "string", description: "What was done" },
          category: { type: "string", description: "e.g. seo, content, technical, other" },
          minutes: { type: "integer", description: "Minutes spent (optional)" },
          date: { type: "string", description: "Date YYYY-MM-DD (defaults to today)" },
        },
      },
      run: async (args) => {
        const res = await addWorkLog(idleState, formData({
          summary: str(args, "summary"),
          category: str(args, "category"),
          minutes: str(args, "minutes"),
          date: str(args, "date") ?? todayISO(),
        }));
        return {
          data: { ok: res.status === "success", message: res.message ?? "" },
          navigate: res.status === "success" ? { path: "/work", label: "My Work" } : undefined,
        };
      },
    },
    {
      name: "record_issue",
      description: "Record a technical SEO issue in the issue register. Use when the user wants to log/record an issue.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["title"],
        properties: {
          title: { type: "string" },
          category: { type: "string", description: "e.g. indexing, performance, content, other" },
          severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          impact: { type: "string" },
          recommendedFix: { type: "string" },
          urls: { type: "string", description: "Affected URL(s), comma or newline separated (optional)" },
        },
      },
      run: async (args) => {
        const res = await createIssue(idleState, formData({
          title: str(args, "title"),
          category: str(args, "category"),
          severity: str(args, "severity"),
          priority: str(args, "priority"),
          impact: str(args, "impact"),
          recommendedFix: str(args, "recommendedFix"),
          urls: str(args, "urls"),
        }));
        return {
          data: { ok: res.status === "success", message: res.message ?? "", issueId: res.id ?? null },
          navigate: res.status === "success" ? { path: "/issues", label: "Technical SEO Issues" } : undefined,
        };
      },
    },
    {
      name: "start_audit",
      description:
        "Run a Page Inspector audit on a URL (on-page SEO / technical checks). Use when the user asks to audit, inspect or check a page. Then the user is taken to the audit result.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: { url: { type: "string", description: "Full URL to audit, e.g. https://atlasuniversity.edu.in/" } },
      },
      run: async (args) => {
        const res = await runAudit(idleState, formData({ url: str(args, "url") }));
        return {
          data: { ok: res.status === "success", message: res.message ?? "" },
          navigate: res.status === "success" && res.id ? { path: `/inspector/${res.id}`, label: "Page Inspector" } : undefined,
        };
      },
    },
  ];
}

/** Human-readable catalogue of pages, for the system prompt. */
export function routeCatalogText(user: AgentUser): string {
  return allowedRouteKeys(user)
    .map((k) => `- ${k}: ${ROUTES[k].label} (${ROUTES[k].path})`)
    .join("\n");
}
