import type { Metadata } from "next";
import { getInvoiceContext } from "@/lib/invoice/org";
import { requireCapability } from "@/lib/invoice/permissions";
import { isAuthError } from "@/lib/auth/guard";
import { listParties } from "@/lib/invoice/services/parties";
import { listProducts } from "@/lib/invoice/services/products";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NotReady } from "../not-ready";
import { InvoiceForm, type PartyOption, type ProductOption } from "./invoice-form";

export const metadata: Metadata = { title: "New Invoice" };
export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ dir?: string }>;
}) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="New Invoice" canSetup={ctx?.canSetup} />;

  // Enforce create capability up-front with a friendly message.
  try {
    await requireCapability("invoice.create");
  } catch (e) {
    return (
      <div>
        <PageHeader title="New Invoice" />
        <EmptyState
          title="You can't create invoices"
          description={isAuthError(e) ? e.message : "Your finance role does not allow creating invoices."}
        />
      </div>
    );
  }

  const sp = await searchParams;
  const direction = sp.dir === "outgoing" ? "outgoing" : sp.dir === "incoming" ? "incoming" : "incoming";

  const [parties, products] = await Promise.all([
    listParties(ctx.organizationId, { activeOnly: true }),
    listProducts(ctx.organizationId, { activeOnly: true }),
  ]);

  const partyOptions: PartyOption[] = parties.map((p) => ({
    id: p.id,
    name: p.business_name,
    kind: p.kind,
  }));
  const productOptions: ProductOption[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    unitPrice: p.default_price,
    gstRate: p.default_gst_rate,
    hsnSac: p.hsn_sac ?? "",
    unit: p.unit ?? "",
  }));

  return (
    <InvoiceForm
      direction={direction}
      currency={ctx.organization?.base_currency ?? "INR"}
      parties={partyOptions}
      products={productOptions}
    />
  );
}
