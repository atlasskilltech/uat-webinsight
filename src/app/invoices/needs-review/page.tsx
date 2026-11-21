import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Copy } from "lucide-react";
import { getInvoiceContext } from "@/lib/invoice/org";
import { listNeedsReview } from "@/lib/invoice/services/invoices";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { fmtMoney, fmtDate } from "@/lib/invoice/format";
import { NotReady } from "../not-ready";

export const metadata: Metadata = { title: "Needs Review" };
export const dynamic = "force-dynamic";

export default async function NeedsReviewPage() {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Needs Review" canSetup={ctx?.canSetup} />;

  const rows = await listNeedsReview(ctx.organizationId);

  return (
    <div>
      <PageHeader
        title="Needs Review"
        description="Invoices with low extraction confidence, failed total checks, unmatched vendors, or suspected duplicates. Nothing here is auto-approved."
      />
      {rows.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="Nothing to review" description="Processed documents that need a human check appear here." />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Vendor</TH>
                <TH>Reason</TH>
                <TH>Confidence</TH>
                <TH>Date</TH>
                <TH className="text-right">Total</TH>
                <TH className="text-right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const conf = r.overall_confidence != null ? `${Math.round(Number(r.overall_confidence))}%` : "—";
                const isDup = r.processing_status === "DUPLICATE" || Number(r.duplicate_count) > 0;
                return (
                  <TR key={r.id}>
                    <TD className="font-medium">{r.invoice_number ?? "(no number)"}</TD>
                    <TD>{r.party_name ?? r.party_name_raw ?? "—"}</TD>
                    <TD>
                      {isDup ? (
                        <Badge tone="danger"><Copy className="mr-1 h-3 w-3" /> Possible duplicate</Badge>
                      ) : (
                        <Badge tone="warning">Needs review</Badge>
                      )}
                    </TD>
                    <TD className="tabular-nums">{conf}</TD>
                    <TD className="text-muted">{fmtDate(r.invoice_date)}</TD>
                    <TD className="text-right tabular-nums">{fmtMoney(r.grand_total, r.currency)}</TD>
                    <TD className="text-right">
                      <Link href={`/invoices/${r.id}/review`}>
                        <Button size="sm">Review</Button>
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
