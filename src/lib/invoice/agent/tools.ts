import "server-only";
import { z } from "zod";
import { iQuery } from "../db";
import type { FinanceCapability } from "../types";
import { fmtMoney } from "../format";
import { listInvoices, getInvoice } from "../services/invoices";
import { listParties } from "../services/parties";
import { listPayments } from "../services/payments";
import { listDueInvoices } from "../services/due";
import { getOverviewMetrics } from "../overview";
import { listPendingApprovals } from "../services/approvals";

/**
 * Tool registry for the AI Invoice Agent.
 *
 * The LLM can ONLY invoke these registered tools — it never sees the database
 * and never writes SQL. Every tool declares a required capability and a kind:
 *  - "read"  tools run immediately after a permission check.
 *  - "write" tools NEVER execute from the model directly; the orchestrator turns
 *            them into a human approval request (agent_approvals) and they run
 *            only after a person approves.
 * Inputs are validated with Zod before any handler runs.
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
  /** JSON Schema for the LLM tool definition. */
  jsonSchema: Record<string, unknown>;
  /** Zod schema for server-side validation. */
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

const listInvoicesTool: ToolDef = {
  name: "list_invoices",
  description:
    "List invoices with optional filters. direction: incoming (payable) or outgoing (receivable). " +
    "paymentStatus: UNPAID|PARTIALLY_PAID|PAID|OVERDUE. q: free-text search on number/PO/party.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({
    direction: { type: "string", enum: ["incoming", "outgoing"] },
    paymentStatus: { type: "string" },
    processingStatus: { type: "string" },
    q: { type: "string" },
    limit: { type: "number" },
  }),
  input: z.object({
    direction: z.enum(["incoming", "outgoing"]).optional(),
    paymentStatus: z.string().optional(),
    processingStatus: z.string().optional(),
    q: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async run(ctx, args) {
    const rows = await listInvoices(ctx.organizationId, {
      direction: args.direction as "incoming" | "outgoing" | undefined,
      paymentStatus: args.paymentStatus as string | undefined,
      processingStatus: args.processingStatus as string | undefined,
      q: args.q as string | undefined,
      limit: (args.limit as number | undefined) ?? 25,
    });
    return {
      ok: true,
      summary: `${rows.length} invoice(s).`,
      data: rows.map((r) => ({
        id: r.id,
        number: r.invoice_number,
        party: r.party_name ?? r.party_name_raw,
        direction: r.direction,
        processingStatus: r.processing_status,
        paymentStatus: r.payment_status,
        grandTotal: r.grand_total,
        balanceDue: r.balance_due,
        currency: r.currency,
        dueDate: r.due_date,
      })),
    };
  },
};

const getInvoiceTool: ToolDef = {
  name: "get_invoice",
  description: "Get one invoice with its line items by id.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ id: { type: "string" } }, ["id"]),
  input: z.object({ id: z.string().min(1) }),
  async run(ctx, args) {
    const detail = await getInvoice(ctx.organizationId, String(args.id));
    if (!detail) return { ok: false, summary: "Invoice not found." };
    return { ok: true, summary: `Invoice ${detail.invoice.invoice_number ?? detail.invoice.id}.`, data: detail };
  },
};

const findOverdueTool: ToolDef = {
  name: "find_overdue",
  description: "List overdue invoices (balance outstanding and due date in the past). Optional direction.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ direction: { type: "string", enum: ["incoming", "outgoing"] } }),
  input: z.object({ direction: z.enum(["incoming", "outgoing"]).optional() }),
  async run(ctx, args) {
    const { overdue } = await listDueInvoices(ctx.organizationId, {
      direction: args.direction as "incoming" | "outgoing" | undefined,
    });
    return {
      ok: true,
      summary: `${overdue.length} overdue invoice(s).`,
      data: overdue.map((r) => ({
        id: r.id,
        number: r.invoice_number,
        party: r.party_name,
        direction: r.direction,
        dueDate: r.due_date,
        overdueByDays: Math.abs(r.days),
        balanceDue: r.balance_due,
        currency: r.currency,
      })),
    };
  },
};

const summarizeDueTool: ToolDef = {
  name: "summarize_due",
  description: "Summarize payables and receivables due within N days (default 7), plus overdue totals.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ days: { type: "number" } }),
  input: z.object({ days: z.number().int().min(1).max(365).optional() }),
  async run(ctx, args) {
    const days = (args.days as number | undefined) ?? 7;
    const { overdue, upcoming } = await listDueInvoices(ctx.organizationId, { upcomingDays: days });
    const within = upcoming.filter((u) => u.days <= days);
    const sum = (rows: typeof within) =>
      rows.reduce((acc, r) => acc + Number(r.balance_due), 0).toFixed(2);
    return {
      ok: true,
      summary: `${within.length} due in ${days} days; ${overdue.length} overdue.`,
      data: {
        upcomingCount: within.length,
        upcomingTotal: sum(within),
        overdueCount: overdue.length,
        overdueTotal: sum(overdue),
      },
    };
  },
};

const overviewTool: ToolDef = {
  name: "overview_metrics",
  description: "Get accounts payable and receivable summary metrics (counts and totals).",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({}),
  input: z.object({}),
  async run(ctx) {
    const m = await getOverviewMetrics(ctx.organizationId);
    return { ok: true, summary: "Overview metrics.", data: m };
  },
};

const searchPartiesTool: ToolDef = {
  name: "search_parties",
  description: "Search vendors/customers by name, GSTIN or email. kind: supplier|customer.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ q: { type: "string" }, kind: { type: "string", enum: ["supplier", "customer"] } }),
  input: z.object({ q: z.string().optional(), kind: z.enum(["supplier", "customer"]).optional() }),
  async run(ctx, args) {
    const rows = await listParties(ctx.organizationId, {
      q: args.q as string | undefined,
      kind: args.kind as string | undefined,
    });
    return {
      ok: true,
      summary: `${rows.length} party(ies).`,
      data: rows.map((p) => ({
        id: p.id, name: p.business_name, kind: p.kind, gstin: p.gstin,
        payable: p.payable, receivable: p.receivable,
      })),
    };
  },
};

const listPaymentsTool: ToolDef = {
  name: "list_payments",
  description: "List recorded payments. direction: incoming (paid out) or outgoing (received).",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({ direction: { type: "string", enum: ["incoming", "outgoing"] } }),
  input: z.object({ direction: z.enum(["incoming", "outgoing"]).optional() }),
  async run(ctx, args) {
    const rows = await listPayments(ctx.organizationId, {
      direction: args.direction as "incoming" | "outgoing" | undefined,
    });
    return {
      ok: true,
      summary: `${rows.length} payment(s).`,
      data: rows.map((p) => ({ id: p.id, invoice: p.invoice_number, party: p.party_name, amount: p.amount, paidOn: p.paid_on, method: p.method })),
    };
  },
};

const findDuplicatesTool: ToolDef = {
  name: "find_duplicates",
  description: "List open suspected-duplicate invoice matches with their score and reasons.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({}),
  input: z.object({}),
  async run(ctx) {
    const rows = await iQuery<{ invoice_id: string; matched_invoice_id: string; score: string; a: string | null; b: string | null }>(
      "SELECT d.invoice_id, d.matched_invoice_id, d.score, ia.invoice_number AS a, ib.invoice_number AS b " +
        "FROM `invoice_duplicate_matches` d " +
        "LEFT JOIN `invoices` ia ON ia.id=d.invoice_id LEFT JOIN `invoices` ib ON ib.id=d.matched_invoice_id " +
        "WHERE d.organization_id=? AND d.resolution='open' ORDER BY d.score DESC LIMIT 100",
      [ctx.organizationId],
    );
    return {
      ok: true,
      summary: `${rows.length} open duplicate match(es).`,
      data: rows.map((r) => ({ invoiceId: r.invoice_id, invoice: r.a, matchedId: r.matched_invoice_id, matched: r.b, score: r.score })),
    };
  },
};

const findGstMismatchTool: ToolDef = {
  name: "find_gst_mismatches",
  description: "List invoices whose extracted totals failed the deterministic math/GST cross-check.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({}),
  input: z.object({}),
  async run(ctx) {
    const rows = await iQuery<{ id: string; invoice_number: string | null; grand_total: string; currency: string }>(
      "SELECT i.id, i.invoice_number, i.grand_total, i.currency FROM `invoices` i " +
        "JOIN `invoice_extractions` e ON e.invoice_id=i.id " +
        "WHERE i.organization_id=? AND e.math_check_passed=0 AND i.deleted_at IS NULL ORDER BY i.created_at DESC LIMIT 100",
      [ctx.organizationId],
    );
    return {
      ok: true,
      summary: `${rows.length} invoice(s) with a failed total/GST check.`,
      data: rows.map((r) => ({ id: r.id, number: r.invoice_number, grandTotal: fmtMoney(r.grand_total, r.currency) })),
    };
  },
};

const pendingApprovalsTool: ToolDef = {
  name: "list_pending_approvals",
  description: "List invoices awaiting an approval decision.",
  capability: "invoice.read",
  kind: "read",
  jsonSchema: obj({}),
  input: z.object({}),
  async run(ctx) {
    const rows = await listPendingApprovals(ctx.organizationId);
    return {
      ok: true,
      summary: `${rows.length} pending approval(s).`,
      data: rows.map((a) => ({ invoiceId: a.invoice_id, number: a.invoice_number, party: a.party_name, amount: a.grand_total, step: a.current_step })),
    };
  },
};

// --- WRITE TOOL (approval-gated; never executed directly by the model) -------

const recordPaymentTool: ToolDef = {
  name: "record_payment",
  description:
    "Record a payment against an invoice. This is a SENSITIVE write and requires explicit human approval before it is applied. " +
    "amount and paidOn (yyyy-mm-dd) are required.",
  capability: "payment.record",
  kind: "write",
  jsonSchema: obj(
    {
      invoiceId: { type: "string" },
      amount: { type: "string", description: "Decimal string, e.g. 1180.00" },
      paidOn: { type: "string", description: "yyyy-mm-dd" },
      method: { type: "string" },
      reference: { type: "string" },
    },
    ["invoiceId", "amount", "paidOn"],
  ),
  input: z.object({
    invoiceId: z.string().min(1),
    amount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: z.string().optional(),
    reference: z.string().optional(),
  }),
  // Handler is invoked ONLY after human approval (see services/agent.ts).
  async run() {
    return { ok: false, summary: "record_payment must be approved by a human before it runs." };
  },
};

export const TOOLS: ToolDef[] = [
  listInvoicesTool,
  getInvoiceTool,
  findOverdueTool,
  summarizeDueTool,
  overviewTool,
  searchPartiesTool,
  listPaymentsTool,
  findDuplicatesTool,
  findGstMismatchTool,
  pendingApprovalsTool,
  recordPaymentTool,
];

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
