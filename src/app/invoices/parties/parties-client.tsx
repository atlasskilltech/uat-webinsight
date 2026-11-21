"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { PARTY_KINDS } from "@/lib/invoice/enums";
import { fmtMoney } from "@/lib/invoice/format";
import { savePartyAction, deactivatePartyAction } from "../actions";

export interface PartyView {
  id: string;
  kind: string;
  businessName: string;
  legalName: string;
  gstin: string;
  pan: string;
  email: string;
  phone: string;
  contactPerson: string;
  paymentTerms: string;
  billingAddress: string;
  notes: string;
  isActive: boolean;
  payable: string;
  receivable: string;
  currency: string;
  invoiceCount: number;
}

export function PartiesClient({ parties, currency }: { parties: PartyView[]; currency: string }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<PartyView | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return parties;
    return parties.filter(
      (p) =>
        p.businessName.toLowerCase().includes(t) ||
        p.gstin.toLowerCase().includes(t) ||
        p.email.toLowerCase().includes(t),
    );
  }, [parties, q]);

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(p: PartyView) {
    setEditing(p);
    setOpen(true);
  }

  function toggleActive(p: PartyView) {
    const fd = new FormData();
    fd.set("id", p.id);
    fd.set("active", (!p.isActive).toString());
    startTransition(async () => {
      const res = await deactivatePartyAction(idleState, fd);
      toast(res.message ?? "Updated.", res.status === "error" ? "error" : "success");
      if (res.status !== "error") router.refresh();
    });
  }

  return (
    <div>
      <PageHeader
        title="Vendors & Customers"
        description="Business parties — suppliers, customers, or both — with GSTIN and outstanding balances."
        actions={
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New party
          </Button>
        }
      />

      <div className="mb-4 flex max-w-md items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, GSTIN or email…" className="pl-9" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No parties yet" description="Add a supplier or customer to start recording invoices." />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>GSTIN</TH>
                <TH className="text-right">Payable</TH>
                <TH className="text-right">Receivable</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium">
                    {p.businessName}
                    {p.email && <div className="text-xs text-muted">{p.email}</div>}
                  </TD>
                  <TD>
                    <StatusBadge options={PARTY_KINDS} value={p.kind} />
                  </TD>
                  <TD className="text-muted tabular-nums">{p.gstin || "—"}</TD>
                  <TD className="text-right tabular-nums">{fmtMoney(p.payable, currency)}</TD>
                  <TD className="text-right tabular-nums">{fmtMoney(p.receivable, currency)}</TD>
                  <TD>
                    {p.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
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

      <PartyDialog
        open={open}
        onClose={() => setOpen(false)}
        editing={editing}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function PartyDialog({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: PartyView | null;
  onSaved: () => void;
}) {
  const [state, action] = useActionState(savePartyAction, idleState);
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
    <Dialog open={open} onClose={onClose} title={editing ? "Edit party" : "New party"} size="lg">
      <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <Field label="Type" htmlFor="kind">
          <Select id="kind" name="kind" defaultValue={editing?.kind ?? "supplier"}>
            <Options options={PARTY_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
          </Select>
        </Field>
        <Field label="Business name" htmlFor="businessName" required error={state.fieldErrors?.businessName}>
          <Input id="businessName" name="businessName" defaultValue={editing?.businessName} required />
        </Field>
        <Field label="Legal name" htmlFor="legalName">
          <Input id="legalName" name="legalName" defaultValue={editing?.legalName} />
        </Field>
        <Field label="GSTIN" htmlFor="gstin" error={state.fieldErrors?.gstin}>
          <Input id="gstin" name="gstin" defaultValue={editing?.gstin} maxLength={15} />
        </Field>
        <Field label="PAN" htmlFor="pan" error={state.fieldErrors?.pan}>
          <Input id="pan" name="pan" defaultValue={editing?.pan} maxLength={10} />
        </Field>
        <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
          <Input id="email" name="email" type="email" defaultValue={editing?.email} />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" defaultValue={editing?.phone} />
        </Field>
        <Field label="Contact person" htmlFor="contactPerson">
          <Input id="contactPerson" name="contactPerson" defaultValue={editing?.contactPerson} />
        </Field>
        <Field label="Payment terms" htmlFor="paymentTerms" hint="e.g. Net 30">
          <Input id="paymentTerms" name="paymentTerms" defaultValue={editing?.paymentTerms} />
        </Field>
        <Field label="Billing address" htmlFor="billingAddress" className="sm:col-span-2">
          <Textarea id="billingAddress" name="billingAddress" defaultValue={editing?.billingAddress} />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={editing?.notes} />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton>{editing ? "Save changes" : "Create party"}</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}
