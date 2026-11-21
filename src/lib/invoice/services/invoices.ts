import "server-only";
import { iQuery, iQueryOne, iTransaction } from "../db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { computeInvoiceTotals, computeLine } from "../money";
import { currentFinancialYear } from "../format";
import { allocateInvoiceNumber } from "./sequences";
import type { InvoiceHeaderInput, LineItemInput } from "../validation";

export interface InvoiceRow {
  id: string;
  organization_id: string;
  direction: "incoming" | "outgoing";
  party_id: string | null;
  party_name_raw: string | null;
  invoice_number: string | null;
  po_number: string | null;
  invoice_date: Date | string | null;
  due_date: Date | string | null;
  currency: string;
  payment_terms: string | null;
  subtotal: string;
  discount_total: string;
  taxable_amount: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax_total: string;
  other_charges: string;
  round_off: string;
  grand_total: string;
  amount_paid: string;
  balance_due: string;
  processing_status: string;
  payment_status: string;
  source: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceListRow extends InvoiceRow {
  party_name: string | null;
}

export interface LineItemRow {
  id: string;
  invoice_id: string;
  line_no: number;
  description: string | null;
  hsn_sac: string | null;
  quantity: string;
  unit: string | null;
  unit_price: string;
  discount: string;
  taxable_value: string;
  gst_rate: string;
  cgst: string;
  sgst: string;
  igst: string;
  line_total: string;
}

export interface InvoiceDetail {
  invoice: InvoiceRow & { party_name: string | null };
  lines: LineItemRow[];
}

const DEFAULT_PROCESSING: Record<"incoming" | "outgoing", string> = {
  incoming: "RECEIVED",
  outgoing: "DRAFT",
};

export interface CreateInvoiceInput {
  header: InvoiceHeaderInput;
  lines: LineItemInput[];
  partyNameRaw?: string | null;
}

/** Create an invoice with deterministic server-computed totals, in one transaction. */
export async function createInvoice(
  organizationId: string,
  actor: { id: string; email: string },
  input: CreateInvoiceInput,
): Promise<string> {
  const { header, lines } = input;
  const interState = header.interState === "true";

  const engineLines = lines.map((l) => ({
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discount ?? "0",
    gstRate: l.gstRate,
    interState,
  }));
  const totals = computeInvoiceTotals({
    lines: engineLines,
    otherCharges: header.otherCharges ?? "0",
    roundTotal: header.roundTotal === "true",
  });

  const id = createId();
  await iTransaction(async (conn) => {
    let invoiceNumber = header.invoiceNumber ?? null;
    // Auto-number outgoing invoices that have no number yet.
    if (!invoiceNumber && header.direction === "outgoing") {
      invoiceNumber = await allocateInvoiceNumber(conn, organizationId, {
        direction: "outgoing",
        financialYear: currentFinancialYear(),
      });
    }

    await conn.query(
      "INSERT INTO `invoices` " +
        "(`id`,`organization_id`,`direction`,`party_id`,`party_name_raw`,`invoice_number`,`po_number`," +
        "`invoice_date`,`due_date`,`currency`,`payment_terms`,`subtotal`,`discount_total`,`taxable_amount`," +
        "`cgst`,`sgst`,`igst`,`tax_total`,`other_charges`,`round_off`,`grand_total`,`amount_paid`,`balance_due`," +
        "`processing_status`,`payment_status`,`source`,`notes`,`created_by`) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        organizationId,
        header.direction,
        header.partyId ?? null,
        input.partyNameRaw ?? null,
        invoiceNumber,
        header.poNumber ?? null,
        header.invoiceDate ?? null,
        header.dueDate ?? null,
        header.currency,
        header.paymentTerms ?? null,
        totals.subtotal,
        totals.discountTotal,
        totals.taxableAmount,
        totals.cgst,
        totals.sgst,
        totals.igst,
        totals.taxTotal,
        totals.otherCharges,
        totals.roundOff,
        totals.grandTotal,
        "0.00",
        totals.grandTotal, // balance_due = grand_total initially
        DEFAULT_PROCESSING[header.direction],
        "UNPAID",
        "manual",
        header.notes ?? null,
        actor.id,
      ],
    );

    let lineNo = 1;
    for (const l of lines) {
      const c = computeLine({
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount ?? "0",
        gstRate: l.gstRate,
        interState,
      });
      await conn.query(
        "INSERT INTO `invoice_line_items` " +
          "(`id`,`invoice_id`,`organization_id`,`line_no`,`product_service_id`,`description`,`hsn_sac`," +
          "`quantity`,`unit`,`unit_price`,`discount`,`taxable_value`,`gst_rate`,`cgst`,`sgst`,`igst`,`line_total`) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          createId(),
          id,
          organizationId,
          lineNo++,
          l.productServiceId || null,
          l.description,
          l.hsnSac ?? null,
          l.quantity,
          l.unit ?? null,
          l.unitPrice,
          l.discount ?? "0.00",
          c.taxableValue,
          l.gstRate,
          c.cgst,
          c.sgst,
          c.igst,
          c.lineTotal,
        ],
      );
    }

    await logInvoiceAudit(
      {
        organizationId,
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "invoice.created",
        entityType: "invoice",
        entityId: id,
        after: {
          direction: header.direction,
          invoiceNumber,
          grandTotal: totals.grandTotal,
          currency: header.currency,
        },
      },
      conn,
    );
  });

  return id;
}

export interface ListInvoicesOpts {
  direction?: "incoming" | "outgoing";
  q?: string;
  processingStatus?: string;
  paymentStatus?: string;
  view?: "needs-review";
  limit?: number;
}

export async function listInvoices(
  organizationId: string,
  opts: ListInvoicesOpts = {},
): Promise<InvoiceListRow[]> {
  const where: string[] = ["i.organization_id = ?", "i.deleted_at IS NULL"];
  const params: unknown[] = [organizationId];
  if (opts.direction) {
    where.push("i.direction = ?");
    params.push(opts.direction);
  }
  if (opts.processingStatus) {
    where.push("i.processing_status = ?");
    params.push(opts.processingStatus);
  }
  if (opts.paymentStatus) {
    where.push("i.payment_status = ?");
    params.push(opts.paymentStatus);
  }
  if (opts.view === "needs-review") {
    where.push("i.processing_status = 'NEEDS_REVIEW'");
  }
  if (opts.q) {
    where.push("(i.invoice_number LIKE ? OR i.po_number LIKE ? OR p.business_name LIKE ? OR i.party_name_raw LIKE ?)");
    const like = `%${opts.q}%`;
    params.push(like, like, like, like);
  }
  params.push(opts.limit ?? 200);
  return iQuery<InvoiceListRow>(
    "SELECT i.*, p.business_name AS party_name FROM `invoices` i " +
      "LEFT JOIN `invoice_parties` p ON p.id = i.party_id " +
      `WHERE ${where.join(" AND ")} ORDER BY i.created_at DESC LIMIT ?`,
    params,
  );
}

export async function getInvoice(organizationId: string, id: string): Promise<InvoiceDetail | null> {
  const invoice = await iQueryOne<InvoiceRow & { party_name: string | null }>(
    "SELECT i.*, p.business_name AS party_name FROM `invoices` i " +
      "LEFT JOIN `invoice_parties` p ON p.id = i.party_id " +
      "WHERE i.organization_id=? AND i.id=? AND i.deleted_at IS NULL",
    [organizationId, id],
  );
  if (!invoice) return null;
  const lines = await iQuery<LineItemRow>(
    "SELECT * FROM `invoice_line_items` WHERE invoice_id=? ORDER BY line_no ASC",
    [id],
  );
  return { invoice, lines };
}

/** Count invoices for dashboard-style callers. */
export async function countInvoices(organizationId: string, direction?: "incoming" | "outgoing"): Promise<number> {
  const row = await iQueryOne<{ c: number }>(
    "SELECT COUNT(*) c FROM `invoices` WHERE organization_id=? AND deleted_at IS NULL" +
      (direction ? " AND direction=?" : ""),
    direction ? [organizationId, direction] : [organizationId],
  );
  return Number(row?.c ?? 0);
}
