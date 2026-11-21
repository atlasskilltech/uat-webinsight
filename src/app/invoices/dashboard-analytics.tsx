"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SimpleBarChart, type Series } from "@/components/charts/charts";

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

const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

export function InvoiceAnalytics({
  monthly,
  topVendors,
  topCustomers,
  currency,
}: {
  monthly: MonthlyPoint[];
  topVendors: TopParty[];
  topCustomers: TopParty[];
  currency: string;
}) {
  const sym = SYMBOL[currency] ?? "";
  const money = (v: number) => `${sym}${Math.round(v).toLocaleString()}`;

  const createdSeries: Series[] = [
    { key: "payable", label: "Payable", color: "var(--accent)", format: money },
    { key: "receivable", label: "Receivable", color: "#16a34a", format: money },
  ];
  const paidSeries: Series[] = [
    { key: "paidOut", label: "Paid out", color: "#d97706", format: money },
    { key: "received", label: "Received", color: "#2563eb", format: money },
  ];

  const maxVendor = Math.max(1, ...topVendors.map((v) => v.total));
  const maxCustomer = Math.max(1, ...topCustomers.map((v) => v.total));

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Invoiced per month (6 mo)</CardTitle></CardHeader>
        <CardContent>
          <SimpleBarChart data={monthly} xKey="month" series={createdSeries} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Payments per month (6 mo)</CardTitle></CardHeader>
        <CardContent>
          <SimpleBarChart data={monthly} xKey="month" series={paidSeries} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Top vendors (by billed)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {topVendors.length === 0 ? (
            <p className="text-sm text-muted">No vendor data yet.</p>
          ) : (
            topVendors.map((v) => (
              <div key={v.name}>
                <div className="flex justify-between text-sm"><span className="truncate">{v.name}</span><span className="tabular-nums text-muted">{money(v.total)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${(v.total / maxVendor) * 100}%` }} /></div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Top customers (by billed)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {topCustomers.length === 0 ? (
            <p className="text-sm text-muted">No customer data yet.</p>
          ) : (
            topCustomers.map((v) => (
              <div key={v.name}>
                <div className="flex justify-between text-sm"><span className="truncate">{v.name}</span><span className="tabular-nums text-muted">{money(v.total)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full" style={{ width: `${(v.total / maxCustomer) * 100}%`, background: "#16a34a" }} /></div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
