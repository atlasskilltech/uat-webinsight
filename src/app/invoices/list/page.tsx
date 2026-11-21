import type { Metadata } from "next";
import { getInvoiceContext } from "@/lib/invoice/org";
import { InvoiceListView } from "../invoice-list-view";
import { NotReady } from "../not-ready";

export const metadata: Metadata = { title: "All Invoices" };
export const dynamic = "force-dynamic";

export default async function AllInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="All Invoices" canSetup={ctx?.canSetup} />;
  const sp = await searchParams;
  return (
    <InvoiceListView
      organizationId={ctx.organizationId}
      title="All Invoices"
      description="Every incoming (payable) and outgoing (receivable) invoice."
      q={sp.q}
      view={sp.view === "needs-review" ? "needs-review" : undefined}
      basePath="/invoices/list"
    />
  );
}
