"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, FileText, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { computeInvoiceTotals } from "@/lib/invoice/money";
import { fmtMoney } from "@/lib/invoice/format";
import { reviewInvoiceAction } from "../../processing/actions";
import type { PartyOption } from "../../new/invoice-form";

export interface ReviewLine {
  description: string;
  hsnSac: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  gstRate: string;
}
interface Header {
  partyId: string;
  partyNameRaw: string;
  invoiceNumber: string;
  poNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  interState: boolean;
  otherCharges: string;
  notes: string;
}

const CURRENCIES = [
  { value: "INR", label: "INR ₹" },
  { value: "USD", label: "USD $" },
  { value: "EUR", label: "EUR €" },
  { value: "GBP", label: "GBP £" },
];

function safe(n: string): string {
  return /^\d{1,13}(\.\d{1,3})?$/.test((n ?? "").trim()) ? n.trim() : "0";
}

export function ReviewClient({
  invoiceId,
  direction,
  header,
  lines: initialLines,
  parties,
  confidence,
  rawTextSnippet,
  documentUrl,
  duplicates,
}: {
  invoiceId: string;
  direction: "incoming" | "outgoing";
  header: Header;
  lines: ReviewLine[];
  parties: PartyOption[];
  confidence: number | null;
  rawTextSnippet: string;
  documentUrl: string | null;
  duplicates: { id: string; number: string | null; score: number }[];
}) {
  const [lines, setLines] = useState<ReviewLine[]>(initialLines);
  const [currency, setCurrency] = useState(header.currency);
  const [interState, setInterState] = useState(header.interState);
  const [otherCharges, setOtherCharges] = useState(header.otherCharges);
  const [state, action] = useActionState(reviewInvoiceAction, idleState);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Saved.", "success");
      router.push(`/invoices/${invoiceId}`);
    } else if (state.status === "error" && state.message) {
      toast(state.message, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const relevantParties = useMemo(
    () =>
      parties.filter((p) =>
        direction === "incoming" ? p.kind === "supplier" || p.kind === "both" : p.kind === "customer" || p.kind === "both",
      ),
    [parties, direction],
  );

  const totals = useMemo(() => {
    try {
      return computeInvoiceTotals({
        lines: lines.map((l) => ({
          quantity: safe(l.quantity),
          unitPrice: safe(l.unitPrice),
          discount: safe(l.discount),
          gstRate: safe(l.gstRate),
          interState,
        })),
        otherCharges: safe(otherCharges),
        roundTotal: false,
      });
    } catch {
      return null;
    }
  }, [lines, interState, otherCharges]);

  function updateLine(i: number, patch: Partial<ReviewLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  return (
    <div>
      <PageHeader
        title="Review & correct"
        description="Verify the extracted data against the original document, fix anything wrong, then accept. Totals are recomputed on save."
        actions={
          documentUrl ? (
            <Link href={documentUrl} target="_blank">
              <Button variant="secondary"><FileText className="h-4 w-4" /> Open original</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={confidence == null ? "neutral" : confidence >= 75 ? "success" : "warning"}>
          Extraction confidence: {confidence == null ? "n/a" : `${confidence}%`}
        </Badge>
        {duplicates.length > 0 && (
          <Badge tone="danger">
            <AlertTriangle className="mr-1 h-3.5 w-3.5" />
            {duplicates.length} possible duplicate{duplicates.length > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {duplicates.length > 0 && (
        <div className="mb-6 rounded-lg border border-danger/30 bg-danger-soft/40 px-4 py-3 text-sm">
          <p className="font-medium text-danger">Possible duplicates found:</p>
          <ul className="mt-1 list-inside list-disc">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/invoices/${d.id}`} className="underline">{d.number ?? d.id}</Link> — {d.score}% match
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={action} className="space-y-6">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="direction" value={direction} />
        <input type="hidden" name="currency" value={currency} />
        <input type="hidden" name="interState" value={interState ? "true" : "false"} />
        <input type="hidden" name="otherCharges" value={otherCharges} />
        <input type="hidden" name="linesJson" value={JSON.stringify(lines)} />

        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={direction === "incoming" ? "Supplier" : "Customer"} htmlFor="partyId">
              <Select id="partyId" name="partyId" defaultValue={header.partyId}>
                <option value="">— {header.partyNameRaw || "Select"} —</option>
                {relevantParties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Invoice number" htmlFor="invoiceNumber" error={state.fieldErrors?.invoiceNumber}>
              <Input id="invoiceNumber" name="invoiceNumber" defaultValue={header.invoiceNumber} />
            </Field>
            <Field label="PO number" htmlFor="poNumber">
              <Input id="poNumber" name="poNumber" defaultValue={header.poNumber} />
            </Field>
            <Field label="Invoice date" htmlFor="invoiceDate" error={state.fieldErrors?.invoiceDate}>
              <Input id="invoiceDate" name="invoiceDate" type="date" defaultValue={header.invoiceDate} />
            </Field>
            <Field label="Due date" htmlFor="dueDate" error={state.fieldErrors?.dueDate}>
              <Input id="dueDate" name="dueDate" type="date" defaultValue={header.dueDate} />
            </Field>
            <Field label="Currency" htmlFor="currencySel">
              <Select id="currencySel" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <Options options={CURRENCIES} />
              </Select>
            </Field>
            <Field label="Tax type" htmlFor="interStateSel">
              <Select id="interStateSel" value={interState ? "true" : "false"} onChange={(e) => setInterState(e.target.value === "true")}>
                <option value="false">Intra-state (CGST + SGST)</option>
                <option value="true">Inter-state (IGST)</option>
              </Select>
            </Field>
            <Field label="Other charges" htmlFor="otherChargesInput">
              <Input id="otherChargesInput" value={otherCharges} inputMode="decimal" onChange={(e) => setOtherCharges(e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-12">
                <div className="col-span-2 sm:col-span-4">
                  <label className="mb-1.5 block text-xs font-medium text-muted">Description</label>
                  <Input value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                </div>
                <div className="sm:col-span-1">
                  <label className="mb-1.5 block text-xs font-medium text-muted">HSN</label>
                  <Input value={l.hsnSac} onChange={(e) => updateLine(i, { hsnSac: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-medium text-muted">Qty</label>
                  <Input value={l.quantity} inputMode="decimal" onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-medium text-muted">Unit price</label>
                  <Input value={l.unitPrice} inputMode="decimal" onChange={(e) => updateLine(i, { unitPrice: e.target.value })} />
                </div>
                <div className="sm:col-span-1">
                  <label className="mb-1.5 block text-xs font-medium text-muted">Disc.</label>
                  <Input value={l.discount} inputMode="decimal" onChange={(e) => updateLine(i, { discount: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-medium text-muted">GST %</label>
                  <Input value={l.gstRate} inputMode="decimal" onChange={(e) => updateLine(i, { gstRate: e.target.value })} />
                </div>
                <div className="flex justify-end sm:col-span-12">
                  <Button type="button" variant="ghost" size="sm" disabled={lines.length === 1}
                    onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setLines((p) => [...p, { description: "", hsnSac: "", quantity: "1", unit: "", unitPrice: "0.00", discount: "0.00", gstRate: "18" }])}>
              <Plus className="h-4 w-4" /> Add line
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Extracted text (reference)</CardTitle></CardHeader>
            <CardContent>
              {rawTextSnippet ? (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-muted">{rawTextSnippet}</pre>
              ) : (
                <p className="text-sm text-muted">No extracted text (scanned document without OCR, or none available).</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Totals (recomputed on save)</CardTitle></CardHeader>
            <CardContent>
              {totals ? (
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-muted">Taxable</dt><dd className="tabular-nums">{fmtMoney(totals.taxableAmount, currency)}</dd></div>
                  {interState
                    ? <div className="flex justify-between"><dt className="text-muted">IGST</dt><dd className="tabular-nums">{fmtMoney(totals.igst, currency)}</dd></div>
                    : <>
                        <div className="flex justify-between"><dt className="text-muted">CGST</dt><dd className="tabular-nums">{fmtMoney(totals.cgst, currency)}</dd></div>
                        <div className="flex justify-between"><dt className="text-muted">SGST</dt><dd className="tabular-nums">{fmtMoney(totals.sgst, currency)}</dd></div>
                      </>}
                  <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold">
                    <span>Grand total</span><span className="tabular-nums">{fmtMoney(totals.grandTotal, currency)}</span>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-danger">Check the numeric fields.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Field label="Notes" htmlFor="notes">
          <Textarea id="notes" name="notes" defaultValue={header.notes} />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.push(`/invoices/${invoiceId}`)}>Cancel</Button>
          <SubmitButton pendingLabel="Saving…">Accept & save</SubmitButton>
        </div>
      </form>
    </div>
  );
}
