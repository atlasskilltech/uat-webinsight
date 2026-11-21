import type { Metadata } from "next";
import { getInvoiceContext } from "@/lib/invoice/org";
import { InvoiceListView } from "../invoice-list-view";
import { NotReady } from "../not-ready";

export const metadata: Metadata = { title: "Incoming Invoices" };
export const dynamic = "force-dynamic";

export default async function IncomingInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Incoming Invoices" canSetup={ctx?.canSetup} />;
  const sp = await searchParams;
  return (
    <InvoiceListView
      organizationId={ctx.organizationId}
      direction="incoming"
      title="Incoming Invoices"
      description="Supplier invoices — accounts payable (AP)."
      q={sp.q}
      basePath="/invoices/incoming"
    />
  );
}
