"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea, Options } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { PAYMENT_METHODS } from "@/lib/invoice/enums";
import { toDateInput } from "@/lib/invoice/format";
import { recordPaymentAction, startApprovalAction, decideApprovalAction } from "../actions";

export function InvoiceActions({
  invoiceId,
  direction,
  balanceDue,
  paymentStatus,
  processingStatus,
  pendingApprovalId,
  caps,
}: {
  invoiceId: string;
  direction: "incoming" | "outgoing";
  currency: string;
  balanceDue: string;
  paymentStatus: string;
  processingStatus: string;
  pendingApprovalId: string | null;
  caps: { payment: boolean; approve: boolean; startApproval: boolean };
}) {
  const router = useRouter();
  const toast = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const outstanding = Number(balanceDue) > 0 && paymentStatus !== "CANCELLED";
  const canStartApproval =
    caps.startApproval &&
    direction === "incoming" &&
    !pendingApprovalId &&
    !["APPROVED", "PAID", "REJECTED", "ARCHIVED"].includes(processingStatus);

  function run(action: (p: typeof idleState, fd: FormData) => Promise<typeof idleState>, fd: FormData, okMsg: string) {
    startTransition(async () => {
      const res = await action(idleState, fd);
      toast(res.message ?? okMsg, res.status === "error" ? "error" : "success");
      if (res.status !== "error") router.refresh();
    });
  }

  if (!caps.payment && !caps.approve && !caps.startApproval) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {caps.payment && outstanding && (
          <Button className="w-full" onClick={() => setPayOpen(true)}>Record payment</Button>
        )}
        {canStartApproval && (
          <Button
            className="w-full"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              const fd = new FormData();
              fd.set("invoiceId", invoiceId);
              run(startApprovalAction, fd, "Approval started.");
            }}
          >
            Start approval workflow
          </Button>
        )}
        {pendingApprovalId && caps.approve && (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={pending}
              onClick={() => {
                const fd = new FormData();
                fd.set("approvalId", pendingApprovalId);
                fd.set("decision", "approved");
                run(decideApprovalAction, fd, "Approved.");
              }}
            >
              Approve
            </Button>
            <Button className="flex-1" variant="danger" disabled={pending} onClick={() => setRejectOpen(true)}>
              Reject
            </Button>
          </div>
        )}
        {!caps.payment && !pendingApprovalId && !canStartApproval && (
          <p className="text-sm text-muted">No actions available for your role on this invoice.</p>
        )}
      </CardContent>

      <PaymentDialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        invoiceId={invoiceId}
        maxAmount={balanceDue}
        onSaved={() => {
          setPayOpen(false);
          router.refresh();
        }}
      />

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject invoice" size="sm">
        <form
          action={(fd) => {
            fd.set("approvalId", pendingApprovalId ?? "");
            fd.set("decision", "rejected");
            run(decideApprovalAction, fd, "Rejected.");
            setRejectOpen(false);
          }}
          className="space-y-4"
        >
          <Field label="Reason" htmlFor="reason" required>
            <Textarea id="reason" name="reason" required placeholder="Why is this being rejected?" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button type="submit" variant="danger">Reject</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

function PaymentDialog({
  open,
  onClose,
  invoiceId,
  maxAmount,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  maxAmount: string;
  onSaved: () => void;
}) {
  const [state, action] = useActionState(recordPaymentAction, idleState);
  const toast = useToast();
  useEffect(() => {
    if (state.status === "success") {
      toast(state.message ?? "Payment recorded.", "success");
      onSaved();
    } else if (state.status === "error" && state.message && !state.fieldErrors) {
      toast(state.message, "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onClose={onClose} title="Record payment" description={`Outstanding balance: ${maxAmount}`} size="md">
      <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <Field label="Amount" htmlFor="amount" required error={state.fieldErrors?.amount}>
          <Input id="amount" name="amount" inputMode="decimal" defaultValue={maxAmount} required />
        </Field>
        <Field label="Paid on" htmlFor="paidOn" required error={state.fieldErrors?.paidOn}>
          <Input id="paidOn" name="paidOn" type="date" defaultValue={toDateInput(new Date())} required />
        </Field>
        <Field label="Method" htmlFor="method">
          <Select id="method" name="method" defaultValue="neft">
            <Options options={PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label }))} />
          </Select>
        </Field>
        <Field label="Transaction reference" htmlFor="txnReference">
          <Input id="txnReference" name="txnReference" />
        </Field>
        <Field label="Notes" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" />
        </Field>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <SubmitButton>Record payment</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}
