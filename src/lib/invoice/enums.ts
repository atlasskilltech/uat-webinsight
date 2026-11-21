import type { Option } from "@/lib/enums";

/** Invoice-module enum option lists (labels + badge tones). Stored as strings. */

export const PARTY_KINDS: readonly Option[] = [
  { value: "supplier", label: "Supplier", tone: "info" },
  { value: "customer", label: "Customer", tone: "accent" },
  { value: "both", label: "Supplier & Customer", tone: "success" },
] as const;

export const INCOMING_PROCESSING_OPTIONS: readonly Option[] = [
  { value: "RECEIVED", label: "Received", tone: "neutral" },
  { value: "PROCESSING", label: "Processing", tone: "info" },
  { value: "NEEDS_REVIEW", label: "Needs Review", tone: "warning" },
  { value: "READY_FOR_APPROVAL", label: "Ready for Approval", tone: "info" },
  { value: "APPROVED", label: "Approved", tone: "success" },
  { value: "PAYMENT_PENDING", label: "Payment Pending", tone: "warning" },
  { value: "PARTIALLY_PAID", label: "Partially Paid", tone: "warning" },
  { value: "PAID", label: "Paid", tone: "success" },
  { value: "ARCHIVED", label: "Archived", tone: "neutral" },
  { value: "REJECTED", label: "Rejected", tone: "danger" },
  { value: "DUPLICATE", label: "Duplicate", tone: "danger" },
] as const;

export const OUTGOING_PROCESSING_OPTIONS: readonly Option[] = [
  { value: "DRAFT", label: "Draft", tone: "neutral" },
  { value: "READY_FOR_ISSUE", label: "Ready to Issue", tone: "info" },
  { value: "ISSUED", label: "Issued", tone: "info" },
  { value: "SENT", label: "Sent", tone: "accent" },
  { value: "PARTIALLY_PAID", label: "Partially Paid", tone: "warning" },
  { value: "PAID", label: "Paid", tone: "success" },
  { value: "ARCHIVED", label: "Archived", tone: "neutral" },
  { value: "CANCELLED", label: "Cancelled", tone: "danger" },
] as const;

export const PAYMENT_STATUS_OPTIONS: readonly Option[] = [
  { value: "UNPAID", label: "Unpaid", tone: "neutral" },
  { value: "PARTIALLY_PAID", label: "Partially Paid", tone: "warning" },
  { value: "PAID", label: "Paid", tone: "success" },
  { value: "OVERDUE", label: "Overdue", tone: "danger" },
  { value: "CANCELLED", label: "Cancelled", tone: "neutral" },
] as const;

export const APPROVAL_STATUS_OPTIONS: readonly Option[] = [
  { value: "pending", label: "Pending", tone: "warning" },
  { value: "approved", label: "Approved", tone: "success" },
  { value: "rejected", label: "Rejected", tone: "danger" },
  { value: "cancelled", label: "Cancelled", tone: "neutral" },
] as const;

export const PAYMENT_METHODS: readonly Option[] = [
  { value: "neft", label: "NEFT / Bank Transfer" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
] as const;

/** Processing options appropriate to a direction. */
export function processingOptions(direction: "incoming" | "outgoing"): readonly Option[] {
  return direction === "incoming" ? INCOMING_PROCESSING_OPTIONS : OUTGOING_PROCESSING_OPTIONS;
}
