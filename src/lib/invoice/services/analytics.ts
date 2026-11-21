import "server-only";
import { iQuery } from "../db";

/**
 * Dashboard analytics. Numbers here are for CHART DISPLAY only (converted to JS
 * numbers); the authoritative ledger stays in DECIMAL. Covers the last 6 months.
 */
export interface MonthlyPoint {
  month: string;
  payable: number;
  receivable: number;
  paidOut: number;
  received: number;
}
export interface TopParty {
  name: string;
  total: number;
}
export interface DashboardAnalytics {
  monthly: MonthlyPoint[];
  topVendors: TopParty[];
  topCustomers: TopParty[];
}

export async function getDashboardAnalytics(organizationId: string): Promise<DashboardAnalytics> {
  const [inv, pay, vendors, customers] = await Promise.all([
    iQuery<{ m: string; direction: string; total: string }>(
      "SELECT DATE_FORMAT(invoice_date,'%Y-%m') AS m, direction, SUM(grand_total) AS total FROM `invoices` " +
        "WHERE organization_id=? AND deleted_at IS NULL AND invoice_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) " +
        "GROUP BY m, direction",
      [organizationId],
    ),
    iQuery<{ m: string; direction: string; total: string }>(
      "SELECT DATE_FORMAT(paid_on,'%Y-%m') AS m, direction, SUM(amount) AS total FROM `invoice_payments` " +
        "WHERE organization_id=? AND paid_on >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) GROUP BY m, direction",
      [organizationId],
    ),
    iQuery<{ name: string; total: string }>(
      "SELECT COALESCE(p.business_name,i.party_name_raw,'Unknown') AS name, SUM(i.grand_total) AS total FROM `invoices` i " +
        "LEFT JOIN `invoice_parties` p ON p.id=i.party_id WHERE i.organization_id=? AND i.direction='incoming' AND i.deleted_at IS NULL " +
        "GROUP BY name ORDER BY total DESC LIMIT 5",
      [organizationId],
    ),
    iQuery<{ name: string; total: string }>(
      "SELECT COALESCE(p.business_name,i.party_name_raw,'Unknown') AS name, SUM(i.grand_total) AS total FROM `invoices` i " +
        "LEFT JOIN `invoice_parties` p ON p.id=i.party_id WHERE i.organization_id=? AND i.direction='outgoing' AND i.deleted_at IS NULL " +
        "GROUP BY name ORDER BY total DESC LIMIT 5",
      [organizationId],
    ),
  ]);

  // Build the last 6 month buckets.
  const buckets: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push(d.toISOString().slice(0, 7));
  }
  const map = new Map<string, MonthlyPoint>(
    buckets.map((m) => [m, { month: m, payable: 0, receivable: 0, paidOut: 0, received: 0 }]),
  );
  for (const r of inv) {
    const p = map.get(r.m);
    if (!p) continue;
    if (r.direction === "incoming") p.payable = Number(r.total);
    else p.receivable = Number(r.total);
  }
  for (const r of pay) {
    const p = map.get(r.m);
    if (!p) continue;
    if (r.direction === "incoming") p.paidOut = Number(r.total);
    else p.received = Number(r.total);
  }

  return {
    monthly: [...map.values()],
    topVendors: vendors.map((v) => ({ name: v.name, total: Number(v.total) })),
    topCustomers: customers.map((v) => ({ name: v.name, total: Number(v.total) })),
  };
}
