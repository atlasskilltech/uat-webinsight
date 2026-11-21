import type { Metadata } from "next";
import { getInvoiceContext } from "@/lib/invoice/org";
import { InvoiceListView } from "../invoice-list-view";
import { NotReady } from "../not-ready";

export const metadata: Metadata = { title: "Outgoing Invoices" };
export const dynamic = "force-dynamic";

export default async function OutgoingInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Outgoing Invoices" canSetup={ctx?.canSetup} />;
  const sp = await searchParams;
  return (
    <InvoiceListView
      organizationId={ctx.organizationId}
      direction="outgoing"
      title="Outgoing Invoices"
      description="Customer invoices — accounts receivable (AR)."
      q={sp.q}
      basePath="/invoices/outgoing"
    />
  );
}
