/**
 * Shared Invoice Agent types, enums and lifecycle definitions.
 * Enum-like values are stored as plain strings in MySQL and validated with Zod.
 */

export type InvoiceDirection = "incoming" | "outgoing";

// Incoming (AP) processing lifecycle.
export const INCOMING_PROCESSING_STATUSES = [
  "RECEIVED",
  "PROCESSING",
  "NEEDS_REVIEW",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "ARCHIVED",
  "REJECTED",
  "DUPLICATE",
] as const;
export type IncomingProcessingStatus = (typeof INCOMING_PROCESSING_STATUSES)[number];

// Outgoing (AR) processing lifecycle.
export const OUTGOING_PROCESSING_STATUSES = [
  "DRAFT",
  "READY_FOR_ISSUE",
  "ISSUED",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
  "ARCHIVED",
  "CANCELLED",
] as const;
export type OutgoingProcessingStatus = (typeof OUTGOING_PROCESSING_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// Finance roles, lowest → highest privilege.
export const FINANCE_ROLES = [
  "FINANCE_VIEWER",
  "APPROVER",
  "FINANCE_USER",
  "FINANCE_MANAGER",
  "FINANCE_ADMIN",
] as const;
export type FinanceRole = (typeof FINANCE_ROLES)[number];

/** Privilege rank; higher = more privilege. APPROVER is a side-capability but
 *  ranked above viewer for ordering. Capability checks use helpers below. */
export const FINANCE_ROLE_RANK: Record<FinanceRole, number> = {
  FINANCE_VIEWER: 0,
  APPROVER: 1,
  FINANCE_USER: 2,
  FINANCE_MANAGER: 3,
  FINANCE_ADMIN: 4,
};

export type FinanceCapability =
  | "invoice.read"
  | "invoice.create"
  | "invoice.edit"
  | "invoice.delete"
  | "payment.record"
  | "invoice.approve"
  | "invoice.issue"
  | "email.send"
  | "gmail.manage"
  | "settings.manage"
  | "org.manage"
  | "agent.use";

/** Capability matrix — server-enforced. */
export const ROLE_CAPABILITIES: Record<FinanceRole, FinanceCapability[]> = {
  FINANCE_VIEWER: ["invoice.read", "agent.use"],
  APPROVER: ["invoice.read", "invoice.approve", "agent.use"],
  FINANCE_USER: [
    "invoice.read",
    "invoice.create",
    "invoice.edit",
    "payment.record",
    "agent.use",
  ],
  FINANCE_MANAGER: [
    "invoice.read",
    "invoice.create",
    "invoice.edit",
    "invoice.delete",
    "payment.record",
    "invoice.approve",
    "invoice.issue",
    "email.send",
    "agent.use",
  ],
  FINANCE_ADMIN: [
    "invoice.read",
    "invoice.create",
    "invoice.edit",
    "invoice.delete",
    "payment.record",
    "invoice.approve",
    "invoice.issue",
    "email.send",
    "gmail.manage",
    "settings.manage",
    "org.manage",
    "agent.use",
  ],
};

export function roleHasCapability(role: FinanceRole, cap: FinanceCapability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(cap) ?? false;
}
