import type { Metadata } from "next";
import { getInvoiceContext } from "@/lib/invoice/org";
import { listParties } from "@/lib/invoice/services/parties";
import { NotReady } from "../not-ready";
import { PartiesClient, type PartyView } from "./parties-client";

export const metadata: Metadata = { title: "Vendors & Customers" };
export const dynamic = "force-dynamic";

function addressText(v: unknown): string {
  if (v && typeof v === "object" && "text" in v) return String((v as { text?: string }).text ?? "");
  return "";
}

export default async function PartiesPage() {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Vendors & Customers" canSetup={ctx?.canSetup} />;

  const rows = await listParties(ctx.organizationId);
  const parties: PartyView[] = rows.map((p) => ({
    id: p.id,
    kind: p.kind,
    businessName: p.business_name,
    legalName: p.legal_name ?? "",
    gstin: p.gstin ?? "",
    pan: p.pan ?? "",
    email: p.email ?? "",
    phone: p.phone ?? "",
    contactPerson: p.contact_person ?? "",
    paymentTerms: p.payment_terms ?? "",
    billingAddress: addressText(p.billing_address),
    notes: p.notes ?? "",
    isActive: p.is_active,
    payable: p.payable,
    receivable: p.receivable,
    currency: p.default_currency,
    invoiceCount: Number(p.invoice_count),
  }));

  return <PartiesClient parties={parties} currency={ctx.organization?.base_currency ?? "INR"} />;
}
