"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { computeInvoiceTotals } from "@/lib/invoice/money";
import { fmtMoney, toDateInput } from "@/lib/invoice/format";
import { createInvoiceAction } from "../actions";

export interface PartyOption {
  id: string;
  name: string;
  kind: string;
}
export interface ProductOption {
  id: string;
  name: string;
  unitPrice: string;
  gstRate: string;
  hsnSac: string;
  unit: string;
}

interface Line {
  productServiceId: string;
  description: string;
  hsnSac: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  gstRate: string;
}

const emptyLine: Line = {
  productServiceId: "",
  description: "",
  hsnSac: "",
  quantity: "1",
  unit: "",
  unitPrice: "0.00",
  discount: "0.00",
  gstRate: "18",
};

const CURRENCIES = [
  { value: "INR", label: "INR ₹" },
  { value: "USD", label: "USD $" },
  { value: "EUR", label: "EUR €" },
  { value: "GBP", label: "GBP £" },
];

function safe(n: string): string {
  return /^\d{1,13}(\.\d{1,3})?$/.test(n.trim()) ? n.trim() : "0";
}

export function InvoiceForm({
  direction: initialDirection,
  currency: initialCurrency,
  parties,
  products,
}: {
  direction: "incoming" | "outgoing";
  currency: string;
  parties: PartyOption[];
  products: ProductOption[];
}) {
  const [direction, setDirection] = useState<"incoming" | "outgoing">(initialDirection);
  const [currency, setCurrency] = useState(initialCurrency);
  const [interState, setInterState] = useState(false);
  const [roundTotal, setRoundTotal] = useState(false);
  const [otherCharges, setOtherCharges] = useState("0.00");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [state, action] = useActionState(createInvoiceAction, idleState);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (state.status === "success" && state.id) {
      toast("Invoice created.", "success");
      router.push(`/invoices/${state.id}`);
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

  // Client-side preview using the SAME deterministic engine the server uses.
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
        roundTotal,
      });
    } catch {
      return null;
    }
  }, [lines, interState, otherCharges, roundTotal]);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function pickProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) {
      updateLine(i, { productServiceId: "" });
      return;
    }
    updateLine(i, {
      productServiceId: p.id,
      description: p.name,
      unitPrice: p.unitPrice,
      gstRate: p.gstRate,
      hsnSac: p.hsnSac,
      unit: p.unit,
    });
  }

  return (
    <div>
      <PageHeader
        title="New Invoice"
        description="Totals are recalculated deterministically on the server when you save — the preview here uses the same engine."
      />

      <form action={action} className="space-y-6">
        <input type="hidden" name="direction" value={direction} />
        <input type="hidden" name="currency" value={currency} />
        <input type="hidden" name="interState" value={interState ? "true" : "false"} />
        <input type="hidden" name="roundTotal" value={roundTotal ? "true" : "false"} />
        <input type="hidden" name="otherCharges" value={otherCharges} />
        <input type="hidden" name="linesJson" value={JSON.stringify(lines)} />

        <Segmented
          value={direction}
          onChange={(v) => setDirection(v)}
          options={[
            { value: "incoming", label: "Incoming (Payable)", icon: <ArrowDownToLine className="h-4 w-4" /> },
            { value: "outgoing", label: "Outgoing (Receivable)", icon: <ArrowUpFromLine className="h-4 w-4" /> },
          ]}
        />

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={direction === "incoming" ? "Supplier" : "Customer"} htmlFor="partyId">
              <Select
                id="partyId"
                name="partyId"
                defaultValue=""
              >
                <option value="">— Select —</option>
                {relevantParties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Or party name (if not listed)" htmlFor="partyNameRaw">
              <Input id="partyNameRaw" name="partyNameRaw" placeholder="Free text" />
            </Field>
            <Field label="Currency" htmlFor="currencySel">
              <Select id="currencySel" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <Options options={CURRENCIES} />
              </Select>
            </Field>
            <Field
              label="Invoice number"
              htmlFor="invoiceNumber"
              hint={direction === "outgoing" ? "Leave blank to auto-number" : "As printed on the supplier invoice"}
              error={state.fieldErrors?.invoiceNumber}
            >
              <Input id="invoiceNumber" name="invoiceNumber" />
            </Field>
            <Field label="PO number" htmlFor="poNumber">
              <Input id="poNumber" name="poNumber" />
            </Field>
            <Field label="Payment terms" htmlFor="paymentTerms">
              <Input id="paymentTerms" name="paymentTerms" placeholder="Net 30" />
            </Field>
            <Field label="Invoice date" htmlFor="invoiceDate" error={state.fieldErrors?.invoiceDate}>
              <Input id="invoiceDate" name="invoiceDate" type="date" defaultValue={toDateInput(new Date())} />
            </Field>
            <Field label="Due date" htmlFor="dueDate" error={state.fieldErrors?.dueDate}>
              <Input id="dueDate" name="dueDate" type="date" />
            </Field>
            <Field label="Tax type" htmlFor="interStateSel" hint="Inter-state uses IGST; intra-state uses CGST+SGST">
              <Select id="interStateSel" value={interState ? "true" : "false"} onChange={(e) => setInterState(e.target.value === "true")}>
                <option value="false">Intra-state (CGST + SGST)</option>
                <option value="true">Inter-state (IGST)</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Line items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-12">
                {products.length > 0 && (
                  <div className="col-span-2 sm:col-span-3">
                    <label className="mb-1.5 block text-xs font-medium text-muted">Product</label>
                    <Select value={l.productServiceId} onChange={(e) => pickProduct(i, e.target.value)}>
                      <option value="">— Custom —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className={products.length > 0 ? "col-span-2 sm:col-span-3" : "col-span-2 sm:col-span-4"}>
                  <label className="mb-1.5 block text-xs font-medium text-muted">Description</label>
                  <Input value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} />
                </div>
                <div className="sm:col-span-1">
                  <label className="mb-1.5 block text-xs font-medium text-muted">HSN/SAC</label>
                  <Input value={l.hsnSac} onChange={(e) => updateLine(i, { hsnSac: e.target.value })} />
                </div>
                <div className="sm:col-span-1">
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
                <div className="sm:col-span-1">
                  <label className="mb-1.5 block text-xs font-medium text-muted">GST %</label>
                  <Input value={l.gstRate} inputMode="decimal" onChange={(e) => updateLine(i, { gstRate: e.target.value })} />
                </div>
                <div className="flex justify-end sm:col-span-12">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))}
                    disabled={lines.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setLines((p) => [...p, { ...emptyLine }])}>
              <Plus className="h-4 w-4" /> Add line
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Adjustments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Other charges" htmlFor="otherChargesInput">
                <Input id="otherChargesInput" value={otherCharges} inputMode="decimal" onChange={(e) => setOtherCharges(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={roundTotal} onChange={(e) => setRoundTotal(e.target.checked)} />
                Round grand total to the nearest {currency === "INR" ? "rupee" : "unit"}
              </label>
              <Field label="Notes" htmlFor="notes">
                <Textarea id="notes" name="notes" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Totals (preview)</CardTitle>
            </CardHeader>
            <CardContent>
              {totals ? (
                <dl className="space-y-1.5 text-sm">
                  <Row label="Subtotal" value={fmtMoney(totals.subtotal, currency)} />
                  <Row label="Discount" value={fmtMoney(totals.discountTotal, currency)} />
                  <Row label="Taxable" value={fmtMoney(totals.taxableAmount, currency)} />
                  {!interState && <Row label="CGST" value={fmtMoney(totals.cgst, currency)} />}
                  {!interState && <Row label="SGST" value={fmtMoney(totals.sgst, currency)} />}
                  {interState && <Row label="IGST" value={fmtMoney(totals.igst, currency)} />}
                  <Row label="Other charges" value={fmtMoney(totals.otherCharges, currency)} />
                  {totals.roundOff !== "0.00" && <Row label="Round-off" value={fmtMoney(totals.roundOff, currency)} />}
                  <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-semibold">
                    <span>Grand total</span>
                    <span className="tabular-nums">{fmtMoney(totals.grandTotal, currency)}</span>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-danger">Check the numeric fields — totals cannot be computed.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
          <SubmitButton pendingLabel="Creating…">Create invoice</SubmitButton>
        </div>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
