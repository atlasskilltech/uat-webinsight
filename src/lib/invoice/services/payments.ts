import "server-only";
import { iQuery, iTransaction } from "../db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { toCents, fromCents } from "../money";
import type { PaymentInput } from "../validation";
import type { InvoiceRow } from "./invoices";

export interface PaymentListRow {
  id: string;
  organization_id: string;
  direction: string;
  amount: string;
  currency: string;
  paid_on: Date | string;
  method: string | null;
  txn_reference: string | null;
  notes: string | null;
  created_at: Date;
  invoice_id: string | null;
  invoice_number: string | null;
  party_name: string | null;
}

/**
 * Record a payment against ONE invoice and allocate it, atomically. Recomputes
 * amount_paid / balance_due / payment_status deterministically (DECIMAL, no JS
 * float). Rejects over-payment. A payment is a trusted human/reconciliation
 * record — never set from an email claim.
 */
export async function recordPayment(
  organizationId: string,
  actor: { id: string; email: string },
  input: PaymentInput,
): Promise<string> {
  const paymentId = createId();
  await iTransaction(async (conn) => {
    const [rows] = await conn.query(
      "SELECT * FROM `invoices` WHERE organization_id=? AND id=? AND deleted_at IS NULL FOR UPDATE",
      [organizationId, input.invoiceId],
    );
    const invoice = (rows as InvoiceRow[])[0];
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.payment_status === "CANCELLED") throw new Error("Invoice is cancelled.");

    const amount = toCents(input.amount);
    if (amount <= 0n) throw new Error("Payment amount must be positive.");
    const balance = toCents(invoice.balance_due);
    if (amount > balance) {
      throw new Error(`Payment exceeds the outstanding balance (${invoice.balance_due}).`);
    }

    await conn.query(
      "INSERT INTO `invoice_payments` " +
        "(`id`,`organization_id`,`direction`,`amount`,`currency`,`paid_on`,`method`,`txn_reference`,`bank_reference`,`notes`,`recorded_by`) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [
        paymentId,
        organizationId,
        invoice.direction,
        input.amount,
        invoice.currency,
        input.paidOn,
        input.method ?? null,
        input.txnReference ?? null,
        input.bankReference ?? null,
        input.notes ?? null,
        actor.id,
      ],
    );
    await conn.query(
      "INSERT INTO `invoice_payment_allocations` (`id`,`organization_id`,`payment_id`,`invoice_id`,`amount`) VALUES (?,?,?,?,?)",
      [createId(), organizationId, paymentId, invoice.id, input.amount],
    );

    const newPaid = toCents(invoice.amount_paid) + amount;
    const grand = toCents(invoice.grand_total);
    const newBalance = grand - newPaid;
    const paymentStatus = newBalance <= 0n ? "PAID" : newPaid > 0n ? "PARTIALLY_PAID" : "UNPAID";

    // Keep processing_status consistent for paid states.
    let processing = invoice.processing_status;
    if (paymentStatus === "PAID") processing = "PAID";
    else if (paymentStatus === "PARTIALLY_PAID" && invoice.direction === "outgoing" && processing !== "PARTIALLY_PAID")
      processing = "PARTIALLY_PAID";

    await conn.query(
      "UPDATE `invoices` SET `amount_paid`=?, `balance_due`=?, `payment_status`=?, `processing_status`=? WHERE id=?",
      [fromCents(newPaid), fromCents(newBalance), paymentStatus, processing, invoice.id],
    );

    await logInvoiceAudit(
      {
        organizationId,
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "payment.recorded",
        entityType: "invoice",
        entityId: invoice.id,
        before: { amountPaid: invoice.amount_paid, balanceDue: invoice.balance_due, paymentStatus: invoice.payment_status },
        after: { amountPaid: fromCents(newPaid), balanceDue: fromCents(newBalance), paymentStatus },
        metadata: { paymentId, amount: input.amount, method: input.method },
      },
      conn,
    );
  });
  return paymentId;
}

export async function listPayments(
  organizationId: string,
  opts: { direction?: "incoming" | "outgoing"; limit?: number } = {},
): Promise<PaymentListRow[]> {
  const where: string[] = ["pay.organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (opts.direction) {
    where.push("pay.direction = ?");
    params.push(opts.direction);
  }
  params.push(opts.limit ?? 200);
  return iQuery<PaymentListRow>(
    "SELECT pay.*, i.invoice_number, p.business_name AS party_name FROM `invoice_payments` pay " +
      "LEFT JOIN `invoice_payment_allocations` a ON a.payment_id = pay.id " +
      "LEFT JOIN `invoices` i ON i.id = a.invoice_id " +
      "LEFT JOIN `invoice_parties` p ON p.id = i.party_id " +
      `WHERE ${where.join(" AND ")} ORDER BY pay.paid_on DESC, pay.created_at DESC LIMIT ?`,
    params,
  );
}

export async function listInvoicePayments(
  organizationId: string,
  invoiceId: string,
): Promise<PaymentListRow[]> {
  return iQuery<PaymentListRow>(
    "SELECT pay.*, i.invoice_number, p.business_name AS party_name FROM `invoice_payments` pay " +
      "JOIN `invoice_payment_allocations` a ON a.payment_id = pay.id " +
      "LEFT JOIN `invoices` i ON i.id = a.invoice_id " +
      "LEFT JOIN `invoice_parties` p ON p.id = i.party_id " +
      "WHERE pay.organization_id=? AND a.invoice_id=? ORDER BY pay.paid_on DESC",
    [organizationId, invoiceId],
  );
}
