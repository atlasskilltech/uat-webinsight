import Link from "next/link";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Receipt } from "lucide-react";
import { fmtMoney, fmtDate } from "@/lib/invoice/format";
import { PAYMENT_STATUS_OPTIONS, processingOptions } from "@/lib/invoice/enums";
import type { InvoiceListRow } from "@/lib/invoice/services/invoices";

export function InvoiceTable({
  rows,
  showDirection = false,
  emptyLabel = "No invoices yet",
}: {
  rows: InvoiceListRow[];
  showDirection?: boolean;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title={emptyLabel}
        description="Create an invoice or process one from an uploaded document / email to see it here."
      />
    );
  }
  return (
    <div className="rounded-xl border border-border bg-surface">
      <Table>
        <THead>
          <TR>
            <TH>Number</TH>
            {showDirection && <TH>Type</TH>}
            <TH>Party</TH>
            <TH>Date</TH>
            <TH>Due</TH>
            <TH>Status</TH>
            <TH>Payment</TH>
            <TH className="text-right">Total</TH>
            <TH className="text-right">Balance</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id} className="cursor-pointer">
              <TD className="font-medium">
                <Link href={`/invoices/${r.id}`} className="hover:underline">
                  {r.invoice_number ?? "(no number)"}
                </Link>
              </TD>
              {showDirection && (
                <TD className="capitalize text-muted">{r.direction === "incoming" ? "Payable" : "Receivable"}</TD>
              )}
              <TD>{r.party_name ?? r.party_name_raw ?? "—"}</TD>
              <TD className="text-muted">{fmtDate(r.invoice_date)}</TD>
              <TD className="text-muted">{fmtDate(r.due_date)}</TD>
              <TD>
                <StatusBadge options={processingOptions(r.direction)} value={r.processing_status} />
              </TD>
              <TD>
                <StatusBadge options={PAYMENT_STATUS_OPTIONS} value={r.payment_status} />
              </TD>
              <TD className="text-right tabular-nums">{fmtMoney(r.grand_total, r.currency)}</TD>
              <TD className="text-right tabular-nums">{fmtMoney(r.balance_due, r.currency)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
