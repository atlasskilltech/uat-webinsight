import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInvoiceContext } from "@/lib/invoice/org";
import { requireCapability } from "@/lib/invoice/permissions";
import { isAuthError } from "@/lib/auth/guard";
import { getInvoice } from "@/lib/invoice/services/invoices";
import { listParties } from "@/lib/invoice/services/parties";
import { iQuery, iQueryOne } from "@/lib/invoice/db";
import { getStorage } from "@/lib/invoice/storage";
import { toDateInput } from "@/lib/invoice/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NotReady } from "../../not-ready";
import { ReviewClient, type ReviewLine } from "./review-client";
import type { PartyOption } from "../../new/invoice-form";

export const metadata: Metadata = { title: "Review Invoice" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Review Invoice" canSetup={ctx?.canSetup} />;
  try {
    await requireCapability("invoice.edit");
  } catch (e) {
    return (
      <div>
        <PageHeader title="Review Invoice" />
        <EmptyState title="You can't edit invoices" description={isAuthError(e) ? e.message : "Insufficient permissions."} />
      </div>
    );
  }

  const { id } = await params;
  const detail = await getInvoice(ctx.organizationId, id);
  if (!detail) notFound();
  const { invoice: inv, lines } = detail;

  const [partiesRaw, extraction, attachment, dupes] = await Promise.all([
    listParties(ctx.organizationId, { activeOnly: true }),
    iQueryOne<{ overall_confidence: string | null; field_confidence: unknown; raw_text: string | null }>(
      "SELECT overall_confidence, field_confidence, raw_text FROM `invoice_extractions` WHERE invoice_id=? ORDER BY created_at DESC LIMIT 1",
      [id],
    ),
    iQueryOne<{ storage_key: string; storage_provider: string; filename: string }>(
      "SELECT storage_key, storage_provider, filename FROM `invoice_attachments` WHERE invoice_id=? AND role='primary' ORDER BY created_at ASC LIMIT 1",
      [id],
    ),
    iQuery<{ matched_invoice_id: string; score: string; invoice_number: string | null }>(
      "SELECT d.matched_invoice_id, d.score, i.invoice_number FROM `invoice_duplicate_matches` d " +
        "LEFT JOIN `invoices` i ON i.id=d.matched_invoice_id WHERE d.invoice_id=? AND d.resolution='open' ORDER BY d.score DESC",
      [id],
    ),
  ]);

  const parties: PartyOption[] = partiesRaw.map((p) => ({ id: p.id, name: p.business_name, kind: p.kind }));
  const reviewLines: ReviewLine[] =
    lines.length > 0
      ? lines.map((l) => ({
          description: l.description ?? "",
          hsnSac: l.hsn_sac ?? "",
          quantity: l.quantity,
          unit: l.unit ?? "",
          unitPrice: l.unit_price,
          discount: l.discount,
          gstRate: l.gst_rate,
        }))
      : [{ description: "", hsnSac: "", quantity: "1", unit: "", unitPrice: "0.00", discount: "0.00", gstRate: "18" }];

  const documentUrl = attachment ? await getStorage().signedUrl(attachment.storage_key, 600) : null;

  return (
    <ReviewClient
      invoiceId={inv.id}
      direction={inv.direction}
      header={{
        partyId: inv.party_id ?? "",
        partyNameRaw: inv.party_name_raw ?? "",
        invoiceNumber: inv.invoice_number ?? "",
        poNumber: inv.po_number ?? "",
        invoiceDate: toDateInput(inv.invoice_date),
        dueDate: toDateInput(inv.due_date),
        currency: inv.currency,
        interState: inv.igst !== "0.00",
        otherCharges: inv.other_charges,
        notes: inv.notes ?? "",
      }}
      lines={reviewLines}
      parties={parties}
      confidence={extraction?.overall_confidence != null ? Math.round(Number(extraction.overall_confidence)) : null}
      rawTextSnippet={(extraction?.raw_text ?? "").slice(0, 4000)}
      documentUrl={documentUrl}
      duplicates={dupes.map((d) => ({ id: d.matched_invoice_id, number: d.invoice_number, score: Math.round(Number(d.score)) }))}
    />
  );
}
