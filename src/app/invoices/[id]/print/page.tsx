import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInvoiceContext } from "@/lib/invoice/org";
import { getInvoice } from "@/lib/invoice/services/invoices";
import { getParty } from "@/lib/invoice/services/parties";
import { fmtMoney, fmtDate } from "@/lib/invoice/format";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Invoice (print)" };
export const dynamic = "force-dynamic";

// Scoped print CSS: hide everything except the invoice when printing, so the
// app chrome (sidebar/topbar) never appears in the PDF, without touching the shell.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #invoice-print, #invoice-print * { visibility: visible !important; }
  #invoice-print { position: absolute; left: 0; top: 0; width: 100%; }
  [data-print-hide] { display: none !important; }
}
`;

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) notFound();
  const { id } = await params;
  const detail = await getInvoice(ctx.organizationId, id);
  if (!detail) notFound();
  const { invoice: inv, lines } = detail;
  const party = inv.party_id ? await getParty(ctx.organizationId, inv.party_id) : null;
  const curr = inv.currency;
  const org = ctx.organization;
  const billingText =
    party?.billing_address && typeof party.billing_address === "object" && "text" in party.billing_address
      ? String((party.billing_address as { text?: string }).text ?? "")
      : "";

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="mb-4 flex justify-end" data-print-hide>
        <PrintButton />
      </div>

      <div id="invoice-print" className="mx-auto max-w-3xl rounded-xl border border-border bg-white p-8 text-slate-900">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{org?.name}</h1>
            {org?.gstin && <p className="text-sm text-slate-500">GSTIN: {org.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold uppercase tracking-wide text-slate-700">
              {inv.direction === "outgoing" ? "Tax Invoice" : "Supplier Invoice"}
            </p>
            <p className="text-sm">{inv.invoice_number ?? "(no number)"}</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="font-semibold text-slate-500">{inv.direction === "outgoing" ? "Bill to" : "From"}</p>
            <p className="font-medium">{party?.business_name ?? inv.party_name ?? inv.party_name_raw ?? "—"}</p>
            {party?.gstin && <p>GSTIN: {party.gstin}</p>}
            {billingText && <p className="whitespace-pre-line text-slate-600">{billingText}</p>}
          </div>
          <div className="text-right">
            <p><span className="text-slate-500">Invoice date:</span> {fmtDate(inv.invoice_date)}</p>
            <p><span className="text-slate-500">Due date:</span> {fmtDate(inv.due_date)}</p>
            {inv.po_number && <p><span className="text-slate-500">PO:</span> {inv.po_number}</p>}
          </div>
        </div>

        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-slate-300 text-left">
              <th className="py-2">#</th>
              <th className="py-2">Description</th>
              <th className="py-2">HSN/SAC</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Rate</th>
              <th className="py-2 text-right">GST%</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-slate-200">
                <td className="py-2">{l.line_no}</td>
                <td className="py-2">{l.description}</td>
                <td className="py-2">{l.hsn_sac ?? "—"}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(l.unit_price, curr)}</td>
                <td className="py-2 text-right tabular-nums">{l.gst_rate}%</td>
                <td className="py-2 text-right tabular-nums">{fmtMoney(l.line_total, curr)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Taxable</span><span className="tabular-nums">{fmtMoney(inv.taxable_amount, curr)}</span></div>
            {inv.igst !== "0.00" ? (
              <div className="flex justify-between"><span className="text-slate-500">IGST</span><span className="tabular-nums">{fmtMoney(inv.igst, curr)}</span></div>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-slate-500">CGST</span><span className="tabular-nums">{fmtMoney(inv.cgst, curr)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">SGST</span><span className="tabular-nums">{fmtMoney(inv.sgst, curr)}</span></div>
              </>
            )}
            {inv.other_charges !== "0.00" && (
              <div className="flex justify-between"><span className="text-slate-500">Other charges</span><span className="tabular-nums">{fmtMoney(inv.other_charges, curr)}</span></div>
            )}
            {inv.round_off !== "0.00" && (
              <div className="flex justify-between"><span className="text-slate-500">Round-off</span><span className="tabular-nums">{fmtMoney(inv.round_off, curr)}</span></div>
            )}
            <div className="flex justify-between border-t-2 border-slate-300 pt-1 text-base font-bold">
              <span>Grand Total</span><span className="tabular-nums">{fmtMoney(inv.grand_total, curr)}</span>
            </div>
          </div>
        </div>

        {inv.notes && <p className="mt-6 whitespace-pre-line text-sm text-slate-600">{inv.notes}</p>}
        <p className="mt-8 text-center text-xs text-slate-400">This is a computer-generated invoice.</p>
      </div>
    </div>
  );
}
