import "server-only";
import { z } from "zod";
import { iQuery, iQueryOne } from "../db";
import type { FinanceCapability } from "../types";
import { listGmailAccounts, classifyEmail } from "../services/gmail";
import { listActivity } from "../services/agent";
import { listForwards, forwardCounts } from "../services/forwarding";

/**
 * Tool registry for the AI Invoice Agent (email-monitoring + forwarding focus).
 *
 * The LLM can ONLY invoke these registered tools — it never sees the database
 * and never writes SQL. Every tool declares a required capability and a kind:
 *  - "read"  tools run immediately after a permission check.
 *  - "write" tools (forwarding / sending email) NEVER run from the model
 *    directly; the orchestrator turns them into a human approval request and
 *    they run only after a person approves. Inputs are Zod-validated.
 */

export interface AgentContext {
  organizationId: string;
  user: { id: string; email: string };
  role: string;
}
export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
}
export interface ToolDef {
  name: string;
  description: string;
  capability: FinanceCapability;
  kind: "read" | "write";
  jsonSchema: Record<string, unknown>;
  input: z.ZodTypeAny;
  run: (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

// --- READ TOOLS -------------------------------------------------------------

const listConnectedAccounts: ToolDef = {
  name: "list_connected_accounts",
  description: "List connected Gmail accounts with status, auto-forward setting, and email/invoice counts.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({}),
  input: z.object({}),
  async run(ctx) {
    const rows = await listGmailAccounts(ctx.organizationId);
    return {
      ok: true,
      summary: `${rows.length} connected account(s).`,
      data: rows.map((a) => ({
        email: a.email,
        status: a.status,
        autoForward: a.auto_forward,
        invoiceEmailsDetected: Number(a.invoice_detected),
        invoicesForwarded: Number(a.forwarded_count),
        invoicesPending: Number(a.pending_count),
        lastSyncAt: a.last_sync_at,
      })),
    };
  },
};

const searchEmails: ToolDef = {
  name: "search_emails",
  description:
    "Search monitored emails. Filters: account (email address), q (text in subject/sender), " +
    "invoiceOnly (only invoice candidates), days (received within N days). Returns recent matches.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({
    account: { type: "string" },
    q: { type: "string" },
    invoiceOnly: { type: "boolean" },
    days: { type: "number" },
    limit: { type: "number" },
  }),
  input: z.object({
    account: z.string().optional(),
    q: z.string().optional(),
    invoiceOnly: z.boolean().optional(),
    days: z.number().int().min(1).max(365).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async run(ctx, args) {
    const where: string[] = ["m.organization_id = ?"];
    const params: unknown[] = [ctx.organizationId];
    if (args.account) {
      where.push("g.email = ?");
      params.push(String(args.account).toLowerCase());
    }
    if (args.invoiceOnly) where.push("m.is_invoice_candidate = 1");
    if (args.q) {
      where.push("(m.subject LIKE ? OR m.from_address LIKE ?)");
      params.push(`%${args.q}%`, `%${args.q}%`);
    }
    if (args.days) {
      where.push("m.received_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)");
      params.push(args.days);
    }
    params.push((args.limit as number | undefined) ?? 25);
    const rows = await iQuery<Record<string, unknown>>(
      "SELECT m.id, m.subject, m.from_address, m.received_at, m.classification, m.classification_confidence, " +
        "m.is_invoice_candidate, m.processing_status, g.email AS account FROM `email_messages` m " +
        "LEFT JOIN `gmail_integrations` g ON g.id = m.gmail_integration_id " +
        `WHERE ${where.join(" AND ")} ORDER BY m.received_at DESC LIMIT ?`,
      params,
    );
    return { ok: true, summary: `${rows.length} email(s).`, data: rows };
  },
};

const getEmailDetails: ToolDef = {
  name: "get_email_details",
  description: "Get one monitored email by id, with its attachments and forward status.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ emailId: { type: "string" } }, ["emailId"]),
  input: z.object({ emailId: z.string().min(1) }),
  async run(ctx, args) {
    const email = await iQueryOne<Record<string, unknown>>(
      "SELECT m.*, g.email AS account FROM `email_messages` m LEFT JOIN `gmail_integrations` g ON g.id=m.gmail_integration_id WHERE m.organization_id=? AND m.id=?",
      [ctx.organizationId, String(args.emailId)],
    );
    if (!email) return { ok: false, summary: "Email not found." };
    const attachments = await iQuery<Record<string, unknown>>(
      "SELECT filename, mime_type, size_bytes, download_status FROM `email_attachments` WHERE email_message_id=?",
      [String(args.emailId)],
    );
    const forward = await iQueryOne<Record<string, unknown>>(
      "SELECT status, destination, forwarded_at, last_error FROM `invoice_forwards` WHERE email_message_id=? LIMIT 1",
      [String(args.emailId)],
    );
    return { ok: true, summary: "Email details.", data: { email, attachments, forward } };
  },
};

const classifyInvoiceEmail: ToolDef = {
  name: "classify_invoice_email",
  description: "Re-run the invoice classifier on a monitored email and return its classification + confidence.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ emailId: { type: "string" } }, ["emailId"]),
  input: z.object({ emailId: z.string().min(1) }),
  async run(ctx, args) {
    const email = await iQueryOne<{ subject: string | null; from_address: string | null; snippet: string | null }>(
      "SELECT subject, from_address, snippet FROM `email_messages` WHERE organization_id=? AND id=?",
      [ctx.organizationId, String(args.emailId)],
    );
    if (!email) return { ok: false, summary: "Email not found." };
    const atts = await iQueryOne<{ c: number }>(
      "SELECT COUNT(*) c FROM `email_attachments` WHERE email_message_id=?",
      [String(args.emailId)],
    );
    const r = classifyEmail({
      subject: email.subject ?? "",
      from: email.from_address ?? "",
      snippet: email.snippet ?? "",
      hasAttachment: Number(atts?.c ?? 0) > 0,
    });
    return { ok: true, summary: `${r.classification} (${Math.round(r.confidence * 100)}%).`, data: r };
  },
};

const getInvoiceAttachments: ToolDef = {
  name: "get_invoice_attachments",
  description: "List the attachments of a monitored email.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ emailId: { type: "string" } }, ["emailId"]),
  input: z.object({ emailId: z.string().min(1) }),
  async run(ctx, args) {
    const rows = await iQuery<Record<string, unknown>>(
      "SELECT ea.filename, ea.mime_type, ea.size_bytes, ea.download_status FROM `email_attachments` ea " +
        "JOIN `email_messages` m ON m.id=ea.email_message_id WHERE m.organization_id=? AND ea.email_message_id=?",
      [ctx.organizationId, String(args.emailId)],
    );
    return { ok: true, summary: `${rows.length} attachment(s).`, data: rows };
  },
};

const extractInvoiceData: ToolDef = {
  name: "extract_invoice_data",
  description: "Return the AI-extracted invoice fields stored for an identified invoice (by email id).",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ emailId: { type: "string" } }, ["emailId"]),
  input: z.object({ emailId: z.string().min(1) }),
  async run(ctx, args) {
    const row = await iQueryOne<Record<string, unknown>>(
      "SELECT i.invoice_number, i.party_name_raw, i.invoice_date, i.due_date, i.grand_total, i.currency, " +
        "e.raw_json, e.overall_confidence, e.needs_review FROM `invoices` i " +
        "JOIN `invoice_extractions` e ON e.invoice_id=i.id WHERE i.organization_id=? AND i.source_email_message_id=? ORDER BY e.created_at DESC LIMIT 1",
      [ctx.organizationId, String(args.emailId)],
    );
    if (!row) return { ok: false, summary: "No extraction found for that email (AI extraction may be off)." };
    return { ok: true, summary: "Extracted invoice data.", data: row };
  },
};

const searchInvoiceRecords: ToolDef = {
  name: "search_invoice_records",
  description: "Search identified invoice records. Filters: q (number/vendor), limit.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ q: { type: "string" }, limit: { type: "number" } }),
  input: z.object({ q: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }),
  async run(ctx, args) {
    const where: string[] = ["organization_id = ?", "deleted_at IS NULL"];
    const params: unknown[] = [ctx.organizationId];
    if (args.q) {
      where.push("(invoice_number LIKE ? OR party_name_raw LIKE ?)");
      params.push(`%${args.q}%`, `%${args.q}%`);
    }
    params.push((args.limit as number | undefined) ?? 25);
    const rows = await iQuery<Record<string, unknown>>(
      "SELECT id, invoice_number, party_name_raw, invoice_date, due_date, grand_total, currency, payment_status, source " +
        `FROM \`invoices\` WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    return { ok: true, summary: `${rows.length} invoice record(s).`, data: rows };
  },
};

const detectDuplicateInvoices: ToolDef = {
  name: "detect_duplicate_invoices",
  description: "List open suspected-duplicate invoice matches with score and reasons.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({}),
  input: z.object({}),
  async run(ctx) {
    const rows = await iQuery<Record<string, unknown>>(
      "SELECT d.invoice_id, d.matched_invoice_id, d.score, ia.invoice_number AS invoice, ib.invoice_number AS matched " +
        "FROM `invoice_duplicate_matches` d LEFT JOIN `invoices` ia ON ia.id=d.invoice_id LEFT JOIN `invoices` ib ON ib.id=d.matched_invoice_id " +
        "WHERE d.organization_id=? AND d.resolution='open' ORDER BY d.score DESC LIMIT 100",
      [ctx.organizationId],
    );
    return { ok: true, summary: `${rows.length} open duplicate match(es).`, data: rows };
  },
};

const generateInvoiceSummary: ToolDef = {
  name: "generate_invoice_summary",
  description: "Summarize monitoring + forwarding activity (emails monitored, invoices identified, forwarded, awaiting review).",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ days: { type: "number" } }),
  input: z.object({ days: z.number().int().min(1).max(365).optional() }),
  async run(ctx, args) {
    const days = (args.days as number | undefined) ?? 30;
    const scalar = async (sql: string) => Number((await iQueryOne<{ c: number }>(sql, [ctx.organizationId, days]))?.c ?? 0);
    const emails = await scalar("SELECT COUNT(*) c FROM `email_messages` WHERE organization_id=? AND received_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)");
    const identified = await scalar("SELECT COUNT(*) c FROM `email_messages` WHERE organization_id=? AND is_invoice_candidate=1 AND received_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)");
    const counts = await forwardCounts(ctx.organizationId);
    return {
      ok: true,
      summary: `Last ${days}d: ${emails} emails, ${identified} invoices identified, ${counts.forwarded ?? 0} forwarded.`,
      data: { days, emails, identified, forwarded: counts.forwarded ?? 0, awaitingReview: (counts.pending ?? 0) + (counts.review ?? 0), failed: counts.failed ?? 0 },
    };
  },
};

const generateInvoiceReport: ToolDef = {
  name: "generate_invoice_report",
  description: "Vendor-wise report of identified invoices (count and total per vendor).",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ limit: { type: "number" } }),
  input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
  async run(ctx, args) {
    const rows = await iQuery<Record<string, unknown>>(
      "SELECT COALESCE(party_name_raw,'Unknown') AS vendor, COUNT(*) AS invoices, COALESCE(SUM(grand_total),0) AS total " +
        "FROM `invoices` WHERE organization_id=? AND deleted_at IS NULL GROUP BY vendor ORDER BY total DESC LIMIT ?",
      [ctx.organizationId, (args.limit as number | undefined) ?? 50],
    );
    return { ok: true, summary: `${rows.length} vendor(s).`, data: rows };
  },
};

const identifyPendingInvoices: ToolDef = {
  name: "identify_pending_invoices",
  description: "List invoice emails pending forwarding or awaiting review (not yet forwarded).",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({}),
  input: z.object({}),
  async run(ctx) {
    const pending = (await listForwards(ctx.organizationId, { status: "pending" })).concat(
      await listForwards(ctx.organizationId, { status: "review" }),
    );
    return {
      ok: true,
      summary: `${pending.length} email(s) pending/awaiting review.`,
      data: pending.map((f) => ({ forwardId: f.id, emailId: f.email_message_id, subject: f.subject, from: f.from_address, confidence: f.confidence, status: f.status })),
    };
  },
};

const identifyOverdueInvoices: ToolDef = {
  name: "identify_overdue_invoices",
  description: "List identified invoices whose extracted due date is in the past and not marked paid.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({}),
  input: z.object({}),
  async run(ctx) {
    const rows = await iQuery<Record<string, unknown>>(
      "SELECT invoice_number, party_name_raw, due_date, grand_total, currency, DATEDIFF(CURDATE(), due_date) AS overdue_days " +
        "FROM `invoices` WHERE organization_id=? AND deleted_at IS NULL AND due_date IS NOT NULL AND due_date < CURDATE() " +
        "AND payment_status <> 'PAID' ORDER BY due_date ASC LIMIT 100",
      [ctx.organizationId],
    );
    return { ok: true, summary: `${rows.length} overdue invoice(s).`, data: rows };
  },
};

const getAgentActivity: ToolDef = {
  name: "get_agent_activity",
  description: "Recent agent activity log entries.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ limit: { type: "number" } }),
  input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
  async run(ctx, args) {
    const rows = await listActivity(ctx.organizationId, (args.limit as number | undefined) ?? 20);
    return { ok: true, summary: `${rows.length} activity entr(y/ies).`, data: rows };
  },
};

const draftFollowUpEmail: ToolDef = {
  name: "draft_follow_up_email",
  description:
    "Draft (but DO NOT send) a follow-up email. Provide recipient context and the points to make; returns subject + body text for review.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ about: { type: "string" }, points: { type: "string" } }, ["about"]),
  input: z.object({ about: z.string().min(1), points: z.string().optional() }),
  async run(_ctx, args) {
    // The model composes; this tool just structures the request and echoes it as a draft.
    return {
      ok: true,
      summary: "Draft prepared (not sent).",
      data: { about: args.about, points: args.points ?? "", note: "Review this draft, then use send_authorized_email to send it (requires approval)." },
    };
  },
};

// --- WRITE TOOLS (approval-gated; executed only after human approval) --------

const forwardInvoiceEmail: ToolDef = {
  name: "forward_invoice_email",
  description:
    "Forward a monitored invoice email (original attached as .eml) to the configured Finance & Accounts destination. " +
    "SENSITIVE: requires human approval before it sends.",
  capability: "email.send",
  kind: "write",
  jsonSchema: obj({ emailId: { type: "string" } }, ["emailId"]),
  input: z.object({ emailId: z.string().min(1) }),
  async run() {
    return { ok: false, summary: "forward_invoice_email requires approval before it runs." };
  },
};

const sendAuthorizedEmail: ToolDef = {
  name: "send_authorized_email",
  description: "Send an email via the organization's email provider. SENSITIVE: requires human approval.",
  capability: "email.send",
  kind: "write",
  jsonSchema: obj({ to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, ["to", "subject", "body"]),
  input: z.object({ to: z.string().email(), subject: z.string().min(1).max(300), body: z.string().min(1).max(20000) }),
  async run() {
    return { ok: false, summary: "send_authorized_email requires approval before it runs." };
  },
};

const retryFailedTask: ToolDef = {
  name: "retry_failed_task",
  description: "Retry a failed forward by its forward id. SENSITIVE: requires human approval.",
  capability: "email.send",
  kind: "write",
  jsonSchema: obj({ forwardId: { type: "string" } }, ["forwardId"]),
  input: z.object({ forwardId: z.string().min(1) }),
  async run() {
    return { ok: false, summary: "retry_failed_task requires approval before it runs." };
  },
};

export const TOOLS: ToolDef[] = [
  listConnectedAccounts,
  searchEmails,
  getEmailDetails,
  classifyInvoiceEmail,
  getInvoiceAttachments,
  extractInvoiceData,
  searchInvoiceRecords,
  detectDuplicateInvoices,
  generateInvoiceSummary,
  generateInvoiceReport,
  identifyPendingInvoices,
  identifyOverdueInvoices,
  getAgentActivity,
  draftFollowUpEmail,
  forwardInvoiceEmail,
  sendAuthorizedEmail,
  retryFailedTask,
];

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
