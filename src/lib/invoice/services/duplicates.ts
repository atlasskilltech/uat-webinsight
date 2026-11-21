import "server-only";
import { iQuery, iExecute, ijson } from "../db";
import { createId } from "@/lib/id";

/**
 * Duplicate invoice detection. Never relies on invoice number alone — it weighs
 * document fingerprint, supplier identity + number, and amount + date + party.
 * Suspected duplicates are recorded and routed to review, never auto-deleted.
 */
export interface DuplicateCandidate {
  id: string; // the just-created invoice (excluded from matches)
  direction: "incoming" | "outgoing";
  partyId: string | null;
  invoiceNumber: string | null;
  grandTotal: string;
  invoiceDate: string | null;
  documentFingerprint: string | null;
}

export interface DuplicateMatch {
  matchedInvoiceId: string;
  score: number; // 0..100
  reasons: string[];
}

export async function detectDuplicates(
  organizationId: string,
  cand: DuplicateCandidate,
): Promise<DuplicateMatch[]> {
  const matches = new Map<string, DuplicateMatch>();
  const bump = (id: string, score: number, reason: string) => {
    const existing = matches.get(id);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    } else {
      matches.set(id, { matchedInvoiceId: id, score, reasons: [reason] });
    }
  };

  // 1) Identical stored document (strongest signal).
  if (cand.documentFingerprint) {
    const rows = await iQuery<{ id: string }>(
      "SELECT id FROM `invoices` WHERE organization_id=? AND direction=? AND document_fingerprint=? AND id<>? AND deleted_at IS NULL",
      [organizationId, cand.direction, cand.documentFingerprint, cand.id],
    );
    for (const r of rows) bump(r.id, 100, "identical_document");
  }

  // 2) Same party + same invoice number.
  if (cand.invoiceNumber && cand.partyId) {
    const rows = await iQuery<{ id: string }>(
      "SELECT id FROM `invoices` WHERE organization_id=? AND direction=? AND party_id=? AND invoice_number=? AND id<>? AND deleted_at IS NULL",
      [organizationId, cand.direction, cand.partyId, cand.invoiceNumber, cand.id],
    );
    for (const r of rows) bump(r.id, 90, "same_party_and_number");
  }

  // 3) Same party + same amount + invoice date within 3 days.
  if (cand.partyId && cand.invoiceDate) {
    const rows = await iQuery<{ id: string }>(
      "SELECT id FROM `invoices` WHERE organization_id=? AND direction=? AND party_id=? AND grand_total=? " +
        "AND invoice_date IS NOT NULL AND ABS(DATEDIFF(invoice_date, ?))<=3 AND id<>? AND deleted_at IS NULL",
      [organizationId, cand.direction, cand.partyId, cand.grandTotal, cand.invoiceDate, cand.id],
    );
    for (const r of rows) bump(r.id, 70, "same_amount_and_date");
  }

  const result = [...matches.values()].filter((m) => m.score >= 60).sort((a, b) => b.score - a.score);

  // Persist matches for the review UI.
  for (const m of result) {
    await iExecute(
      "INSERT INTO `invoice_duplicate_matches` (`id`,`organization_id`,`invoice_id`,`matched_invoice_id`,`score`,`reason`) " +
        "VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `score`=VALUES(`score`), `reason`=VALUES(`reason`)",
      [createId(), organizationId, cand.id, m.matchedInvoiceId, m.score.toFixed(2), ijson(m.reasons)],
    );
  }
  return result;
}
