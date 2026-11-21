import type { Metadata } from "next";
import { getInvoiceContext } from "@/lib/invoice/org";
import { hasCapability } from "@/lib/invoice/permissions";
import { listPendingApprovals } from "@/lib/invoice/services/approvals";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NotReady } from "../not-ready";
import { ApprovalsClient, type ApprovalView } from "./approvals-client";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) return <NotReady title="Approvals" canSetup={ctx?.canSetup} />;

  const [rows, canApprove] = await Promise.all([
    listPendingApprovals(ctx.organizationId),
    hasCapability("invoice.approve"),
  ]);

  const approvals: ApprovalView[] = rows.map((a) => ({
    id: a.id,
    invoiceId: a.invoice_id,
    invoiceNumber: a.invoice_number ?? "(no number)",
    partyName: a.party_name ?? "—",
    grandTotal: a.grand_total,
    currency: a.currency,
    currentStep: a.current_step,
  }));

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Invoices awaiting an approval decision. Each approval is bound to the exact invoice amount; a material change restarts it."
      />
      {approvals.length === 0 ? (
        <EmptyState title="Nothing awaiting approval" description="Approvals you start on an invoice appear here." />
      ) : (
        <ApprovalsClient approvals={approvals} canApprove={canApprove} />
      )}
    </div>
  );
}
