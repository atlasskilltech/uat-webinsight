"use server";

import { revalidatePath } from "next/cache";
import { parseForm, errorState, successState, type FormState } from "@/lib/form-state";
import { isAuthError } from "@/lib/auth/guard";
import { requireCapability } from "@/lib/invoice/permissions";
import {
  partySchema,
  productSchema,
  invoiceHeaderSchema,
  paymentSchema,
  lineItemSchema,
  type LineItemInput,
} from "@/lib/invoice/validation";
import { createParty, updateParty, setPartyActive } from "@/lib/invoice/services/parties";
import { createProduct, updateProduct, setProductActive } from "@/lib/invoice/services/products";
import { createInvoice, getInvoice } from "@/lib/invoice/services/invoices";
import { recordPayment } from "@/lib/invoice/services/payments";
import { startApproval, decideApproval } from "@/lib/invoice/services/approvals";

function fail(e: unknown): FormState {
  return errorState(isAuthError(e) ? e.message : e instanceof Error ? e.message : "Something went wrong.");
}

// --- Parties ----------------------------------------------------------------

export async function savePartyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "").trim();
  try {
    const ctx = await requireCapability(id ? "invoice.edit" : "invoice.create");
    const parsed = parseForm(partySchema, formData);
    if (!parsed.success) return parsed.state;
    const actor = { id: ctx.user.id, email: ctx.user.email };
    if (id) {
      await updateParty(ctx.organizationId, id, actor, parsed.data);
      revalidatePath("/invoices/parties");
      return successState("Party updated.", id);
    }
    const newId = await createParty(ctx.organizationId, actor, parsed.data);
    revalidatePath("/invoices/parties");
    return successState("Party created.", newId);
  } catch (e) {
    return fail(e);
  }
}

export async function deactivatePartyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("invoice.edit");
    const id = String(formData.get("id") ?? "").trim();
    const active = String(formData.get("active") ?? "") === "true";
    await setPartyActive(ctx.organizationId, id, active, { id: ctx.user.id, email: ctx.user.email });
    revalidatePath("/invoices/parties");
    return successState(active ? "Party activated." : "Party deactivated.");
  } catch (e) {
    return fail(e);
  }
}

// --- Products ---------------------------------------------------------------

export async function saveProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "").trim();
  try {
    const ctx = await requireCapability(id ? "invoice.edit" : "invoice.create");
    const parsed = parseForm(productSchema, formData);
    if (!parsed.success) return parsed.state;
    const actor = { id: ctx.user.id, email: ctx.user.email };
    if (id) {
      await updateProduct(ctx.organizationId, id, actor, parsed.data);
      revalidatePath("/invoices/products");
      return successState("Product updated.", id);
    }
    const newId = await createProduct(ctx.organizationId, actor, parsed.data);
    revalidatePath("/invoices/products");
    return successState("Product created.", newId);
  } catch (e) {
    return fail(e);
  }
}

export async function deactivateProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("invoice.edit");
    const id = String(formData.get("id") ?? "").trim();
    const active = String(formData.get("active") ?? "") === "true";
    await setProductActive(ctx.organizationId, id, active, { id: ctx.user.id, email: ctx.user.email });
    revalidatePath("/invoices/products");
    return successState(active ? "Product activated." : "Product deactivated.");
  } catch (e) {
    return fail(e);
  }
}

// --- Invoices ---------------------------------------------------------------

export async function createInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("invoice.create");
    const parsed = parseForm(invoiceHeaderSchema, formData);
    if (!parsed.success) return parsed.state;

    // Line items arrive as a JSON array from the client editor.
    let rawLines: unknown;
    try {
      rawLines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
    } catch {
      return errorState("Invalid line items.");
    }
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      return errorState("Add at least one line item.");
    }
    const lines: LineItemInput[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const r = lineItemSchema.safeParse(rawLines[i]);
      if (!r.success) {
        return errorState(`Line ${i + 1}: ${r.error.issues[0]?.message ?? "invalid"}.`);
      }
      lines.push(r.data);
    }

    const id = await createInvoice(
      ctx.organizationId,
      { id: ctx.user.id, email: ctx.user.email },
      { header: parsed.data, lines, partyNameRaw: String(formData.get("partyNameRaw") ?? "") || null },
    );
    revalidatePath("/invoices/list");
    revalidatePath("/invoices");
    return successState("Invoice created.", id);
  } catch (e) {
    return fail(e);
  }
}

// --- Payments ---------------------------------------------------------------

export async function recordPaymentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("payment.record");
    const parsed = parseForm(paymentSchema, formData);
    if (!parsed.success) return parsed.state;
    await recordPayment(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, parsed.data);
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
    revalidatePath("/invoices/payments");
    revalidatePath("/invoices");
    return successState("Payment recorded.", parsed.data.invoiceId);
  } catch (e) {
    return fail(e);
  }
}

// --- Approvals --------------------------------------------------------------

export async function startApprovalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("invoice.edit");
    const invoiceId = String(formData.get("invoiceId") ?? "").trim();
    const detail = await getInvoice(ctx.organizationId, invoiceId);
    if (!detail) return errorState("Invoice not found.");
    await startApproval(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, detail.invoice);
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices/approvals");
    return successState("Approval workflow started.", invoiceId);
  } catch (e) {
    return fail(e);
  }
}

export async function decideApprovalAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("invoice.approve");
    const approvalId = String(formData.get("approvalId") ?? "").trim();
    const decision = String(formData.get("decision") ?? "");
    const reason = String(formData.get("reason") ?? "") || undefined;
    if (decision !== "approved" && decision !== "rejected") return errorState("Invalid decision.");
    if (decision === "rejected" && !reason) return errorState("A reason is required to reject.");
    await decideApproval(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, approvalId, decision, reason);
    revalidatePath("/invoices/approvals");
    return successState(decision === "approved" ? "Approved." : "Rejected.");
  } catch (e) {
    return fail(e);
  }
}
