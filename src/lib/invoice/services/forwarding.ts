import "server-only";
import { iQuery, iQueryOne, iExecute } from "../db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { getAccountAccessToken } from "./gmail";
import { gmailGetRaw, gmailGetAttachment, gmailSend } from "../gmail/api";
import { GmailApiError } from "../gmail/oauth";

/**
 * Invoice email forwarding to the Finance & Accounts destination.
 *
 * Review-first: the sync queues forward tasks; this service only SENDS tasks
 * that are in the "approved" state (set either by auto-forward on the account,
 * or by a human approving in the UI / via the agent). Forwarding is idempotent
 * (unique email+destination key + a status guard), and the entire original
 * message is attached as `original.eml` so Finance keeps it intact.
 */

export interface ForwardingSettings {
  financeDestination: string | null;
  minConfidence: number;
  enabled: boolean;
}

export async function getForwardingSettings(organizationId: string): Promise<ForwardingSettings> {
  const row = await iQueryOne<{ finance_destination: string | null; min_confidence: string; enabled: boolean }>(
    "SELECT finance_destination, min_confidence, enabled FROM `forwarding_settings` WHERE organization_id=?",
    [organizationId],
  );
  return {
    financeDestination: row?.finance_destination ?? null,
    minConfidence: Number(row?.min_confidence ?? 70),
    enabled: row?.enabled ?? true,
  };
}

export async function saveForwardingSettings(
  organizationId: string,
  actor: { id: string; email: string },
  input: { financeDestination: string | null; minConfidence: number; enabled: boolean },
): Promise<void> {
  await iExecute(
    "INSERT INTO `forwarding_settings` (`organization_id`,`finance_destination`,`min_confidence`,`enabled`) VALUES (?,?,?,?) " +
      "ON DUPLICATE KEY UPDATE `finance_destination`=VALUES(`finance_destination`), `min_confidence`=VALUES(`min_confidence`), `enabled`=VALUES(`enabled`)",
    [organizationId, input.financeDestination, input.minConfidence.toFixed(2), input.enabled],
  );
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "forwarding.settings_saved",
    entityType: "forwarding_settings",
    entityId: organizationId,
    after: { destination: input.financeDestination, minConfidence: input.minConfidence, enabled: input.enabled },
  });
}

// --- CC recipients ----------------------------------------------------------

export interface CcRecipient {
  id: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate + normalize an email address, or null when it is not valid. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 320 ? email : null;
}

/** All CC recipients for an org (applied to every forwarded invoice). */
export async function listCcRecipients(organizationId: string): Promise<CcRecipient[]> {
  return iQuery<CcRecipient>(
    "SELECT `id`, `email` FROM `forwarding_cc_recipients` WHERE organization_id=? ORDER BY `email` ASC",
    [organizationId],
  );
}

/** Add a CC recipient (idempotent — duplicates are ignored). Returns the outcome. */
export async function addCcRecipient(
  organizationId: string,
  rawEmail: string,
): Promise<{ ok: boolean; message: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, message: "Enter a valid email address." };
  const res = await iExecute(
    "INSERT INTO `forwarding_cc_recipients` (`id`,`organization_id`,`email`) VALUES (?,?,?) " +
      "ON DUPLICATE KEY UPDATE `id`=`id`",
    [createId(), organizationId, email],
  );
  return res.affectedRows === 0
    ? { ok: false, message: "That CC address is already added." }
    : { ok: true, message: `Added ${email} to CC.` };
}

/** Remove a CC recipient by id (scoped to the org). */
export async function removeCcRecipient(organizationId: string, id: string): Promise<void> {
  await iExecute("DELETE FROM `forwarding_cc_recipients` WHERE organization_id=? AND id=?", [organizationId, id]);
}

/** Edit a CC recipient's address (validated + de-duplicated). */
export async function updateCcRecipient(
  organizationId: string,
  id: string,
  rawEmail: string,
): Promise<{ ok: boolean; message: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, message: "Enter a valid email address." };
  const dupe = await iQueryOne<{ id: string }>(
    "SELECT `id` FROM `forwarding_cc_recipients` WHERE organization_id=? AND email=? AND id<>?",
    [organizationId, email, id],
  );
  if (dupe) return { ok: false, message: "That CC address is already added." };
  await iExecute("UPDATE `forwarding_cc_recipients` SET `email`=? WHERE organization_id=? AND id=?", [
    email,
    organizationId,
    id,
  ]);
  return { ok: true, message: `Updated CC to ${email}.` };
}

export interface ForwardRow {
  id: string;
  organization_id: string;
  gmail_integration_id: string;
  email_message_id: string;
  source_gmail_message_id: string;
  destination: string;
  status: string;
  confidence: string | null;
  forwarded_message_id: string | null;
  attempts: number;
  last_error: string | null;
  forwarded_at: Date | null;
  created_at: Date;
  // joined
  subject: string | null;
  from_address: string | null;
  account_email: string | null;
  received_at: Date | string | null;
}

export async function listForwards(
  organizationId: string,
  opts: { status?: string; limit?: number } = {},
): Promise<ForwardRow[]> {
  const where: string[] = ["f.organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (opts.status) {
    where.push("f.status = ?");
    params.push(opts.status);
  }
  params.push(opts.limit ?? 200);
  return iQuery<ForwardRow>(
    "SELECT f.*, m.subject, m.from_address, m.received_at, g.email AS account_email " +
      "FROM `invoice_forwards` f " +
      "LEFT JOIN `email_messages` m ON m.id = f.email_message_id " +
      "LEFT JOIN `gmail_integrations` g ON g.id = f.gmail_integration_id " +
      `WHERE ${where.join(" AND ")} ORDER BY f.created_at DESC LIMIT ?`,
    params,
  );
}

/** Fetch a single forward task (with the joined fields sendForward needs). */
async function getForward(organizationId: string, forwardId: string): Promise<ForwardRow | null> {
  return iQueryOne<ForwardRow>(
    "SELECT f.*, m.subject, m.from_address, m.received_at, g.email AS account_email " +
      "FROM `invoice_forwards` f " +
      "LEFT JOIN `email_messages` m ON m.id = f.email_message_id " +
      "LEFT JOIN `gmail_integrations` g ON g.id = f.gmail_integration_id " +
      "WHERE f.organization_id=? AND f.id=?",
    [organizationId, forwardId],
  );
}

export async function forwardCounts(organizationId: string): Promise<Record<string, number>> {
  const rows = await iQuery<{ status: string; c: number }>(
    "SELECT status, COUNT(*) c FROM `invoice_forwards` WHERE organization_id=? GROUP BY status",
    [organizationId],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = Number(r.c);
  return out;
}

// --- Sending ---------------------------------------------------------------

function cleanHeader(v: string): string {
  return v.replace(/[\r\n]+/g, " ").slice(0, 900);
}

/** RFC 2047-encode a header value when it contains non-ASCII (UTF-8 subjects). */
function encodeHeaderWord(v: string): string {
  if (/^[\x00-\x7F]*$/.test(v)) return v;
  return `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function wrap76(b64: string): string {
  return (b64.match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Sanitize an attachment filename for a MIME header (no CRLF or quotes). */
function cleanFilename(name: string): string {
  const safe = (name || "attachment").replace(/[\r\n"\\]+/g, " ").trim().slice(0, 200) || "attachment";
  return safe;
}

export interface ForwardAttachment {
  filename: string;
  mimeType: string;
  contentBase64: string; // standard base64 of the raw bytes
}

/**
 * Build an RFC822 forward. The ACTUAL invoice attachments (PDFs/images) are
 * attached directly, each with its original filename + MIME type, so the Finance
 * mailbox can open them without digging into original.eml. The complete original
 * email is ALSO attached as original.eml. CC recipients are added to the header.
 */
export function buildForwardMime(input: {
  destination: string;
  cc?: string[];
  subject: string;
  from: string;
  date: string;
  confidence: string | null;
  rawOriginalBase64Url: string;
  attachments?: ForwardAttachment[];
}): string {
  const boundary = `atlasinv_${createId()}`;
  const emlStandardB64 = wrap76(Buffer.from(input.rawOriginalBase64Url, "base64url").toString("base64"));
  const attachments = input.attachments ?? [];
  const cc = (input.cc ?? []).map((e) => cleanHeader(e)).filter(Boolean);

  const text =
    "Forwarded automatically by the Atlas Invoice Agent.\r\n\r\n" +
    `Original From: ${cleanHeader(input.from)}\r\n` +
    `Original Date: ${cleanHeader(input.date)}\r\n` +
    `Original Subject: ${cleanHeader(input.subject)}\r\n` +
    (input.confidence ? `Invoice confidence: ${Math.round(Number(input.confidence))}%\r\n` : "") +
    (attachments.length
      ? `\r\n${attachments.length} invoice attachment(s) are attached directly: ${attachments.map((a) => cleanFilename(a.filename)).join(", ")}.\r\n`
      : "") +
    "The complete original email is also attached as original.eml.\r\n";

  // Each actual attachment, with its real filename + MIME type.
  const attachmentParts = attachments
    .map(
      (a) =>
        `--${boundary}\r\n` +
        `Content-Type: ${cleanHeader(a.mimeType || "application/octet-stream")}; name="${cleanFilename(a.filename)}"\r\n` +
        `Content-Disposition: attachment; filename="${cleanFilename(a.filename)}"\r\n` +
        "Content-Transfer-Encoding: base64\r\n\r\n" +
        `${wrap76(a.contentBase64)}\r\n`,
    )
    .join("");

  return (
    `To: ${cleanHeader(input.destination)}\r\n` +
    (cc.length ? `Cc: ${cc.join(", ")}\r\n` : "") +
    `Subject: ${encodeHeaderWord("Fwd: " + cleanHeader(input.subject || "(no subject)"))}\r\n` +
    "MIME-Version: 1.0\r\n" +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: text/plain; charset="UTF-8"\r\n' +
    "Content-Transfer-Encoding: 8bit\r\n\r\n" +
    `${text}\r\n` +
    attachmentParts +
    `--${boundary}\r\n` +
    "Content-Type: message/rfc822\r\n" +
    'Content-Disposition: attachment; filename="original.eml"\r\n' +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    `${emlStandardB64}\r\n` +
    `--${boundary}--\r\n`
  );
}

/**
 * Send one approved forward. Idempotent AND concurrency-safe: the task is first
 * atomically claimed (approved -> sending) so that two runners (worker loop,
 * cron, sync cadence) can never send the same email twice. A task not in the
 * 'approved' state is skipped.
 */
async function sendForward(
  organizationId: string,
  forward: ForwardRow,
): Promise<"forwarded" | "failed" | "skipped" | "unknown"> {
  if (forward.status === "forwarded") return "forwarded";

  // Atomic claim — only the runner whose UPDATE flips 'approved' -> 'sending' proceeds.
  const claim = await iExecute(
    "UPDATE `invoice_forwards` SET `status`='sending', `attempts`=`attempts`+1, `last_error`=NULL WHERE id=? AND `status`='approved'",
    [forward.id],
  );
  if (claim.affectedRows === 0) return "skipped"; // already claimed/sent by another runner

  // --- Stage 1: prepare the message. A failure here is BEFORE the send, so the
  // email was definitely not sent and the task is safely marked failed. ---
  let token: string;
  let mime: string;
  try {
    token = await getAccountAccessToken(organizationId, forward.gmail_integration_id);
    const raw = await gmailGetRaw(token, forward.source_gmail_message_id);

    // Re-download the ACTUAL invoice attachments (PDFs/images) so they are
    // attached directly to the forward, with their original filenames + types.
    const attRows = await iQuery<{ filename: string; mime_type: string; gmail_attachment_id: string | null }>(
      "SELECT `filename`, `mime_type`, `gmail_attachment_id` FROM `email_attachments` " +
        "WHERE email_message_id=? AND gmail_attachment_id IS NOT NULL",
      [forward.email_message_id],
    );
    const attachments: ForwardAttachment[] = [];
    for (const a of attRows) {
      try {
        const bytes = await gmailGetAttachment(token, forward.source_gmail_message_id, a.gmail_attachment_id as string);
        attachments.push({ filename: a.filename, mimeType: a.mime_type, contentBase64: bytes.toString("base64") });
      } catch {
        /* skip an attachment that can't be fetched; original.eml still carries it */
      }
    }
    const cc = (await listCcRecipients(organizationId)).map((r) => r.email);
    mime = buildForwardMime({
      destination: forward.destination,
      cc,
      subject: forward.subject ?? "",
      from: forward.from_address ?? "",
      date: forward.received_at ? new Date(forward.received_at).toUTCString() : "",
      confidence: forward.confidence,
      rawOriginalBase64Url: raw,
      attachments,
    });
  } catch (e) {
    await iExecute("UPDATE `invoice_forwards` SET `status`='failed', `last_error`=? WHERE id=?", [
      `Could not prepare the forward (not sent): ${(e instanceof Error ? e.message : "error").slice(0, 900)}`,
      forward.id,
    ]);
    return "failed";
  }

  // --- Stage 2: the actual send. This is where the outcome can be AMBIGUOUS. ---
  let sent: { id: string; threadId: string };
  try {
    sent = await gmailSend(token, Buffer.from(mime, "utf8").toString("base64url"));
  } catch (e) {
    // Classify the failure carefully. A message is marked 'failed' (definitely
    // NOT sent) ONLY when Gmail answered with a client-side rejection — the
    // request itself was bad/unauthorized, so it certainly was not delivered
    // and re-sending it unchanged would not help:
    //   400 Bad Request · 401 Unauthorized · 403 Forbidden ·
    //   404 Not Found    · 422 Unprocessable Entity
    // EVERYTHING ELSE is treated as AMBIGUOUS and parked in 'review':
    //   - 5xx server errors (500/502/503/504): Gmail may have accepted the
    //     message and then failed to answer — we cannot know it was not sent.
    //   - 429 rate limit / 408 timeout: uncertain, possibly partially handled.
    //   - a raw network drop / the 30s client timeout (gmailSend does not wrap
    //     these in a GmailApiError): classic unknown outcome.
    // Ambiguous outcomes are NEVER retried automatically; a human verifies the
    // mailbox before deciding. (We never mark them 'failed' — that would risk a
    // human re-sending a message Gmail had, in fact, already delivered.)
    const DEFINITE_REJECTION = new Set([400, 401, 403, 404, 422]);
    const status = e instanceof GmailApiError ? e.status : 0;
    const definite = e instanceof GmailApiError && DEFINITE_REJECTION.has(status);
    const msg = (e instanceof Error ? e.message : "send error").slice(0, 900);
    await iExecute("UPDATE `invoice_forwards` SET `status`=?, `last_error`=? WHERE id=?", [
      definite ? "failed" : "review",
      definite
        ? `Forward rejected by Gmail (not sent, HTTP ${status}): ${msg}`
        : `Send result UNKNOWN${status ? ` (HTTP ${status} — uncertain server response)` : " (network/timeout)"} — ` +
          `the email may or may not have been sent. Verify in the mailbox before re-sending; it was NOT retried automatically. ${msg}`,
      forward.id,
    ]);
    return definite ? "failed" : "unknown";
  }

  // --- Stage 3: Gmail ACCEPTED the send. Record it. A DB failure here must NOT
  // mark the task failed (it WAS sent) and must NOT return it to 'approved'
  // (which would resend). If the write fails, the row stays 'sending' for
  // reconciliation — never auto-resent, because only 'approved' is retried. ---
  try {
    await iExecute(
      "UPDATE `invoice_forwards` SET `status`='forwarded', `forwarded_message_id`=?, `forwarded_at`=NOW(3), `last_error`=NULL WHERE id=?",
      [sent.id, forward.id],
    );
  } catch {
    /* sent successfully but the status write failed; leave 'sending' for reconciliation */
  }
  await logInvoiceAudit({
    organizationId,
    actorType: "agent",
    action: "invoice.forwarded",
    entityType: "invoice_forward",
    entityId: forward.id,
    metadata: { destination: forward.destination, sourceMessageId: forward.source_gmail_message_id, sentMessageId: sent.id },
  }).catch(() => undefined);
  return "forwarded";
}

/** Process all approved forwards for an org. */
export async function runForwarding(
  organizationId: string,
): Promise<{ forwarded: number; failed: number; unknown: number; pending: number }> {
  const approved = await listForwards(organizationId, { status: "approved", limit: 100 });
  let forwarded = 0;
  let failed = 0;
  let unknown = 0;
  for (const f of approved) {
    const r = await sendForward(organizationId, f);
    if (r === "forwarded") forwarded += 1;
    else if (r === "failed") failed += 1;
    else if (r === "unknown") unknown += 1; // ambiguous send — parked for review, NOT retried
    // "skipped" => another runner claimed it; don't count.
  }
  const pendingRow = await iQueryOne<{ c: number }>(
    "SELECT COUNT(*) c FROM `invoice_forwards` WHERE organization_id=? AND status IN ('pending','review')",
    [organizationId],
  );
  return { forwarded, failed, unknown, pending: Number(pendingRow?.c ?? 0) };
}

/** Human approval → send now. Returns the result for the UI/agent. */
export async function approveAndForward(
  organizationId: string,
  actor: { id: string; email: string },
  forwardId: string,
): Promise<{ ok: boolean; message: string }> {
  const row = await getForward(organizationId, forwardId);
  if (!row) return { ok: false, message: "Forward task not found." };
  if (row.status === "forwarded") return { ok: true, message: "Already forwarded." };
  // Only move to 'approved' from a non-terminal state (never re-open a forwarded one).
  await iExecute(
    "UPDATE `invoice_forwards` SET `status`='approved', `approved_by`=? WHERE id=? AND `status` IN ('pending','review','failed','approved')",
    [actor.id, forwardId],
  );
  const result = await sendForward(organizationId, { ...row, status: "approved" });
  if (result === "forwarded") return { ok: true, message: "Forwarded to Finance & Accounts." };
  if (result === "unknown") {
    return {
      ok: false,
      message: "Send result unknown (network/timeout) — the email may or may not have been sent. Check the mailbox before re-sending; it was not retried automatically.",
    };
  }
  if (result === "skipped") {
    // Another runner was mid-send or finished; report the real outcome.
    const now = await iQueryOne<{ status: string }>("SELECT status FROM `invoice_forwards` WHERE id=?", [forwardId]);
    return now?.status === "forwarded"
      ? { ok: true, message: "Already forwarded to Finance & Accounts." }
      : { ok: true, message: "Forwarding is already in progress." };
  }
  return { ok: false, message: "Forwarding failed — see the exception." };
}

/**
 * Forward a specific invoice email by its email_messages id: ensure a forward
 * task to the configured destination exists, approve it, and send. Used by the
 * AI agent's forward_invoice_email tool (after human approval).
 */
export async function forwardEmailById(
  organizationId: string,
  actor: { id: string; email: string },
  emailMessageId: string,
): Promise<{ ok: boolean; message: string }> {
  const settings = await getForwardingSettings(organizationId);
  if (!settings.enabled || !settings.financeDestination) {
    return { ok: false, message: "No Finance & Accounts destination is configured (set it in Agent Settings)." };
  }
  const email = await iQueryOne<{ id: string; gmail_integration_id: string; gmail_message_id: string; classification_confidence: string | null }>(
    "SELECT id, gmail_integration_id, gmail_message_id, classification_confidence FROM `email_messages` WHERE organization_id=? AND id=?",
    [organizationId, emailMessageId],
  );
  if (!email) return { ok: false, message: "Email not found." };

  // Idempotent create: both unique keys ((email_message_id,destination) and
  // (org,source_gmail_message_id,destination)) make this a no-op if a forward
  // for this Gmail message already exists — never a second forward row.
  const newId = createId();
  await iExecute(
    "INSERT INTO `invoice_forwards` (`id`,`organization_id`,`gmail_integration_id`,`email_message_id`,`source_gmail_message_id`,`destination`,`status`,`confidence`) " +
      "VALUES (?,?,?,?,?,?,'approved',?) ON DUPLICATE KEY UPDATE `id`=`id`",
    [newId, organizationId, email.gmail_integration_id, emailMessageId, email.gmail_message_id, settings.financeDestination, email.classification_confidence],
  );
  const row = await iQueryOne<{ id: string }>(
    "SELECT id FROM `invoice_forwards` WHERE organization_id=? AND source_gmail_message_id=? AND destination=?",
    [organizationId, email.gmail_message_id, settings.financeDestination],
  );
  const forwardId = row?.id ?? newId;
  return approveAndForward(organizationId, actor, forwardId);
}

export async function rejectForward(
  organizationId: string,
  actor: { id: string; email: string },
  forwardId: string,
): Promise<void> {
  await iExecute("UPDATE `invoice_forwards` SET `status`='skipped', `approved_by`=? WHERE organization_id=? AND id=?", [
    actor.id,
    organizationId,
    forwardId,
  ]);
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "forwarding.rejected",
    entityType: "invoice_forward",
    entityId: forwardId,
  });
}
