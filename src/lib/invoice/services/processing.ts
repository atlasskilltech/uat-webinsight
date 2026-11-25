import "server-only";
import { iQueryOne, iExecute, iTransaction, ijson, isMissingColumnError, isMissingTableError } from "../db";
import { normalizeGstin } from "./org-admin";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { validateUpload, newStorageKey, getStorage } from "../storage";
import { computeInvoiceTotals, computeLine, totalsMatch, toCents } from "../money";
import { extractPdfText, hasUsableText } from "../ai/pdf-text";
import { getOcrProvider, ocrConfigured } from "../ai/ocr";
import { getExtractor, aiConfigured } from "../ai/extract";
import type { ExtractedInvoice } from "../ai/types";
import { detectDuplicates } from "./duplicates";
import { enqueueJob, completeJob, failJob } from "../jobs";

const CONFIDENCE_THRESHOLD = 75; // percent

export interface ProcessInput {
  organizationId: string;
  actor: { id: string; email: string };
  direction: "incoming" | "outgoing";
  filename: string;
  mimeType: string;
  buffer: Buffer;
  /** Provenance — defaults to a manual upload. */
  source?: "upload" | "gmail";
  sourceEmailMessageId?: string | null;
  emailAttachmentId?: string | null;
}

export interface ProcessResult {
  invoiceId: string;
  needsReview: boolean;
  duplicate: boolean;
  confidence: number | null;
  extracted: boolean;
  ocrUsed: boolean;
  textFound: boolean;
  message: string;
}

function num(v: string | null | undefined): string {
  return v == null || v === "" ? "0" : v;
}

function toDateOnly(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/** Full ingest → extract → validate → recompute → dedupe → persist pipeline. */
export async function processUploadedDocument(input: ProcessInput): Promise<ProcessResult> {
  const { organizationId, actor, direction } = input;

  // 1) Validate by file signature (magic bytes) + size.
  const v = validateUpload(input.buffer, input.mimeType);
  if (!v.ok || !v.sha256 || !v.mime) throw new Error(v.error ?? "Invalid file.");
  const fingerprint = v.sha256;

  // 2) Ingest-level dedupe: identical stored document already processed?
  const existingAtt = await iQueryOne<{ id: string; invoice_id: string | null }>(
    "SELECT id, invoice_id FROM `invoice_attachments` WHERE organization_id=? AND sha256=? LIMIT 1",
    [organizationId, fingerprint],
  );
  if (existingAtt?.invoice_id) {
    return {
      invoiceId: existingAtt.invoice_id,
      needsReview: false,
      duplicate: true,
      confidence: null,
      extracted: false,
      ocrUsed: false,
      textFound: false,
      message: "This exact document was already uploaded; no new invoice was created.",
    };
  }

  // 3) Store original privately.
  const key = newStorageKey(organizationId, input.filename);
  await getStorage().put(key, input.buffer, v.mime);

  // Traceability job row.
  const jobId = await enqueueJob({
    type: "ai_extract",
    organizationId,
    payload: { filename: input.filename, sha256: fingerprint },
    idempotencyKey: `doc:${organizationId}:${fingerprint}`,
  });

  try {
    // 4) Text extraction: embedded PDF text, else OCR (if configured).
    let text = "";
    let ocrUsed = false;
    if (v.mime === "application/pdf") {
      const pdf = await extractPdfText(input.buffer);
      if (hasUsableText(pdf)) text = pdf!.text;
    }
    if (!text) {
      const ocr = getOcrProvider();
      if (ocr) {
        const r = await ocr.recognize({ buffer: input.buffer, mimeType: v.mime });
        text = r.text ?? "";
        ocrUsed = true;
      }
    }
    const textFound = text.trim().length > 0;

    // 5) AI extraction (only if configured and we have text).
    let extracted: ExtractedInvoice | null = null;
    let raw: unknown = null;
    let provider: string | null = null;
    let model: string | null = null;
    const extractor = getExtractor();
    if (extractor && textFound) {
      const res = await extractor.extract({ text });
      extracted = res.data;
      raw = res.raw;
      provider = res.provider;
      model = res.model;
    }

    // 6) Deterministic recompute from extracted lines (never trust model totals).
    const interState = extracted ? toCents(num(extracted.igst)) > 0n : false;
    const engineLines = (extracted?.lineItems ?? []).map((l) => ({
      quantity: num(l.quantity),
      unitPrice: num(l.unitPrice),
      discount: num(l.discount),
      gstRate: num(l.gstRate),
      interState,
    }));
    const totals = computeInvoiceTotals({
      lines: engineLines,
      otherCharges: num(extracted?.otherCharges),
      roundTotal: false,
    });
    const mathCheckPassed =
      extracted?.grandTotal != null && engineLines.length > 0
        ? totalsMatch(extracted.grandTotal, totals.grandTotal, 100n /* ₹1 tolerance */)
        : null;

    // 7) Confidence from model field confidences (0..1 -> percent).
    let confidence: number | null = null;
    if (extracted?.fieldConfidence) {
      const vals = Object.values(extracted.fieldConfidence).filter((n) => typeof n === "number");
      if (vals.length) confidence = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100);
    }

    // 8) Party match by GSTIN (exact), else leave unmatched (never auto-create).
    let partyId: string | null = null;
    const supplierGstin = extracted?.supplierGstin ?? null;
    if (supplierGstin) {
      const p = await iQueryOne<{ id: string }>(
        "SELECT id FROM `invoice_parties` WHERE organization_id=? AND gstin=? AND deleted_at IS NULL LIMIT 1",
        [organizationId, supplierGstin],
      );
      partyId = p?.id ?? null;
    }

    const needsReview =
      !aiConfigured() ||
      !extracted ||
      mathCheckPassed === false ||
      (confidence != null && confidence < CONFIDENCE_THRESHOLD) ||
      confidence == null ||
      !partyId;

    const invoiceId = createId();
    await iTransaction(async (conn) => {
      await conn.query(
        "INSERT INTO `invoices` " +
          "(`id`,`organization_id`,`direction`,`party_id`,`party_name_raw`,`invoice_number`,`po_number`," +
          "`invoice_date`,`due_date`,`currency`,`subtotal`,`discount_total`,`taxable_amount`,`cgst`,`sgst`,`igst`," +
          "`tax_total`,`other_charges`,`grand_total`,`amount_paid`,`balance_due`,`processing_status`,`payment_status`," +
          "`source`,`source_email_message_id`,`document_fingerprint`,`extraction_confidence`,`created_by`) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          invoiceId,
          organizationId,
          direction,
          partyId,
          extracted?.supplierName ?? null,
          extracted?.invoiceNumber ?? null,
          extracted?.poNumber ?? null,
          toDateOnly(extracted?.invoiceDate ?? null),
          toDateOnly(extracted?.dueDate ?? null),
          extracted?.currency ?? "INR",
          totals.subtotal,
          totals.discountTotal,
          totals.taxableAmount,
          totals.cgst,
          totals.sgst,
          totals.igst,
          totals.taxTotal,
          totals.otherCharges,
          totals.grandTotal,
          "0.00",
          totals.grandTotal,
          needsReview ? "NEEDS_REVIEW" : "READY_FOR_APPROVAL",
          "UNPAID",
          input.source ?? "upload",
          input.sourceEmailMessageId ?? null,
          fingerprint,
          confidence != null ? confidence.toFixed(2) : null,
          actor.id,
        ],
      );

      let lineNo = 1;
      for (const l of extracted?.lineItems ?? []) {
        const c = computeLine({
          quantity: num(l.quantity),
          unitPrice: num(l.unitPrice),
          discount: num(l.discount),
          gstRate: num(l.gstRate),
          interState,
        });
        await conn.query(
          "INSERT INTO `invoice_line_items` " +
            "(`id`,`invoice_id`,`organization_id`,`line_no`,`description`,`hsn_sac`,`quantity`,`unit`,`unit_price`," +
            "`discount`,`taxable_value`,`gst_rate`,`cgst`,`sgst`,`igst`,`line_total`) " +
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            createId(), invoiceId, organizationId, lineNo++,
            l.description ?? null, l.hsnSac ?? null, num(l.quantity), l.unit ?? null, num(l.unitPrice),
            num(l.discount), c.taxableValue, num(l.gstRate), c.cgst, c.sgst, c.igst, c.lineTotal,
          ],
        );
      }

      await conn.query(
        "INSERT INTO `invoice_attachments` " +
          "(`id`,`organization_id`,`invoice_id`,`email_attachment_id`,`role`,`filename`,`mime_type`,`size_bytes`,`storage_provider`,`storage_key`,`sha256`) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [createId(), organizationId, invoiceId, input.emailAttachmentId ?? null, "primary", input.filename, v.mime, input.buffer.length, getStorage().provider, key, fingerprint],
      );

      await conn.query(
        "INSERT INTO `invoice_extractions` " +
          "(`id`,`organization_id`,`invoice_id`,`ocr_provider`,`ai_provider`,`ai_model`,`raw_text`,`raw_json`," +
          "`field_confidence`,`overall_confidence`,`math_check_passed`,`needs_review`) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          createId(), organizationId, invoiceId,
          ocrUsed ? (process.env.OCR_PROVIDER ?? "ocr") : null,
          provider, model, text.slice(0, 200000), ijson(raw),
          ijson(extracted?.fieldConfidence ?? null),
          confidence != null ? confidence.toFixed(2) : null,
          mathCheckPassed, needsReview,
        ],
      );

      await logInvoiceAudit(
        {
          organizationId,
          actorType: "system",
          actorUserId: actor.id,
          actorLabel: actor.email,
          action: "invoice.ingested",
          entityType: "invoice",
          entityId: invoiceId,
          metadata: { source: "upload", extracted: !!extracted, mathCheckPassed, confidence, ocrUsed },
        },
        conn,
      );
    });

    // Persist the extracted BUYER GSTIN (best-effort, migration 012) so the
    // forwarding layer can validate it against the organisation's GSTIN at send
    // time. Done as a separate, missing-column-safe UPDATE so the invoice INSERT
    // keeps working on environments where 012 has not been applied yet (there the
    // GSTIN is simply absent, and a GST invoice falls through to manual review).
    if (extracted?.buyerGstin) {
      try {
        await iExecute("UPDATE `invoices` SET `buyer_gstin`=? WHERE id=?", [normalizeGstin(extracted.buyerGstin), invoiceId]);
      } catch (e) {
        if (!isMissingColumnError(e) && !isMissingTableError(e)) {
          /* non-schema error: ignore — GSTIN capture must never fail processing */
        }
      }
    }

    // 9) Duplicate detection (records matches; high score forces review/flag).
    const dupes = await detectDuplicates(organizationId, {
      id: invoiceId,
      direction,
      partyId,
      invoiceNumber: extracted?.invoiceNumber ?? null,
      grandTotal: totals.grandTotal,
      invoiceDate: toDateOnly(extracted?.invoiceDate ?? null),
      documentFingerprint: fingerprint,
    });
    const strongDuplicate = dupes.some((d) => d.score >= 90);
    if (strongDuplicate) {
      await iTransaction(async (conn) => {
        await conn.query("UPDATE `invoices` SET `processing_status`='DUPLICATE' WHERE id=?", [invoiceId]);
      });
    }

    await completeJob(jobId, {
      invoiceId,
      needsReview: needsReview || strongDuplicate,
      duplicate: strongDuplicate,
      confidence,
    });

    return {
      invoiceId,
      needsReview: needsReview || strongDuplicate,
      duplicate: strongDuplicate,
      confidence,
      extracted: !!extracted,
      ocrUsed,
      textFound,
      message: !extracted
        ? aiConfigured()
          ? textFound
            ? "Stored and text-extracted. AI could not extract fields — sent to review."
            : ocrConfigured()
              ? "Stored. No readable text found — sent to review."
              : "Stored. Scanned document and OCR is not configured — sent to review."
          : "Stored. AI extraction is not configured — sent to review for manual entry."
        : strongDuplicate
          ? "Possible duplicate detected — sent to review."
          : needsReview
            ? "Extracted with low confidence or unmatched vendor — sent to review."
            : "Extracted and validated — ready for approval.",
    };
  } catch (e) {
    await failJob(jobId, e instanceof Error ? e.message : "Processing failed.");
    throw e;
  }
}
