import { z } from "zod";

/**
 * Zod schemas for Invoice Agent mutations. Monetary / quantity / percent values
 * are validated as strings (never parsed through JS float here) and handed to
 * the deterministic money engine.
 */

const money = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter a valid amount (max 2 decimals).");
const moneyOptional = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter a valid amount.")
  .optional()
  .or(z.literal("").transform(() => undefined));
const qty = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,3})?$/, "Enter a valid quantity (max 3 decimals).");
const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a valid rate (0–100).")
  .refine((v) => Number(v) <= 100, "Rate cannot exceed 100%.");
const gstin = z
  .string()
  .trim()
  .max(20)
  .optional()
  .or(z.literal("").transform(() => undefined))
  .refine((v) => !v || /^[0-9A-Z]{15}$/.test(v), "GSTIN must be 15 alphanumeric characters.");

export const partySchema = z.object({
  kind: z.enum(["supplier", "customer", "both"]),
  businessName: z.string().trim().min(2, "Business name is required.").max(191),
  legalName: z.string().trim().max(191).optional().or(z.literal("").transform(() => undefined)),
  gstin,
  pan: z
    .string()
    .trim()
    .max(16)
    .optional()
    .or(z.literal("").transform(() => undefined))
    .refine((v) => !v || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "PAN must look like ABCDE1234F."),
  email: z
    .string()
    .trim()
    .email("Enter a valid email.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(64).optional().or(z.literal("").transform(() => undefined)),
  contactPerson: z.string().trim().max(191).optional().or(z.literal("").transform(() => undefined)),
  paymentTerms: z.string().trim().max(64).optional().or(z.literal("").transform(() => undefined)),
  billingAddress: z.string().trim().max(1000).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
});
export type PartyInput = z.infer<typeof partySchema>;

export const productSchema = z.object({
  name: z.string().trim().min(2, "Name is required.").max(191),
  description: z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
  sku: z.string().trim().max(64).optional().or(z.literal("").transform(() => undefined)),
  unit: z.string().trim().max(32).optional().or(z.literal("").transform(() => undefined)),
  defaultPrice: money,
  defaultGstRate: percent,
  hsnSac: z.string().trim().max(16).optional().or(z.literal("").transform(() => undefined)),
});
export type ProductInput = z.infer<typeof productSchema>;

export const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Description required.").max(500),
  hsnSac: z.string().trim().max(16).optional(),
  quantity: qty,
  unit: z.string().trim().max(32).optional(),
  unitPrice: money,
  discount: moneyOptional,
  gstRate: percent,
  productServiceId: z.string().trim().max(191).optional(),
});
export type LineItemInput = z.infer<typeof lineItemSchema>;

export const invoiceHeaderSchema = z.object({
  direction: z.enum(["incoming", "outgoing"]),
  partyId: z.string().trim().max(191).optional().or(z.literal("").transform(() => undefined)),
  invoiceNumber: z.string().trim().max(128).optional().or(z.literal("").transform(() => undefined)),
  poNumber: z.string().trim().max(128).optional().or(z.literal("").transform(() => undefined)),
  invoiceDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.").optional().or(z.literal("").transform(() => undefined)),
  dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date.").optional().or(z.literal("").transform(() => undefined)),
  currency: z.enum(["INR", "USD", "EUR", "GBP"]).default("INR"),
  paymentTerms: z.string().trim().max(64).optional().or(z.literal("").transform(() => undefined)),
  interState: z.enum(["true", "false"]).default("false"),
  otherCharges: moneyOptional,
  roundTotal: z.enum(["true", "false"]).default("false"),
  notes: z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
});
export type InvoiceHeaderInput = z.infer<typeof invoiceHeaderSchema>;

export const paymentSchema = z.object({
  invoiceId: z.string().trim().min(1),
  amount: money,
  paidOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date."),
  method: z.enum(["neft", "upi", "cheque", "cash", "card", "other"]).optional().or(z.literal("").transform(() => undefined)),
  txnReference: z.string().trim().max(191).optional().or(z.literal("").transform(() => undefined)),
  bankReference: z.string().trim().max(191).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
});
export type PaymentInput = z.infer<typeof paymentSchema>;
