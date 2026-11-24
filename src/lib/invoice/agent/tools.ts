import "server-only";
import { z } from "zod";
import { iQuery, iQueryOne } from "../db";
import type { FinanceCapability } from "../types";
import { listGmailAccounts, classifyEmail, getAccountAccessToken, syncGmailAccount } from "../services/gmail";
import { gmailListMessages, gmailGetMessage, getHeader, collectAttachments } from "../gmail/api";
import { listActivity } from "../services/agent";
import { listForwards, forwardCounts } from "../services/forwarding";

/** Build a Gmail search `q` from assistant filters (searches all mail — incl.
 *  archived — by default; spam/trash only when includeSpamTrash). Exported for
 *  tests. Free `query`/`invoiceNumber` use Gmail's full-text (covers the body). */
export function buildGmailQuery(a: {
  from?: string; to?: string; subject?: string; query?: string;
  after?: string; before?: string; hasAttachment?: boolean; filename?: string;
  invoiceNumber?: string; includeSpamTrash?: boolean;
}): string {
  const toGmailDate = (s: string): string => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s; // already Gmail-format (YYYY/MM/DD)
    return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  const parts: string[] = [];
  if (a.from) parts.push(`from:${a.from}`);
  if (a.to) parts.push(`to:${a.to}`);
  if (a.subject) parts.push(`subject:(${a.subject})`);
  if (a.filename) parts.push(`filename:${a.filename}`);
  if (a.hasAttachment) parts.push("has:attachment");
  if (a.after) parts.push(`after:${toGmailDate(a.after)}`);
  if (a.before) parts.push(`before:${toGmailDate(a.before)}`);
  if (a.invoiceNumber) parts.push(`"${String(a.invoiceNumber).replace(/"/g, "")}"`);
  if (a.query) parts.push(a.query);
  if (a.includeSpamTrash) parts.push("in:anywhere");
  return parts.join(" ").trim();
}

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
    "Search the LOCAL index of monitored emails (fast; covers synced mail). Filters: account (email), q (free text in " +
    "subject/sender/recipient/snippet), from, to, subject, invoiceNumber (matches an identified invoice's number), " +
    "invoiceOnly, hasAttachment, after/before (YYYY-MM-DD date range), days (within N days), limit, offset (pagination). " +
    "Returns each match with source details (account, date, from, to, subject) and its attachment filenames. For mail " +
    "older than the local index or archived mail not synced, use search_gmail_messages (live Gmail).",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({
    account: { type: "string" }, q: { type: "string" }, from: { type: "string" }, to: { type: "string" },
    subject: { type: "string" }, invoiceNumber: { type: "string" }, invoiceOnly: { type: "boolean" },
    hasAttachment: { type: "boolean" }, after: { type: "string" }, before: { type: "string" },
    days: { type: "number" }, limit: { type: "number" }, offset: { type: "number" },
  }),
  input: z.object({
    account: z.string().optional(), q: z.string().optional(), from: z.string().optional(), to: z.string().optional(),
    subject: z.string().optional(), invoiceNumber: z.string().optional(), invoiceOnly: z.boolean().optional(),
    hasAttachment: z.boolean().optional(), after: z.string().optional(), before: z.string().optional(),
    days: z.number().int().min(1).max(3650).optional(), limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(100000).optional(),
  }),
  async run(ctx, args) {
    const where: string[] = ["m.organization_id = ?"]; // org isolation
    const params: unknown[] = [ctx.organizationId];
    if (args.account) { where.push("g.email = ?"); params.push(String(args.account).toLowerCase()); }
    if (args.invoiceOnly) where.push("m.is_invoice_candidate = 1");
    if (args.q) { where.push("(m.subject LIKE ? OR m.from_address LIKE ? OR m.to_address LIKE ? OR m.snippet LIKE ?)"); const t = `%${args.q}%`; params.push(t, t, t, t); }
    if (args.from) { where.push("m.from_address LIKE ?"); params.push(`%${args.from}%`); }
    if (args.to) { where.push("m.to_address LIKE ?"); params.push(`%${args.to}%`); }
    if (args.subject) { where.push("m.subject LIKE ?"); params.push(`%${args.subject}%`); }
    if (args.invoiceNumber) {
      where.push("m.id IN (SELECT source_email_message_id FROM `invoices` WHERE organization_id=? AND invoice_number LIKE ? AND deleted_at IS NULL)");
      params.push(ctx.organizationId, `%${args.invoiceNumber}%`);
    }
    if (args.hasAttachment) where.push("EXISTS (SELECT 1 FROM `email_attachments` a WHERE a.email_message_id = m.id)");
    if (args.after) { where.push("m.received_at >= ?"); params.push(new Date(String(args.after))); }
    if (args.before) { where.push("m.received_at <= ?"); params.push(new Date(String(args.before))); }
    if (args.days) { where.push("m.received_at >= DATE_SUB(NOW(3), INTERVAL ? DAY)"); params.push(args.days); }
    const limit = (args.limit as number | undefined) ?? 25;
    const offset = (args.offset as number | undefined) ?? 0;
    params.push(limit, offset);
    const rows = await iQuery<{ id: string; [k: string]: unknown }>(
      "SELECT m.id, m.subject, m.from_address, m.to_address, m.received_at, m.classification, m.classification_confidence, " +
        "m.is_invoice_candidate, m.processing_status, m.gmail_message_id, g.email AS account FROM `email_messages` m " +
        "LEFT JOIN `gmail_integrations` g ON g.id = m.gmail_integration_id " +
        `WHERE ${where.join(" AND ")} ORDER BY m.received_at DESC LIMIT ? OFFSET ?`,
      params,
    );
    // Attach each message's attachment filenames (source details).
    for (const r of rows) {
      const atts = await iQuery<{ filename: string; mime_type: string }>(
        "SELECT filename, mime_type FROM `email_attachments` WHERE email_message_id=?",
        [r.id],
      );
      (r as Record<string, unknown>).attachments = atts;
    }
    return { ok: true, summary: `${rows.length} email(s) from the local index.`, data: rows };
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

const searchGmailMessages: ToolDef = {
  name: "search_gmail_messages",
  description:
    "LIVE search of this organization's connected Gmail accounts — including HISTORICAL and ARCHIVED mail not in the local " +
    "index. Use for older periods, prior years, or when search_emails finds nothing. Searches all mail (archived included); " +
    "spam/trash only when includeSpamTrash. Filters: account (email — else all connected accounts), from, to, subject, " +
    "query (free text; Gmail full-text — searches the body too), after/before (YYYY-MM-DD), hasAttachment, filename, " +
    "invoiceNumber, limit (per account, max 25), pageToken (continue one account's results). Returns matches with source " +
    "details (account, date, from, to, subject, snippet, attachments) and reports any account it could NOT access. Never " +
    "claims complete coverage when an account is unavailable. Tokens are never exposed.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({
    account: { type: "string" }, from: { type: "string" }, to: { type: "string" }, subject: { type: "string" },
    query: { type: "string" }, after: { type: "string" }, before: { type: "string" }, hasAttachment: { type: "boolean" },
    filename: { type: "string" }, invoiceNumber: { type: "string" }, includeSpamTrash: { type: "boolean" },
    limit: { type: "number" }, pageToken: { type: "string" },
  }),
  input: z.object({
    account: z.string().optional(), from: z.string().optional(), to: z.string().optional(), subject: z.string().optional(),
    query: z.string().optional(), after: z.string().optional(), before: z.string().optional(), hasAttachment: z.boolean().optional(),
    filename: z.string().optional(), invoiceNumber: z.string().optional(), includeSpamTrash: z.boolean().optional(),
    limit: z.number().int().min(1).max(25).optional(), pageToken: z.string().optional(),
  }),
  async run(ctx, args) {
    const q = buildGmailQuery(args as Parameters<typeof buildGmailQuery>[0]);
    if (!q) return { ok: false, summary: "Provide at least one search filter (sender, subject, text, date, filename, …)." };
    // ORGANIZATION ISOLATION: only this org's connected accounts are searchable.
    const connected = (await listGmailAccounts(ctx.organizationId)).filter((a) => a.status === "connected");
    const targets = args.account
      ? connected.filter((a) => a.email.toLowerCase() === String(args.account).toLowerCase())
      : connected;
    if (args.account && targets.length === 0) {
      return { ok: false, summary: `No connected Gmail account '${args.account}' in this organization.` };
    }
    if (targets.length === 0) return { ok: true, summary: "No connected Gmail accounts to search.", data: { matches: [], notAccessed: [] } };

    const limit = (args.limit as number | undefined) ?? 15;
    const matches: Record<string, unknown>[] = [];
    const notAccessed: { account: string; reason: string }[] = [];
    const nextPageTokens: Record<string, string> = {};
    for (const acct of targets) {
      try {
        const token = await getAccountAccessToken(ctx.organizationId, acct.id);
        const { messages, nextPageToken } = await gmailListMessages(token, q, limit, args.account ? (args.pageToken as string | undefined) : undefined);
        if (nextPageToken) nextPageTokens[acct.email] = nextPageToken;
        for (const ref of messages) {
          try {
            const msg = await gmailGetMessage(token, ref.id);
            matches.push({
              account: acct.email,
              gmailMessageId: ref.id,
              date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
              from: getHeader(msg, "From"),
              to: getHeader(msg, "To"),
              subject: getHeader(msg, "Subject"),
              snippet: msg.snippet ?? null,
              attachments: collectAttachments(msg).map((a) => ({ filename: a.filename, mimeType: a.mimeType })),
            });
          } catch {
            /* skip a single message that can't be fetched */
          }
        }
      } catch (e) {
        // Partial access — report it; never pretend the mailbox was fully covered.
        notAccessed.push({ account: acct.email, reason: e instanceof Error ? e.message.slice(0, 200) : "could not access" });
      }
    }
    const searched = targets.length - notAccessed.length;
    const coverage = notAccessed.length
      ? `Searched ${searched}/${targets.length} connected account(s); ${notAccessed.length} could not be accessed.`
      : `Searched all ${targets.length} connected account(s).`;
    return {
      ok: true,
      summary: `${matches.length} live Gmail match(es). ${coverage}`,
      data: { query: q, matches, notAccessed, nextPageTokens },
    };
  },
};

const backfillEmailIndex: ToolDef = {
  name: "backfill_email_index",
  description:
    "INDEX-ONLY historical backfill: ingest older Gmail messages for one connected account into the local search index so " +
    "they become searchable. It NEVER forwards, approves, sends, or creates forward tasks — old email is never re-forwarded. " +
    "Args: account (email, required), days (look-back window, default 365, max 3650), maxMessages (default 200, max 1000).",
  capability: "gmail.manage",
  kind: "read",
  jsonSchema: obj({ account: { type: "string" }, days: { type: "number" }, maxMessages: { type: "number" } }, ["account"]),
  input: z.object({
    account: z.string().min(1),
    days: z.number().int().min(1).max(3650).optional(),
    maxMessages: z.number().int().min(1).max(1000).optional(),
  }),
  async run(ctx, args) {
    const connected = (await listGmailAccounts(ctx.organizationId)).filter((a) => a.status === "connected");
    const acct = connected.find((a) => a.email.toLowerCase() === String(args.account).toLowerCase());
    if (!acct) return { ok: false, summary: `No connected Gmail account '${args.account}' in this organization.` };
    const days = (args.days as number | undefined) ?? 365;

    // RESUMABLE: each call walks OLDER through history, starting from the oldest
    // message already indexed for this account (so repeated calls make progress
    // instead of re-fetching the newest page). The boundary day is re-included
    // (before:<oldest+1d>) and the per-message unique key dedupes it, so nothing
    // is silently skipped. Bounded per call by maxMessages.
    const cursor = await iQueryOne<{ oldest: Date | string | null }>(
      "SELECT MIN(`received_at`) AS oldest FROM `email_messages` WHERE `gmail_integration_id`=?",
      [acct.id],
    );
    let beforeClause = "";
    let resuming = false;
    if (cursor?.oldest) {
      const d = new Date(cursor.oldest as string);
      if (!Number.isNaN(d.getTime())) {
        d.setUTCDate(d.getUTCDate() + 1);
        beforeClause = ` before:${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
        resuming = true;
      }
    }
    // Historical, all-mail (archived included), excluding the account's own Sent/
    // chats. backfill:true guarantees NO forward tasks / sends are created.
    const query = `-in:sent -in:chats has:attachment newer_than:${days}d${beforeClause}`;
    const summary = await syncGmailAccount(
      ctx.organizationId,
      acct.id,
      { id: ctx.user.id, email: ctx.user.email },
      { maxMessages: (args.maxMessages as number | undefined) ?? 200, backfill: true, query },
    );
    return {
      ok: true,
      summary:
        `Backfilled ${acct.email} (last ${days}d, ${resuming ? "resuming older history" : "from newest"}): ` +
        `${summary.newMessages} new message(s) indexed, ${summary.invoicesCreated} invoice(s) extracted, ` +
        `${summary.duplicates} duplicate(s). ${summary.newMessages === 0 ? "Nothing new — backfill may be complete. " : ""}No emails were forwarded.`,
      data: { ...summary, query, resuming },
    };
  },
};

export const TOOLS: ToolDef[] = [
  listConnectedAccounts,
  searchEmails,
  searchGmailMessages,
  backfillEmailIndex,
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
