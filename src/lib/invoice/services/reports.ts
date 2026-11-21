import "server-only";
import { iQuery } from "../db";

export interface ReportResult {
  title: string;
  headers: string[];
  rows: (string | number)[][];
  totalsRow?: (string | number)[];
}

export type ReportType = "payables" | "receivables" | "overdue" | "gst" | "monthly";

export const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "payables", label: "Payables (AP)" },
  { value: "receivables", label: "Receivables (AR)" },
  { value: "overdue", label: "Overdue" },
  { value: "gst", label: "GST summary" },
  { value: "monthly", label: "Monthly summary" },
];

interface Params {
  from?: string;
  to?: string;
  status?: string;
}

function dateFilter(col: string, params: Params, bind: unknown[]): string {
  let clause = "";
  if (params.from) {
    clause += ` AND ${col} >= ?`;
    bind.push(params.from);
  }
  if (params.to) {
    clause += ` AND ${col} <= ?`;
    bind.push(params.to);
  }
  return clause;
}

async function invoiceList(organizationId: string, direction: "incoming" | "outgoing", params: Params, title: string): Promise<ReportResult> {
  const bind: unknown[] = [organizationId, direction];
  let where = "i.organization_id=? AND i.direction=? AND i.deleted_at IS NULL";
  where += dateFilter("i.invoice_date", params, bind);
  if (params.status) {
    where += " AND i.payment_status=?";
    bind.push(params.status);
  }
  const rows = await iQuery<Record<string, string>>(
    "SELECT i.invoice_number, COALESCE(p.business_name, i.party_name_raw) AS party, i.invoice_date, i.due_date, " +
      "i.grand_total, i.amount_paid, i.balance_due, i.payment_status, i.currency " +
      `FROM \`invoices\` i LEFT JOIN \`invoice_parties\` p ON p.id=i.party_id WHERE ${where} ORDER BY i.invoice_date DESC LIMIT 5000`,
    bind,
  );
  const data = rows.map((r) => [
    r.invoice_number ?? "", r.party ?? "", String(r.invoice_date ?? "").slice(0, 10), String(r.due_date ?? "").slice(0, 10),
    r.currency, r.grand_total, r.amount_paid, r.balance_due, r.payment_status,
  ]);
  const totalGrand = rows.reduce((a, r) => a + Number(r.grand_total), 0).toFixed(2);
  const totalBalance = rows.reduce((a, r) => a + Number(r.balance_due), 0).toFixed(2);
  return {
    title,
    headers: ["Number", "Party", "Invoice date", "Due date", "Currency", "Grand total", "Paid", "Balance", "Payment status"],
    rows: data,
    totalsRow: ["", "", "", "", "TOTAL", totalGrand, "", totalBalance, ""],
  };
}

async function overdueReport(organizationId: string): Promise<ReportResult> {
  const rows = await iQuery<Record<string, string>>(
    "SELECT i.invoice_number, i.direction, COALESCE(p.business_name,i.party_name_raw) AS party, i.due_date, i.balance_due, i.currency, " +
      "DATEDIFF(CURDATE(), i.due_date) AS overdue_days FROM `invoices` i LEFT JOIN `invoice_parties` p ON p.id=i.party_id " +
      "WHERE i.organization_id=? AND i.deleted_at IS NULL AND i.balance_due>0 AND i.payment_status IN ('UNPAID','PARTIALLY_PAID','OVERDUE') " +
      "AND i.due_date IS NOT NULL AND i.due_date < CURDATE() ORDER BY i.due_date ASC LIMIT 5000",
    [organizationId],
  );
  const data = rows.map((r) => [
    r.invoice_number ?? "", r.direction === "incoming" ? "Payable" : "Receivable", r.party ?? "",
    String(r.due_date ?? "").slice(0, 10), r.overdue_days, r.currency, r.balance_due,
  ]);
  const total = rows.reduce((a, r) => a + Number(r.balance_due), 0).toFixed(2);
  return {
    title: "Overdue invoices",
    headers: ["Number", "Type", "Party", "Due date", "Overdue days", "Currency", "Balance"],
    rows: data,
    totalsRow: ["", "", "", "", "", "TOTAL", total],
  };
}

async function gstSummary(organizationId: string, params: Params): Promise<ReportResult> {
  const bind: unknown[] = [organizationId];
  let where = "organization_id=? AND deleted_at IS NULL";
  where += dateFilter("invoice_date", params, bind);
  const rows = await iQuery<Record<string, string>>(
    "SELECT direction, COUNT(*) AS cnt, SUM(taxable_amount) AS taxable, SUM(cgst) AS cgst, SUM(sgst) AS sgst, " +
      `SUM(igst) AS igst, SUM(tax_total) AS tax_total, SUM(grand_total) AS grand FROM \`invoices\` WHERE ${where} GROUP BY direction`,
    bind,
  );
  const data = rows.map((r) => [
    r.direction === "incoming" ? "Payable (input)" : "Receivable (output)", r.cnt,
    r.taxable ?? "0.00", r.cgst ?? "0.00", r.sgst ?? "0.00", r.igst ?? "0.00", r.tax_total ?? "0.00", r.grand ?? "0.00",
  ]);
  return {
    title: "GST summary",
    headers: ["Direction", "Invoices", "Taxable", "CGST", "SGST", "IGST", "Tax total", "Grand total"],
    rows: data,
  };
}

async function monthlySummary(organizationId: string, params: Params): Promise<ReportResult> {
  const year = params.from?.slice(0, 4) || String(new Date().getUTCFullYear());
  const inv = await iQuery<{ m: string; direction: string; total: string }>(
    "SELECT DATE_FORMAT(invoice_date,'%Y-%m') AS m, direction, SUM(grand_total) AS total FROM `invoices` " +
      "WHERE organization_id=? AND deleted_at IS NULL AND YEAR(invoice_date)=? GROUP BY m, direction ORDER BY m",
    [organizationId, year],
  );
  const pay = await iQuery<{ m: string; direction: string; total: string }>(
    "SELECT DATE_FORMAT(paid_on,'%Y-%m') AS m, direction, SUM(amount) AS total FROM `invoice_payments` " +
      "WHERE organization_id=? AND YEAR(paid_on)=? GROUP BY m, direction ORDER BY m",
    [organizationId, year],
  );
  const months = new Map<string, { payable: number; receivable: number; paidAp: number; paidAr: number }>();
  const get = (m: string) => months.get(m) ?? { payable: 0, receivable: 0, paidAp: 0, paidAr: 0 };
  for (const r of inv) {
    const o = get(r.m);
    if (r.direction === "incoming") o.payable = Number(r.total);
    else o.receivable = Number(r.total);
    months.set(r.m, o);
  }
  for (const r of pay) {
    const o = get(r.m);
    if (r.direction === "incoming") o.paidAp = Number(r.total);
    else o.paidAr = Number(r.total);
    months.set(r.m, o);
  }
  const data = [...months.entries()].sort().map(([m, o]) => [
    m, o.payable.toFixed(2), o.receivable.toFixed(2), o.paidAp.toFixed(2), o.paidAr.toFixed(2),
  ]);
  return {
    title: `Monthly summary ${year}`,
    headers: ["Month", "Payable created", "Receivable created", "Paid out", "Received"],
    rows: data,
  };
}

export async function getReport(organizationId: string, type: ReportType, params: Params): Promise<ReportResult> {
  switch (type) {
    case "payables":
      return invoiceList(organizationId, "incoming", params, "Payables (accounts payable)");
    case "receivables":
      return invoiceList(organizationId, "outgoing", params, "Receivables (accounts receivable)");
    case "overdue":
      return overdueReport(organizationId);
    case "gst":
      return gstSummary(organizationId, params);
    case "monthly":
      return monthlySummary(organizationId, params);
    default:
      return invoiceList(organizationId, "incoming", params, "Payables");
  }
}
