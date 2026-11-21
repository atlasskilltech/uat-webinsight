"use server";

import { revalidatePath } from "next/cache";
import { parseForm, errorState, successState, type FormState } from "@/lib/form-state";
import { isAuthError } from "@/lib/auth/guard";
import { requireCapability } from "@/lib/invoice/permissions";
import { processUploadedDocument } from "@/lib/invoice/services/processing";
import { updateInvoiceFromReview } from "@/lib/invoice/services/invoices";
import { invoiceHeaderSchema, lineItemSchema, type LineItemInput } from "@/lib/invoice/validation";

const MAX_BYTES = (Number(process.env.INVOICE_MAX_UPLOAD_MB) || 20) * 1024 * 1024;

function fail(e: unknown): FormState {
  return errorState(isAuthError(e) ? e.message : e instanceof Error ? e.message : "Something went wrong.");
}

export async function uploadDocumentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("invoice.create");
    const file = formData.get("file");
    const direction = String(formData.get("direction") ?? "incoming") === "outgoing" ? "outgoing" : "incoming";
    if (!(file instanceof File) || file.size === 0) return errorState("Choose a file to upload.");
    if (file.size > MAX_BYTES) return errorState(`File too large (max ${MAX_BYTES / (1024 * 1024)}MB).`);

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await processUploadedDocument({
      organizationId: ctx.organizationId,
      actor: { id: ctx.user.id, email: ctx.user.email },
      direction,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      buffer,
    });

    revalidatePath("/invoices/processing");
    revalidatePath("/invoices/needs-review");
    revalidatePath("/invoices");
    return successState(result.message, result.invoiceId);
  } catch (e) {
    return fail(e);
  }
}

export async function reviewInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireCapability("invoice.edit");
    const invoiceId = String(formData.get("invoiceId") ?? "").trim();
    if (!invoiceId) return errorState("Missing invoice.");

    const parsed = parseForm(invoiceHeaderSchema, formData);
    if (!parsed.success) return parsed.state;

    let rawLines: unknown;
    try {
      rawLines = JSON.parse(String(formData.get("linesJson") ?? "[]"));
    } catch {
      return errorState("Invalid line items.");
    }
    if (!Array.isArray(rawLines) || rawLines.length === 0) return errorState("Add at least one line item.");
    const lines: LineItemInput[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const r = lineItemSchema.safeParse(rawLines[i]);
      if (!r.success) return errorState(`Line ${i + 1}: ${r.error.issues[0]?.message ?? "invalid"}.`);
      lines.push(r.data);
    }

    const h = parsed.data;
    await updateInvoiceFromReview(ctx.organizationId, { id: ctx.user.id, email: ctx.user.email }, invoiceId, {
      partyId: h.partyId ?? null,
      invoiceNumber: h.invoiceNumber ?? null,
      poNumber: h.poNumber ?? null,
      invoiceDate: h.invoiceDate ?? null,
      dueDate: h.dueDate ?? null,
      currency: h.currency,
      interState: h.interState === "true",
      otherCharges: h.otherCharges ?? "0",
      notes: h.notes ?? null,
      lines: lines.map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discount: l.discount,
        gstRate: l.gstRate,
      })),
    });

    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices/needs-review");
    revalidatePath("/invoices");
    return successState("Review saved. Moved to Ready for Approval.", invoiceId);
  } catch (e) {
    return fail(e);
  }
}
