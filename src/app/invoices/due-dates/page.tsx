import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { getInvoiceContext } from "@/lib/invoice/org";
import { listDueInvoices, type DueInvoiceRow } from "@/lib/invoice/services/due";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtMoney, fmtDate } from "@/lib/invoice/format";
import { NotReady } from "../not-ready";

export const metadata: Metadata = { title: "Due Dates" };
export const dynamic = "force-dynamic";

function DueTable({ rows, overdue }: { rows: DueInvoiceRow[]; overdue: boolean }) {
  if (rows.length === 0) {
    return <p className="px-5 py-4 text-sm text-muted">Nothing here.</p>;
  }
  return (
    <Table>
      <THead>
        <TR>
          <TH>Invoice</TH>
          <TH>Type</TH>
          <TH>Party</TH>
          <TH>Due</TH>
          <TH>{overdue ? "Overdue by" : "Due in"}</TH>
          <TH className="text-right">Balance</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="font-medium">
              <Link href={`/invoices/${r.id}`} className="hover:underline">{r.invoice_number ?? "(no number)"}</Link>
            </TD>
            <TD>
              <Badge tone={r.direction === "incoming" ? "info" : "accent"}>
                {r.direction === "incoming" ? "Payable" : "Receivable"}
              </Badge>
            </TD>
            <TD>{r.party_name ?? "—"}</TD>
            <TD className="text-muted">{fmtDate(r.due_date)}</TD>
            <TD className={overdue ? "text-danger" : "text-muted"}>
              {Math.abs(r.days)} day{Math.abs(r.days) === 1 ? "" : "s"}
            </TD>
            <TD className="text-right tabular-nums">{fmtMoney(r.balance_due, r.currency)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export default async function DueDatesPage() {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Due Dates" canSetup={ctx?.canSetup} />;

  const { overdue, upcoming } = await listDueInvoices(ctx.organizationId);

  return (
    <div>
      <PageHeader
        title="Due Dates"
        description="Outstanding payables and receivables by due date. Overdue is computed live from the due date, independent of the reminder worker."
      />
      {overdue.length === 0 && upcoming.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing due" description="Invoices with an outstanding balance and a due date show up here." />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-danger" /> Overdue ({overdue.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DueTable rows={overdue} overdue />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-accent" /> Upcoming (next 30 days) ({upcoming.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DueTable rows={upcoming} overdue={false} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
