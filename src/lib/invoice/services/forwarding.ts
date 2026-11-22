import "server-only";
import { iQuery, iQueryOne, iExecute } from "../db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { getAccountAccessToken } from "./gmail";
import { gmailGetRaw, gmailSend } from "../gmail/api";

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

/** Build an RFC822 forward with the full original attached as original.eml. */
export function buildForwardMime(input: {
  destination: string;
  subject: string;
  from: string;
  date: string;
  confidence: string | null;
  rawOriginalBase64Url: string;
}): string {
  const boundary = `atlasinv_${createId()}`;
  const emlStandardB64 = wrap76(Buffer.from(input.rawOriginalBase64Url, "base64url").toString("base64"));
  const text =
    "Forwarded automatically by the Atlas Invoice Agent.\r\n\r\n" +
    `Original From: ${cleanHeader(input.from)}\r\n` +
    `Original Date: ${cleanHeader(input.date)}\r\n` +
    `Original Subject: ${cleanHeader(input.subject)}\r\n` +
    (input.confidence ? `Invoice confidence: ${Math.round(Number(input.confidence))}%\r\n` : "") +
    "\r\nThe complete original email (including its attachments) is attached as original.eml.\r\n";

  return (
    `To: ${cleanHeader(input.destination)}\r\n` +
    `Subject: ${encodeHeaderWord("Fwd: " + cleanHeader(input.subject || "(no subject)"))}\r\n` +
    "MIME-Version: 1.0\r\n" +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: text/plain; charset="UTF-8"\r\n' +
    "Content-Transfer-Encoding: 8bit\r\n\r\n" +
    `${text}\r\n` +
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
): Promise<"forwarded" | "failed" | "skipped"> {
  if (forward.status === "forwarded") return "forwarded";

  // Atomic claim — only the runner whose UPDATE flips 'approved' -> 'sending' proceeds.
  const claim = await iExecute(
    "UPDATE `invoice_forwards` SET `status`='sending', `attempts`=`attempts`+1, `last_error`=NULL WHERE id=? AND `status`='approved'",
    [forward.id],
  );
  if (claim.affectedRows === 0) return "skipped"; // already claimed/sent by another runner

  try {
    const token = await getAccountAccessToken(organizationId, forward.gmail_integration_id);
    const raw = await gmailGetRaw(token, forward.source_gmail_message_id);
    const mime = buildForwardMime({
      destination: forward.destination,
      subject: forward.subject ?? "",
      from: forward.from_address ?? "",
      date: forward.received_at ? new Date(forward.received_at).toUTCString() : "",
      confidence: forward.confidence,
      rawOriginalBase64Url: raw,
    });
    const sent = await gmailSend(token, Buffer.from(mime, "utf8").toString("base64url"));
    await iExecute(
      "UPDATE `invoice_forwards` SET `status`='forwarded', `forwarded_message_id`=?, `forwarded_at`=NOW(3), `attempts`=`attempts`+1, `last_error`=NULL WHERE id=?",
      [sent.id, forward.id],
    );
    await logInvoiceAudit({
      organizationId,
      actorType: "agent",
      action: "invoice.forwarded",
      entityType: "invoice_forward",
      entityId: forward.id,
      metadata: { destination: forward.destination, sourceMessageId: forward.source_gmail_message_id, sentMessageId: sent.id },
    });
    return "forwarded";
  } catch (e) {
    await iExecute(
      "UPDATE `invoice_forwards` SET `status`='failed', `attempts`=`attempts`+1, `last_error`=? WHERE id=?",
      [(e instanceof Error ? e.message : "forward failed").slice(0, 1000), forward.id],
    );
    return "failed";
  }
}

/** Process all approved forwards for an org. */
export async function runForwarding(organizationId: string): Promise<{ forwarded: number; failed: number; pending: number }> {
  const approved = await listForwards(organizationId, { status: "approved", limit: 100 });
  let forwarded = 0;
  let failed = 0;
  for (const f of approved) {
    const r = await sendForward(organizationId, f);
    if (r === "forwarded") forwarded += 1;
    else if (r === "failed") failed += 1;
    // "skipped" => another runner claimed it; don't count.
  }
  const pendingRow = await iQueryOne<{ c: number }>(
    "SELECT COUNT(*) c FROM `invoice_forwards` WHERE organization_id=? AND status IN ('pending','review')",
    [organizationId],
  );
  return { forwarded, failed, pending: Number(pendingRow?.c ?? 0) };
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

  const existing = await iQueryOne<{ id: string }>(
    "SELECT id FROM `invoice_forwards` WHERE email_message_id=? AND destination=?",
    [emailMessageId, settings.financeDestination],
  );
  let forwardId = existing?.id;
  if (!forwardId) {
    forwardId = createId();
    await iExecute(
      "INSERT INTO `invoice_forwards` (`id`,`organization_id`,`gmail_integration_id`,`email_message_id`,`source_gmail_message_id`,`destination`,`status`,`confidence`) " +
        "VALUES (?,?,?,?,?,?,'approved',?)",
      [forwardId, organizationId, email.gmail_integration_id, emailMessageId, email.gmail_message_id, settings.financeDestination, email.classification_confidence],
    );
  }
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
