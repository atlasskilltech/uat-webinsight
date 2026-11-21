import "server-only";
import { iQueryOne } from "./db";
import { jobCounts, type JobStatus } from "./jobs";

/**
 * Overview metrics for an organization, read from real records only. Returns
 * zeros when there are no rows — NEVER demo/sample figures mixed with real data.
 * Monetary sums are returned as DECIMAL strings (never JS floats).
 */
export interface OverviewMetrics {
  incoming: {
    totalInvoices: number;
    totalPayable: string;
    unpaid: number;
    partiallyPaid: number;
    overdue: number;
    awaitingApproval: number;
    needsReview: number;
    upcomingDue: number;
  };
  outgoing: {
    totalInvoices: number;
    totalReceivable: string;
    draft: number;
    issued: number;
    sent: number;
    paid: number;
    partiallyPaid: number;
    overdue: number;
  };
  jobs: Record<JobStatus, number>;
}

async function scalar(sql: string, params: unknown[]): Promise<number> {
  const row = await iQueryOne<{ v: number }>(sql, params);
  return Number(row?.v ?? 0);
}

async function money(sql: string, params: unknown[]): Promise<string> {
  const row = await iQueryOne<{ v: string | null }>(sql, params);
  return row?.v ?? "0.00";
}

export async function getOverviewMetrics(organizationId: string): Promise<OverviewMetrics> {
  const org = [organizationId];
  const [
    inTotal,
    inPayable,
    inUnpaid,
    inPartial,
    inOverdue,
    inApproval,
    inReview,
    inUpcoming,
    outTotal,
    outReceivable,
    outDraft,
    outIssued,
    outSent,
    outPaid,
    outPartial,
    outOverdue,
    jobs,
  ] = await Promise.all([
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='incoming' AND deleted_at IS NULL", org),
    money("SELECT COALESCE(SUM(balance_due),0) v FROM `invoices` WHERE organization_id=? AND direction='incoming' AND payment_status<>'CANCELLED' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='incoming' AND payment_status='UNPAID' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='incoming' AND payment_status='PARTIALLY_PAID' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='incoming' AND payment_status='OVERDUE' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='incoming' AND processing_status='READY_FOR_APPROVAL' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='incoming' AND processing_status='NEEDS_REVIEW' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='incoming' AND payment_status IN ('UNPAID','PARTIALLY_PAID') AND due_date IS NOT NULL AND due_date >= CURDATE() AND due_date < DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='outgoing' AND deleted_at IS NULL", org),
    money("SELECT COALESCE(SUM(balance_due),0) v FROM `invoices` WHERE organization_id=? AND direction='outgoing' AND payment_status<>'CANCELLED' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='outgoing' AND processing_status='DRAFT' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='outgoing' AND processing_status='ISSUED' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='outgoing' AND processing_status='SENT' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='outgoing' AND payment_status='PAID' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='outgoing' AND payment_status='PARTIALLY_PAID' AND deleted_at IS NULL", org),
    scalar("SELECT COUNT(*) v FROM `invoices` WHERE organization_id=? AND direction='outgoing' AND payment_status='OVERDUE' AND deleted_at IS NULL", org),
    jobCounts(organizationId),
  ]);

  return {
    incoming: {
      totalInvoices: inTotal,
      totalPayable: inPayable,
      unpaid: inUnpaid,
      partiallyPaid: inPartial,
      overdue: inOverdue,
      awaitingApproval: inApproval,
      needsReview: inReview,
      upcomingDue: inUpcoming,
    },
    outgoing: {
      totalInvoices: outTotal,
      totalReceivable: outReceivable,
      draft: outDraft,
      issued: outIssued,
      sent: outSent,
      paid: outPaid,
      partiallyPaid: outPartial,
      overdue: outOverdue,
    },
    jobs,
  };
}
