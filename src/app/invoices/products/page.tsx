import type { Metadata } from "next";
import { getInvoiceContext } from "@/lib/invoice/org";
import { listProducts } from "@/lib/invoice/services/products";
import { NotReady } from "../not-ready";
import { ProductsClient, type ProductView } from "./products-client";

export const metadata: Metadata = { title: "Products & Services" };
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Products & Services" canSetup={ctx?.canSetup} />;

  const rows = await listProducts(ctx.organizationId);
  const products: ProductView[] = rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? "",
    sku: p.sku ?? "",
    unit: p.unit ?? "",
    defaultPrice: p.default_price,
    defaultGstRate: p.default_gst_rate,
    hsnSac: p.hsn_sac ?? "",
    isActive: p.is_active,
  }));

  return <ProductsClient products={products} currency={ctx.organization?.base_currency ?? "INR"} />;
}
