import type { Metadata } from "next";
import Link from "next/link";
import { getInvoiceContext } from "@/lib/invoice/org";
import { listPayments } from "@/lib/invoice/services/payments";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { fmtMoney, fmtDate } from "@/lib/invoice/format";
import { NotReady } from "../not-ready";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Payments" canSetup={ctx?.canSetup} />;

  const payments = await listPayments(ctx.organizationId);

  return (
    <div>
      <PageHeader
        title="Payments"
        description="All recorded payments and collections. Payments are trusted human/reconciliation records — never set automatically from an email claim."
      />
      {payments.length === 0 ? (
        <EmptyState title="No payments recorded yet" description="Record a payment from an invoice to see it here." />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Direction</TH>
                <TH>Invoice</TH>
                <TH>Party</TH>
                <TH>Method</TH>
                <TH>Reference</TH>
                <TH className="text-right">Amount</TH>
              </TR>
            </THead>
            <TBody>
              {payments.map((p) => (
                <TR key={p.id}>
                  <TD>{fmtDate(p.paid_on)}</TD>
                  <TD>
                    <Badge tone={p.direction === "incoming" ? "info" : "accent"}>
                      {p.direction === "incoming" ? "Paid out" : "Received"}
                    </Badge>
                  </TD>
                  <TD className="font-medium">
                    {p.invoice_id ? (
                      <Link href={`/invoices/${p.invoice_id}`} className="hover:underline">
                        {p.invoice_number ?? "—"}
                      </Link>
                    ) : (
                      p.invoice_number ?? "—"
                    )}
                  </TD>
                  <TD>{p.party_name ?? "—"}</TD>
                  <TD className="capitalize">{p.method ?? "—"}</TD>
                  <TD className="text-muted">{p.txn_reference ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{fmtMoney(p.amount, p.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
