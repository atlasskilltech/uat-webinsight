"use server";

import { getInvoiceContext } from "@/lib/invoice/org";
import { classifyEmail } from "@/lib/invoice/services/gmail";
import { getForwardingSettings, buildForwardMime } from "@/lib/invoice/services/forwarding";

/**
 * "Try a sample invoice" — a SAFE, read-only demonstration. It runs the REAL
 * classifier, the REAL forwarding-decision logic (against this org's configured
 * threshold + Finance destination), and the REAL .eml builder on a bundled
 * sample email. It writes NOTHING to the database and sends NO email — it just
 * shows how an incoming invoice email would be detected, decided, and forwarded.
 */

export interface SampleDemoResult {
  ok: boolean;
  error?: string;
  sample?: { subject: string; from: string; snippet: string };
  classification?: string;
  isCandidate?: boolean;
  confidence?: number; // percent
  threshold?: number;
  destination?: string | null;
  decision?: string;
  emlPreview?: string;
}

const SAMPLE = {
  from: "Acme Supplies Pvt Ltd <accounts@acme-supplies.example>",
  to: "ap@yourcompany.example",
  subject: "Tax Invoice INV-2026-0042 — Acme Supplies Pvt Ltd",
  snippet:
    "Please find attached our Tax Invoice INV-2026-0042 for ₹1,18,000 (incl. 18% GST). GSTIN 27AACCA1234F1Z5. Payment terms: Net 30.",
};

function sampleRawEmail(): string {
  return [
    `From: ${SAMPLE.from}`,
    `To: ${SAMPLE.to}`,
    `Subject: ${SAMPLE.subject}`,
    `Date: ${new Date().toUTCString()}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    "Dear Accounts Team,",
    "",
    "Please find attached our Tax Invoice INV-2026-0042 dated 20-Nov-2026 for the",
    "supply of office equipment.",
    "",
    "Invoice total: ₹1,18,000.00 (incl. 18% GST)",
    "GSTIN: 27AACCA1234F1Z5",
    "Payment terms: Net 30",
    "",
    "Regards,",
    "Acme Supplies Pvt Ltd",
    "",
    "[Attachment: invoice-INV-2026-0042.pdf]",
  ].join("\r\n");
}

export async function runSampleInvoiceDemo(): Promise<SampleDemoResult> {
  const ctx = await getInvoiceContext();
  if (!ctx?.organizationId) {
    return { ok: false, error: "Finish setup (create your organization) before running the demo." };
  }

  // 1) REAL classification — same function the Gmail sync uses.
  const c = classifyEmail({
    subject: SAMPLE.subject,
    from: SAMPLE.from,
    snippet: SAMPLE.snippet,
    hasAttachment: true,
    attachmentNames: ["invoice-INV-2026-0042.pdf"],
  });
  const confidence = Math.round(c.confidence * 100);

  // 2) This org's real forwarding settings (destination + confidence threshold).
  const settings = await getForwardingSettings(ctx.organizationId);
  const threshold = settings.minConfidence;
  const destination = settings.financeDestination;

  // 3) The forwarding DECISION, exactly as the pipeline would make it.
  let decision: string;
  if (!c.isInvoiceCandidate) {
    decision = "Not detected as an invoice — it would be ignored (no forward).";
  } else if (!destination) {
    decision = `Detected as an invoice (${confidence}%). Set a Finance & Accounts destination in Agent Settings to enable forwarding.`;
  } else if (confidence >= threshold) {
    decision =
      `Detected (${confidence}% ≥ ${threshold}% threshold). On a mailbox with auto-forward ON it forwards automatically to ${destination}; ` +
      `with auto-forward OFF it waits in your approval queue.`;
  } else {
    decision =
      `Detected but low confidence (${confidence}% < ${threshold}% threshold) — it goes to the review queue for you to confirm ` +
      `before forwarding to ${destination}.`;
  }

  // 4) The ACTUAL .eml that would be forwarded (original attached as original.eml).
  const rawOriginalBase64Url = Buffer.from(sampleRawEmail(), "utf8").toString("base64url");
  const mime = buildForwardMime({
    destination: destination ?? "finance-accounts@yourcompany.example",
    subject: SAMPLE.subject,
    from: SAMPLE.from,
    date: new Date().toUTCString(),
    confidence: String(confidence),
    rawOriginalBase64Url,
  });
  // Show the human-readable head of the forward (headers + text part), not the
  // long base64 original.eml blob.
  const emlPreview = mime.split("Content-Type: message/rfc822")[0].trimEnd();

  return {
    ok: true,
    sample: { subject: SAMPLE.subject, from: SAMPLE.from, snippet: SAMPLE.snippet },
    classification: c.classification,
    isCandidate: c.isInvoiceCandidate,
    confidence,
    threshold,
    destination,
    decision,
    emlPreview,
  };
}
