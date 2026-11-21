"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { idleState } from "@/lib/form-state";
import { fmtMoney } from "@/lib/invoice/format";
import { decideApprovalAction } from "../actions";

export interface ApprovalView {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  partyName: string;
  grandTotal: string;
  currency: string;
  currentStep: number;
}

export function ApprovalsClient({ approvals, canApprove }: { approvals: ApprovalView[]; canApprove: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState<ApprovalView | null>(null);

  function decide(id: string, decision: "approved" | "rejected", reason?: string) {
    const fd = new FormData();
    fd.set("approvalId", id);
    fd.set("decision", decision);
    if (reason) fd.set("reason", reason);
    startTransition(async () => {
      const res = await decideApprovalAction(idleState, fd);
      toast(res.message ?? "Done.", res.status === "error" ? "error" : "success");
      if (res.status !== "error") router.refresh();
    });
  }

  return (
    <Card>
      <Table>
        <THead>
          <TR>
            <TH>Invoice</TH>
            <TH>Party</TH>
            <TH>Step</TH>
            <TH className="text-right">Amount</TH>
            <TH className="text-right">Decision</TH>
          </TR>
        </THead>
        <TBody>
          {approvals.map((a) => (
            <TR key={a.id}>
              <TD className="font-medium">
                <Link href={`/invoices/${a.invoiceId}`} className="hover:underline">{a.invoiceNumber}</Link>
              </TD>
              <TD>{a.partyName}</TD>
              <TD>Step {a.currentStep}</TD>
              <TD className="text-right tabular-nums">{fmtMoney(a.grandTotal, a.currency)}</TD>
              <TD className="text-right">
                {canApprove ? (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" disabled={pending} onClick={() => decide(a.id, "approved")}>Approve</Button>
                    <Button size="sm" variant="danger" disabled={pending} onClick={() => setRejecting(a)}>Reject</Button>
                  </div>
                ) : (
                  <span className="text-xs text-muted">View only</span>
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title="Reject invoice" size="sm">
        <form
          action={(fd) => {
            const reason = String(fd.get("reason") ?? "");
            if (rejecting) decide(rejecting.id, "rejected", reason);
            setRejecting(null);
          }}
          className="space-y-4"
        >
          <Field label="Reason" htmlFor="reason" required>
            <Textarea id="reason" name="reason" required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button type="submit" variant="danger">Reject</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
