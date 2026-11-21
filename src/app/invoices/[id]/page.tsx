import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getInvoiceContext } from "@/lib/invoice/org";
import { hasCapability } from "@/lib/invoice/permissions";
import { getInvoice } from "@/lib/invoice/services/invoices";
import { listInvoicePayments } from "@/lib/invoice/services/payments";
import { getApprovalForInvoice } from "@/lib/invoice/services/approvals";
import { fmtMoney, fmtDate } from "@/lib/invoice/format";
import { PAYMENT_STATUS_OPTIONS, APPROVAL_STATUS_OPTIONS, processingOptions } from "@/lib/invoice/enums";
import { NotReady } from "../not-ready";
import { InvoiceActions } from "./invoice-actions";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-border pt-2 text-base font-semibold" : "text-sm"}`}>
      <span className={strong ? "" : "text-muted"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Invoice" canSetup={ctx?.canSetup} />;
  const { id } = await params;

  const detail = await getInvoice(ctx.organizationId, id);
  if (!detail) notFound();
  const { invoice: inv, lines } = detail;

  const [payments, approvalData, canPay, canApprove, canEdit] = await Promise.all([
    listInvoicePayments(ctx.organizationId, id),
    getApprovalForInvoice(ctx.organizationId, id),
    hasCapability("payment.record"),
    hasCapability("invoice.approve"),
    hasCapability("invoice.edit"),
  ]);

  const pendingApproval =
    approvalData && approvalData.approval.status === "pending" ? approvalData.approval : null;
  const curr = inv.currency;

  return (
    <div>
      <PageHeader
        title={inv.invoice_number ?? "(no number)"}
        description={`${inv.direction === "incoming" ? "Supplier invoice — payable" : "Customer invoice — receivable"} · ${inv.party_name ?? inv.party_name_raw ?? "—"}`}
        actions={
          inv.direction === "outgoing" ? (
            <Link href={`/invoices/${inv.id}/print`} target="_blank">
              <Button variant="secondary">
                <Printer className="h-4 w-4" /> Print / PDF
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusBadge options={processingOptions(inv.direction)} value={inv.processing_status} />
        <StatusBadge options={PAYMENT_STATUS_OPTIONS} value={inv.payment_status} />
        {approvalData && (
          <Badge tone="neutral">
            Approval: <StatusBadge options={APPROVAL_STATUS_OPTIONS} value={approvalData.approval.status} />
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Description</TH>
                  <TH>HSN/SAC</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">GST%</TH>
                  <TH className="text-right">Taxable</TH>
                  <TH className="text-right">Total</TH>
                </TR>
              </THead>
              <TBody>
                {lines.map((l) => (
                  <TR key={l.id}>
                    <TD>{l.line_no}</TD>
                    <TD>{l.description}</TD>
                    <TD className="text-muted">{l.hsn_sac ?? "—"}</TD>
                    <TD className="text-right tabular-nums">{l.quantity}</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(l.unit_price, curr)}</TD>
                    <TD className="text-right tabular-nums">{l.gst_rate}%</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(l.taxable_value, curr)}</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(l.line_total, curr)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <p className="text-sm text-muted">No payments recorded yet.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Date</TH>
                      <TH>Method</TH>
                      <TH>Reference</TH>
                      <TH className="text-right">Amount</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {payments.map((p) => (
                      <TR key={p.id}>
                        <TD>{fmtDate(p.paid_on)}</TD>
                        <TD className="capitalize">{p.method ?? "—"}</TD>
                        <TD className="text-muted">{p.txn_reference ?? "—"}</TD>
                        <TD className="text-right tabular-nums">{fmtMoney(p.amount, curr)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Row label="Invoice date" value={fmtDate(inv.invoice_date)} />
              <Row label="Due date" value={fmtDate(inv.due_date)} />
              <div className="my-2 border-t border-border" />
              <Row label="Subtotal" value={fmtMoney(inv.subtotal, curr)} />
              <Row label="Discount" value={fmtMoney(inv.discount_total, curr)} />
              <Row label="Taxable" value={fmtMoney(inv.taxable_amount, curr)} />
              {inv.igst !== "0.00" ? (
                <Row label="IGST" value={fmtMoney(inv.igst, curr)} />
              ) : (
                <>
                  <Row label="CGST" value={fmtMoney(inv.cgst, curr)} />
                  <Row label="SGST" value={fmtMoney(inv.sgst, curr)} />
                </>
              )}
              {inv.other_charges !== "0.00" && <Row label="Other charges" value={fmtMoney(inv.other_charges, curr)} />}
              {inv.round_off !== "0.00" && <Row label="Round-off" value={fmtMoney(inv.round_off, curr)} />}
              <Row label="Grand total" value={fmtMoney(inv.grand_total, curr)} strong />
              <Row label="Amount paid" value={fmtMoney(inv.amount_paid, curr)} />
              <Row label="Balance due" value={fmtMoney(inv.balance_due, curr)} strong />
            </CardContent>
          </Card>

          <InvoiceActions
            invoiceId={inv.id}
            direction={inv.direction}
            currency={curr}
            balanceDue={inv.balance_due}
            paymentStatus={inv.payment_status}
            processingStatus={inv.processing_status}
            pendingApprovalId={pendingApproval?.id ?? null}
            caps={{ payment: canPay, approve: canApprove, startApproval: canEdit }}
          />
        </div>
      </div>
    </div>
  );
}
