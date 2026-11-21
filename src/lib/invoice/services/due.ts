import "server-only";
import { iQuery } from "../db";

export interface DueInvoiceRow {
  id: string;
  direction: "incoming" | "outgoing";
  invoice_number: string | null;
  due_date: Date | string | null;
  grand_total: string;
  balance_due: string;
  currency: string;
  payment_status: string;
  party_name: string | null;
  days: number; // negative = overdue by N days, positive = due in N days
}

/**
 * Invoices with an outstanding balance and a due date, split into overdue and
 * upcoming. Overdue is computed dynamically (due_date < today) rather than
 * relying on a status flag, so it is always accurate even before the reminder
 * worker runs.
 */
export async function listDueInvoices(
  organizationId: string,
  opts: { direction?: "incoming" | "outgoing"; upcomingDays?: number } = {},
): Promise<{ overdue: DueInvoiceRow[]; upcoming: DueInvoiceRow[] }> {
  const upcomingDays = opts.upcomingDays ?? 30;
  const params: unknown[] = [organizationId];
  let dirClause = "";
  if (opts.direction) {
    dirClause = " AND i.direction = ?";
    params.push(opts.direction);
  }
  params.push(upcomingDays);

  const rows = await iQuery<DueInvoiceRow>(
    "SELECT i.id, i.direction, i.invoice_number, i.due_date, i.grand_total, i.balance_due, i.currency, " +
      "i.payment_status, p.business_name AS party_name, DATEDIFF(i.due_date, CURDATE()) AS days " +
      "FROM `invoices` i LEFT JOIN `invoice_parties` p ON p.id = i.party_id " +
      "WHERE i.organization_id=? AND i.deleted_at IS NULL AND i.due_date IS NOT NULL " +
      "AND i.payment_status IN ('UNPAID','PARTIALLY_PAID','OVERDUE')" +
      dirClause +
      " AND i.due_date < DATE_ADD(CURDATE(), INTERVAL ? DAY) ORDER BY i.due_date ASC LIMIT 500",
    params,
  );
  const overdue = rows.filter((r) => r.days < 0);
  const upcoming = rows.filter((r) => r.days >= 0);
  return { overdue, upcoming };
}
