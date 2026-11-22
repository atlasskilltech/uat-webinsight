import "server-only";
import { iQuery, iQueryOne, iExecute } from "../db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { encryptSecret, decryptSecret } from "../crypto";
import {
  refreshGmailToken,
  GmailApiError,
  GMAIL_SCOPE_LABEL,
  type GmailTokens,
} from "../gmail/oauth";
import {
  gmailListMessages,
  gmailGetMessage,
  gmailGetAttachment,
  collectAttachments,
  isSupportedAttachment,
  getHeader,
  gmailGetProfile,
  gmailListHistory,
  gmailWatch,
  gmailStopWatch,
} from "../gmail/api";
import { processUploadedDocument } from "./processing";

export interface GmailIntegrationRow {
  id: string;
  organization_id: string;
  email: string;
  google_sub: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: Date | null;
  scopes: string | null;
  history_id: string | null;
  status: string;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GmailAccountView extends GmailIntegrationRow {
  message_count: number;
  invoice_count: number;
  last_sync_at: Date | null;
  consecutive_failures: number;
}

export async function listGmailAccounts(organizationId: string): Promise<GmailAccountView[]> {
  return iQuery<GmailAccountView>(
    "SELECT g.*, " +
      "(SELECT COUNT(*) FROM `email_messages` m WHERE m.gmail_integration_id=g.id) AS message_count, " +
      "(SELECT COUNT(*) FROM `invoices` i WHERE i.source_email_message_id IN " +
      "   (SELECT m.id FROM `email_messages` m WHERE m.gmail_integration_id=g.id)) AS invoice_count, " +
      "(SELECT s.last_incremental_sync_at FROM `gmail_sync_states` s WHERE s.gmail_integration_id=g.id) AS last_sync_at, " +
      "COALESCE((SELECT s.consecutive_failures FROM `gmail_sync_states` s WHERE s.gmail_integration_id=g.id),0) AS consecutive_failures " +
      "FROM `gmail_integrations` g WHERE g.organization_id=? ORDER BY g.email ASC",
    [organizationId],
  );
}

/** Upsert a connected Gmail account (called from the OAuth callback). */
export async function upsertGmailIntegration(
  organizationId: string,
  actor: { id: string; email: string },
  account: { email: string; googleSub: string },
  tokens: GmailTokens,
): Promise<string> {
  const expiresAt = new Date(tokens.obtained_at + tokens.expires_in * 1000);
  const existing = await iQueryOne<{ id: string; refresh_token_enc: string | null }>(
    "SELECT id, refresh_token_enc FROM `gmail_integrations` WHERE organization_id=? AND email=?",
    [organizationId, account.email],
  );
  // Google only returns a refresh_token on first consent; keep the stored one if absent.
  const refreshEnc = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : existing?.refresh_token_enc ?? null;

  const id = existing?.id ?? createId();
  if (existing) {
    await iExecute(
      "UPDATE `gmail_integrations` SET `google_sub`=?,`access_token_enc`=?,`refresh_token_enc`=?,`token_expires_at`=?," +
        "`scopes`=?,`status`='connected',`last_error`=NULL,`connected_by`=? WHERE id=?",
      [account.googleSub, encryptSecret(tokens.access_token), refreshEnc, expiresAt, GMAIL_SCOPE_LABEL, actor.id, id],
    );
  } else {
    await iExecute(
      "INSERT INTO `gmail_integrations` (`id`,`organization_id`,`email`,`google_sub`,`access_token_enc`,`refresh_token_enc`," +
        "`token_expires_at`,`scopes`,`status`,`connected_by`) VALUES (?,?,?,?,?,?,?,?,'connected',?)",
      [id, organizationId, account.email, account.googleSub, encryptSecret(tokens.access_token), refreshEnc, expiresAt, GMAIL_SCOPE_LABEL, actor.id],
    );
    await iExecute(
      "INSERT INTO `gmail_sync_states` (`id`,`organization_id`,`gmail_integration_id`) VALUES (?,?,?)",
      [createId(), organizationId, id],
    );
  }
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "gmail.connected",
    entityType: "gmail_integration",
    entityId: id,
    metadata: { email: account.email },
  });
  return id;
}

export async function disconnectGmail(
  organizationId: string,
  id: string,
  actor: { id: string; email: string },
): Promise<void> {
  await iExecute(
    "UPDATE `gmail_integrations` SET `status`='disconnected',`access_token_enc`=NULL,`refresh_token_enc`=NULL,`token_expires_at`=NULL WHERE organization_id=? AND id=?",
    [organizationId, id],
  );
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "gmail.disconnected",
    entityType: "gmail_integration",
    entityId: id,
  });
}

/** Return a valid access token, refreshing if near expiry; handles revocation. */
async function getValidAccessToken(integration: GmailIntegrationRow): Promise<string> {
  const now = Date.now();
  const expMs = integration.token_expires_at ? new Date(integration.token_expires_at).getTime() : 0;
  const access = decryptSecret(integration.access_token_enc);
  if (access && now < expMs - 60_000) return access;

  const refresh = decryptSecret(integration.refresh_token_enc);
  if (!refresh) {
    await iExecute("UPDATE `gmail_integrations` SET `status`='reauth_required', `last_error`=? WHERE id=?", [
      "No refresh token — reconnect required.",
      integration.id,
    ]);
    throw new GmailApiError("No refresh token; reconnect the account.", 401, true);
  }
  try {
    const tokens = await refreshGmailToken(refresh);
    const expiresAt = new Date(tokens.obtained_at + tokens.expires_in * 1000);
    await iExecute(
      "UPDATE `gmail_integrations` SET `access_token_enc`=?,`token_expires_at`=?,`status`='connected',`last_error`=NULL WHERE id=?",
      [encryptSecret(tokens.access_token), expiresAt, integration.id],
    );
    return tokens.access_token;
  } catch (e) {
    if (e instanceof GmailApiError && e.permanent) {
      await iExecute("UPDATE `gmail_integrations` SET `status`='reauth_required', `last_error`=? WHERE id=?", [
        e.message,
        integration.id,
      ]);
    }
    throw e;
  }
}

export type EmailClassification =
  | "supplier_invoice"
  | "customer_request"
  | "payment_confirmation"
  | "remittance_advice"
  | "credit_note"
  | "purchase_order"
  | "general_finance"
  | "irrelevant";

/** Heuristic email classifier (deterministic; AI classification can slot in later). */
export function classifyEmail(input: {
  subject: string;
  from: string;
  snippet: string;
  hasAttachment: boolean;
}): { classification: EmailClassification; isInvoiceCandidate: boolean } {
  const t = `${input.subject} ${input.snippet}`.toLowerCase();
  const has = (...k: string[]) => k.some((w) => t.includes(w));

  let classification: EmailClassification = "irrelevant";
  if (has("credit note")) classification = "credit_note";
  else if (has("purchase order", "p.o.", " po ")) classification = "purchase_order";
  else if (has("remittance")) classification = "remittance_advice";
  else if (has("payment received", "payment confirmation", "paid")) classification = "payment_confirmation";
  else if (has("invoice", "tax invoice", "bill", "gstin", "gst invoice")) classification = "supplier_invoice";
  else if (has("quotation", "request for invoice", "please invoice")) classification = "customer_request";
  else if (has("statement", "account")) classification = "general_finance";

  const isInvoiceCandidate =
    input.hasAttachment && (classification === "supplier_invoice" || has("invoice", "bill", "tax invoice"));
  return { classification, isInvoiceCandidate };
}

export interface SyncSummary {
  scanned: number;
  newMessages: number;
  invoicesCreated: number;
  duplicates: number;
  errors: number;
  message: string;
}

/** Pull-based sync for one account: list → dedupe → classify → download → pipeline. */
export async function syncGmailAccount(
  organizationId: string,
  integrationId: string,
  actor: { id: string; email: string },
  opts: { maxMessages?: number } = {},
): Promise<SyncSummary> {
  const integration = await iQueryOne<GmailIntegrationRow>(
    "SELECT * FROM `gmail_integrations` WHERE organization_id=? AND id=?",
    [organizationId, integrationId],
  );
  if (!integration) throw new Error("Gmail account not found.");
  if (integration.status === "disconnected") throw new Error("Account is disconnected.");

  const summary: SyncSummary = { scanned: 0, newMessages: 0, invoicesCreated: 0, duplicates: 0, errors: 0, message: "" };

  try {
    const token = await getValidAccessToken(integration);
    const { refs: messages, nextHistoryId } = await selectMessageRefs(token, integration, opts.maxMessages ?? 25);
    summary.scanned = messages.length;

    for (const ref of messages) {
      try {
        const exists = await iQueryOne<{ id: string }>(
          "SELECT id FROM `email_messages` WHERE gmail_integration_id=? AND gmail_message_id=?",
          [integrationId, ref.id],
        );
        if (exists) continue;

        const msg = await gmailGetMessage(token, ref.id);
        const subject = getHeader(msg, "Subject") ?? "";
        const from = getHeader(msg, "From") ?? "";
        const to = getHeader(msg, "To") ?? "";
        const atts = collectAttachments(msg).filter(isSupportedAttachment);
        const { classification, isInvoiceCandidate } = classifyEmail({
          subject,
          from,
          snippet: msg.snippet ?? "",
          hasAttachment: atts.length > 0,
        });

        const emailMessageId = createId();
        const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : null;
        await iExecute(
          "INSERT INTO `email_messages` (`id`,`organization_id`,`gmail_integration_id`,`gmail_message_id`,`thread_id`," +
            "`from_address`,`to_address`,`subject`,`snippet`,`received_at`,`classification`,`is_invoice_candidate`,`processing_status`) " +
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            emailMessageId, organizationId, integrationId, ref.id, msg.threadId ?? null,
            from.slice(0, 320), to.slice(0, 320), subject, (msg.snippet ?? "").slice(0, 2000), receivedAt,
            classification, isInvoiceCandidate, isInvoiceCandidate ? "pending" : "skipped",
          ],
        );
        summary.newMessages += 1;

        if (!isInvoiceCandidate) continue;

        for (const a of atts) {
          const emailAttachmentId = createId();
          await iExecute(
            "INSERT INTO `email_attachments` (`id`,`organization_id`,`email_message_id`,`gmail_attachment_id`,`filename`,`mime_type`,`size_bytes`,`download_status`) " +
              "VALUES (?,?,?,?,?,?,?,'pending')",
            [emailAttachmentId, organizationId, emailMessageId, a.attachmentId, a.filename, a.mimeType, a.size],
          );
          try {
            const bytes = await gmailGetAttachment(token, ref.id, a.attachmentId);
            const result = await processUploadedDocument({
              organizationId,
              actor,
              direction: "incoming",
              filename: a.filename,
              mimeType: a.mimeType,
              buffer: bytes,
              source: "gmail",
              sourceEmailMessageId: emailMessageId,
              emailAttachmentId,
            });
            await iExecute(
              "UPDATE `email_attachments` SET `download_status`='downloaded', `sha256`=NULL WHERE id=?",
              [emailAttachmentId],
            );
            if (result.duplicate) summary.duplicates += 1;
            else summary.invoicesCreated += 1;
          } catch (attErr) {
            summary.errors += 1;
            await iExecute("UPDATE `email_attachments` SET `download_status`='failed' WHERE id=?", [emailAttachmentId]);
            void attErr;
          }
        }
        await iExecute("UPDATE `email_messages` SET `processing_status`='processed', `processed_at`=NOW(3) WHERE id=?", [
          emailMessageId,
        ]);
      } catch (msgErr) {
        summary.errors += 1;
        void msgErr;
      }
    }

    // Advance the stored history anchor so the next sync is incremental.
    if (nextHistoryId) {
      await iExecute("UPDATE `gmail_integrations` SET `history_id`=? WHERE id=?", [nextHistoryId, integrationId]);
    }
    await iExecute(
      "UPDATE `gmail_sync_states` SET `last_incremental_sync_at`=NOW(3), `last_history_id`=?, `consecutive_failures`=0, `backoff_until`=NULL, `last_error`=NULL WHERE gmail_integration_id=?",
      [nextHistoryId ?? integration.history_id, integrationId],
    );
    summary.message = `Scanned ${summary.scanned}; ${summary.invoicesCreated} invoice(s) created, ${summary.duplicates} duplicate(s), ${summary.errors} error(s).`;
    return summary;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed.";
    await iExecute(
      "UPDATE `gmail_sync_states` SET `consecutive_failures`=`consecutive_failures`+1, " +
        "`backoff_until`=DATE_ADD(NOW(3), INTERVAL 15 MINUTE), `last_error`=? WHERE gmail_integration_id=?",
      [msg.slice(0, 1000), integrationId],
    );
    throw e;
  }
}

// --- Incremental history sync + Gmail push (watch) --------------------------

/**
 * Choose the message ids to process: incrementally from the stored history
 * anchor when present (falling back to a full query if the anchor expired),
 * otherwise a bounded full query. Also returns the new history anchor to store.
 */
async function selectMessageRefs(
  token: string,
  integration: GmailIntegrationRow,
  max: number,
): Promise<{ refs: { id: string }[]; nextHistoryId: string | null }> {
  const profile = await gmailGetProfile(token).catch(() => null);

  if (integration.history_id) {
    const h = await gmailListHistory(token, integration.history_id);
    if (!h.expired) {
      return {
        refs: h.messageIds.slice(0, max).map((id) => ({ id })),
        nextHistoryId: h.historyId || profile?.historyId || integration.history_id,
      };
    }
    // History too old — fall through to a full reconciliation sync.
  }

  const days = Number(process.env.GMAIL_SYNC_DAYS) || 90;
  const query = process.env.GMAIL_QUERY?.trim() || `has:attachment newer_than:${days}d`;
  const { messages } = await gmailListMessages(token, query, max);
  return { refs: messages.map((m) => ({ id: m.id })), nextHistoryId: profile?.historyId ?? null };
}

/** Is Gmail push (watch + Pub/Sub) configured? When false, scheduled pull is the only path. */
export function pubsubConfigured(): boolean {
  return Boolean(process.env.GMAIL_PUBSUB_TOPIC?.trim());
}

/** Start (or refresh) a Gmail watch so new mail pushes to Pub/Sub. */
export async function startGmailWatch(organizationId: string, integrationId: string): Promise<void> {
  const topic = process.env.GMAIL_PUBSUB_TOPIC?.trim();
  if (!topic) throw new Error("Gmail push is not configured (set GMAIL_PUBSUB_TOPIC).");
  const integration = await iQueryOne<GmailIntegrationRow>(
    "SELECT * FROM `gmail_integrations` WHERE organization_id=? AND id=?",
    [organizationId, integrationId],
  );
  if (!integration) throw new Error("Gmail account not found.");
  const token = await getValidAccessToken(integration);
  const { historyId, expiration } = await gmailWatch(token, topic);
  const exp = expiration ? new Date(Number(expiration)) : null;
  await iExecute(
    "UPDATE `gmail_integrations` SET `history_id`=COALESCE(NULLIF(?, ''), `history_id`), `watch_expiration`=? WHERE id=?",
    [historyId, exp, integrationId],
  );
}

export async function stopGmailWatch(organizationId: string, integrationId: string): Promise<void> {
  const integration = await iQueryOne<GmailIntegrationRow>(
    "SELECT * FROM `gmail_integrations` WHERE organization_id=? AND id=?",
    [organizationId, integrationId],
  );
  if (!integration) return;
  const token = await getValidAccessToken(integration);
  await gmailStopWatch(token).catch(() => undefined);
  await iExecute("UPDATE `gmail_integrations` SET `watch_expiration`=NULL WHERE id=?", [integrationId]);
}

/** Renew watches that are missing or expiring within 24h. No-op if push is off. */
export async function renewDueWatches(): Promise<{ renewed: number; skipped: boolean }> {
  if (!pubsubConfigured()) return { renewed: 0, skipped: true };
  const rows = await iQuery<{ id: string; organization_id: string }>(
    "SELECT id, organization_id FROM `gmail_integrations` WHERE status='connected' " +
      "AND (watch_expiration IS NULL OR watch_expiration < DATE_ADD(NOW(3), INTERVAL 24 HOUR)) LIMIT 50",
  );
  let renewed = 0;
  for (const r of rows) {
    try {
      await startGmailWatch(r.organization_id, r.id);
      renewed += 1;
    } catch {
      /* recorded per-account; keep going */
    }
  }
  return { renewed, skipped: false };
}

/** Find a connected integration by its email (for the Pub/Sub push webhook). */
export async function findConnectedIntegrationByEmail(
  email: string,
): Promise<{ id: string; organization_id: string } | null> {
  return iQueryOne<{ id: string; organization_id: string }>(
    "SELECT id, organization_id FROM `gmail_integrations` WHERE email=? AND status='connected' LIMIT 1",
    [email.toLowerCase()],
  );
}
