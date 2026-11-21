"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { fmtMoney } from "@/lib/invoice/format";
import { saveProductAction, deactivateProductAction } from "../actions";

export interface ProductView {
  id: string;
  name: string;
  description: string;
  sku: string;
  unit: string;
  defaultPrice: string;
  defaultGstRate: string;
  hsnSac: string;
  isActive: boolean;
}

export function ProductsClient({ products, currency }: { products: ProductView[]; currency: string }) {
  const [editing, setEditing] = useState<ProductView | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function toggleActive(p: ProductView) {
    const fd = new FormData();
    fd.set("id", p.id);
    fd.set("active", (!p.isActive).toString());
    startTransition(async () => {
      const res = await deactivateProductAction(idleState, fd);
      toast(res.message ?? "Updated.", res.status === "error" ? "error" : "success");
      if (res.status !== "error") router.refresh();
    });
  }

  return (
    <div>
      <PageHeader
        title="Products & Services"
        description="Catalogue used when preparing outgoing invoices. Invoice lines snapshot the price/tax so later edits never change past invoices."
        actions={
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4" /> New item
          </Button>
        }
      />

      {products.length === 0 ? (
        <EmptyState title="No products or services yet" description="Add an item to reuse it on customer invoices." />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>SKU</TH>
                <TH>HSN/SAC</TH>
                <TH className="text-right">Default price</TH>
                <TH className="text-right">GST %</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {products.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium">{p.name}</TD>
                  <TD className="text-muted">{p.sku || "—"}</TD>
                  <TD className="text-muted tabular-nums">{p.hsnSac || "—"}</TD>
                  <TD className="text-right tabular-nums">{fmtMoney(p.defaultPrice, currency)}</TD>
                  <TD className="text-right tabular-nums">{p.defaultGstRate}%</TD>
                  <TD>{p.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(p); setOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggleActive(p)}>
                        {p.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <ProductDialog open={open} onClose={() => setOpen(false)} editing={editing} onSaved={() => { setOpen(false); router.refresh(); }} />
    </div>
  );
}

function ProductDialog({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: ProductView | null;
  onSaved: () => void;
}) {
  const [state, action] = useActionState(saveProductAction, idleState);
  const toast = useToast();
  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Saved.", "success");
      onSaved();
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit item" : "New item"} size="lg">
      <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <Field label="Name" htmlFor="name" required className="sm:col-span-2" error={state.fieldErrors?.name}>
          <Input id="name" name="name" defaultValue={editing?.name} required />
        </Field>
        <Field label="SKU" htmlFor="sku">
          <Input id="sku" name="sku" defaultValue={editing?.sku} />
        </Field>
        <Field label="HSN/SAC" htmlFor="hsnSac">
          <Input id="hsnSac" name="hsnSac" defaultValue={editing?.hsnSac} />
        </Field>
        <Field label="Unit" htmlFor="unit" hint="e.g. pcs, hrs">
          <Input id="unit" name="unit" defaultValue={editing?.unit} />
        </Field>
        <Field label="Default price" htmlFor="defaultPrice" required error={state.fieldErrors?.defaultPrice}>
          <Input id="defaultPrice" name="defaultPrice" defaultValue={editing?.defaultPrice ?? "0.00"} inputMode="decimal" required />
        </Field>
        <Field label="Default GST %" htmlFor="defaultGstRate" required error={state.fieldErrors?.defaultGstRate}>
          <Input id="defaultGstRate" name="defaultGstRate" defaultValue={editing?.defaultGstRate ?? "18"} inputMode="decimal" required />
        </Field>
        <Field label="Description" htmlFor="description" className="sm:col-span-2">
          <Textarea id="description" name="description" defaultValue={editing?.description} />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <SubmitButton>{editing ? "Save changes" : "Create item"}</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}
