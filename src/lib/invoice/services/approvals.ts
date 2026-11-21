import "server-only";
import type { PoolConnection } from "mysql2/promise";
import { iQuery, iQueryOne, iTransaction, ijson } from "../db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import type { InvoiceRow } from "./invoices";

export interface ApprovalRow {
  id: string;
  organization_id: string;
  invoice_id: string;
  status: string;
  current_step: number;
  approved_amount: string | null;
  invoice_version: number;
  started_at: Date;
  completed_at: Date | null;
}

export interface ApprovalStepRow {
  id: string;
  approval_id: string;
  step_order: number;
  approver_role: string | null;
  approver_user_id: string | null;
  decision: string;
  reason: string | null;
  decided_at: Date | null;
}

/**
 * Derive approval steps from policy. Single-org default: one FINANCE_MANAGER
 * step; amounts above a configurable threshold add a FINANCE_ADMIN step. The
 * policy comes from org settings JSON { approval: { adminThreshold } }.
 */
function planSteps(amount: string, adminThreshold: number | null): { role: string }[] {
  const steps: { role: string }[] = [{ role: "FINANCE_MANAGER" }];
  if (adminThreshold != null && Number(amount) >= adminThreshold) {
    steps.push({ role: "FINANCE_ADMIN" });
  }
  return steps;
}

export async function getApprovalForInvoice(
  organizationId: string,
  invoiceId: string,
): Promise<{ approval: ApprovalRow; steps: ApprovalStepRow[] } | null> {
  const approval = await iQueryOne<ApprovalRow>(
    "SELECT * FROM `invoice_approvals` WHERE organization_id=? AND invoice_id=? ORDER BY started_at DESC LIMIT 1",
    [organizationId, invoiceId],
  );
  if (!approval) return null;
  const steps = await iQuery<ApprovalStepRow>(
    "SELECT * FROM `invoice_approval_steps` WHERE approval_id=? ORDER BY step_order ASC",
    [approval.id],
  );
  return { approval, steps };
}

/** Start (or restart) an approval workflow bound to the invoice's current total. */
export async function startApproval(
  organizationId: string,
  actor: { id: string; email: string },
  invoice: InvoiceRow,
  adminThreshold: number | null = null,
): Promise<string> {
  const approvalId = createId();
  await iTransaction(async (conn) => {
    // Cancel any existing pending approval for this invoice.
    await cancelPendingApprovals(conn, organizationId, invoice.id, "superseded");

    await conn.query(
      "INSERT INTO `invoice_approvals` (`id`,`organization_id`,`invoice_id`,`status`,`current_step`,`approved_amount`,`policy_snapshot`) " +
        "VALUES (?,?,?,'pending',1,?,?)",
      [approvalId, organizationId, invoice.id, invoice.grand_total, ijson({ adminThreshold })],
    );
    const steps = planSteps(invoice.grand_total, adminThreshold);
    let order = 1;
    for (const s of steps) {
      await conn.query(
        "INSERT INTO `invoice_approval_steps` (`id`,`organization_id`,`approval_id`,`step_order`,`approver_role`,`decision`) " +
          "VALUES (?,?,?,?,?,'pending')",
        [createId(), organizationId, approvalId, order++, s.role],
      );
    }
    await conn.query(
      "UPDATE `invoices` SET `processing_status`='READY_FOR_APPROVAL' WHERE id=? AND direction='incoming'",
      [invoice.id],
    );
    await logInvoiceAudit(
      {
        organizationId,
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "approval.started",
        entityType: "invoice",
        entityId: invoice.id,
        metadata: { approvalId, amount: invoice.grand_total, steps: steps.length },
      },
      conn,
    );
  });
  return approvalId;
}

/** Record an approve/reject decision on the current step. */
export async function decideApproval(
  organizationId: string,
  actor: { id: string; email: string },
  approvalId: string,
  decision: "approved" | "rejected",
  reason?: string,
): Promise<void> {
  await iTransaction(async (conn) => {
    const [arows] = await conn.query(
      "SELECT * FROM `invoice_approvals` WHERE organization_id=? AND id=? FOR UPDATE",
      [organizationId, approvalId],
    );
    const approval = (arows as ApprovalRow[])[0];
    if (!approval) throw new Error("Approval not found.");
    if (approval.status !== "pending") throw new Error("Approval is already resolved.");

    const [srows] = await conn.query(
      "SELECT * FROM `invoice_approval_steps` WHERE approval_id=? ORDER BY step_order ASC",
      [approvalId],
    );
    const steps = srows as ApprovalStepRow[];
    const current = steps.find((s) => s.step_order === approval.current_step);
    if (!current) throw new Error("No pending step.");

    await conn.query(
      "UPDATE `invoice_approval_steps` SET `decision`=?,`approver_user_id`=?,`reason`=?,`decided_at`=NOW(3) WHERE id=?",
      [decision, actor.id, reason ?? null, current.id],
    );

    if (decision === "rejected") {
      await conn.query(
        "UPDATE `invoice_approvals` SET `status`='rejected', `completed_at`=NOW(3) WHERE id=?",
        [approvalId],
      );
      await conn.query(
        "UPDATE `invoices` SET `processing_status`='REJECTED' WHERE id=? AND direction='incoming'",
        [approval.invoice_id],
      );
    } else {
      const isLast = approval.current_step >= steps.length;
      if (isLast) {
        await conn.query(
          "UPDATE `invoice_approvals` SET `status`='approved', `completed_at`=NOW(3) WHERE id=?",
          [approvalId],
        );
        await conn.query(
          "UPDATE `invoices` SET `processing_status`='APPROVED' WHERE id=? AND direction='incoming'",
          [approval.invoice_id],
        );
      } else {
        await conn.query("UPDATE `invoice_approvals` SET `current_step`=? WHERE id=?", [
          approval.current_step + 1,
          approvalId,
        ]);
      }
    }

    await logInvoiceAudit(
      {
        organizationId,
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: `approval.${decision}`,
        entityType: "invoice",
        entityId: approval.invoice_id,
        metadata: { approvalId, step: approval.current_step, reason },
      },
      conn,
    );
  });
}

/** Cancel pending approvals (e.g. when an approved invoice is materially changed). */
export async function cancelPendingApprovals(
  conn: PoolConnection,
  organizationId: string,
  invoiceId: string,
  reason: string,
): Promise<void> {
  await conn.query(
    "UPDATE `invoice_approvals` SET `status`='cancelled', `completed_at`=NOW(3) WHERE organization_id=? AND invoice_id=? AND status='pending'",
    [organizationId, invoiceId],
  );
  void reason;
}

export interface PendingApprovalListRow extends ApprovalRow {
  invoice_number: string | null;
  grand_total: string;
  currency: string;
  party_name: string | null;
}

export async function listPendingApprovals(organizationId: string): Promise<PendingApprovalListRow[]> {
  return iQuery<PendingApprovalListRow>(
    "SELECT ap.*, i.invoice_number, i.grand_total, i.currency, p.business_name AS party_name " +
      "FROM `invoice_approvals` ap " +
      "JOIN `invoices` i ON i.id = ap.invoice_id " +
      "LEFT JOIN `invoice_parties` p ON p.id = i.party_id " +
      "WHERE ap.organization_id=? AND ap.status='pending' ORDER BY ap.started_at ASC",
    [organizationId],
  );
}
