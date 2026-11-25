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
import { enqueueJob } from "../jobs";
import {
  resolveForwardingPlan,
  listRules,
  listDestinations,
  listCategories,
} from "./routing";
import { listCcRecipients, listSenderFilters, evaluateSenderForward } from "./forwarding";
import { isOrganizationActive } from "./org-admin";

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
  auto_forward: boolean;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GmailAccountView extends GmailIntegrationRow {
  invoice_detected: number; // invoice emails detected (NOT ordinary email count)
  forwarded_count: number; // invoices forwarded to Finance
  pending_count: number; // invoices awaiting approval / review
  last_sync_at: Date | null;
  consecutive_failures: number;
}

export async function listGmailAccounts(organizationId: string): Promise<GmailAccountView[]> {
  // Counts are INVOICE-only — ordinary emails (newsletters, notifications, etc.)
  // never show up here, because only invoice candidates are counted.
  return iQuery<GmailAccountView>(
    "SELECT g.*, " +
      "(SELECT COUNT(*) FROM `email_messages` m WHERE m.gmail_integration_id=g.id AND m.is_invoice_candidate=1) AS invoice_detected, " +
      "(SELECT COUNT(*) FROM `invoice_forwards` f WHERE f.gmail_integration_id=g.id AND f.status='forwarded') AS forwarded_count, " +
      "(SELECT COUNT(*) FROM `invoice_forwards` f WHERE f.gmail_integration_id=g.id AND f.status IN ('pending','review')) AS pending_count, " +
      "(SELECT s.last_incremental_sync_at FROM `gmail_sync_states` s WHERE s.gmail_integration_id=g.id) AS last_sync_at, " +
      "COALESCE((SELECT s.consecutive_failures FROM `gmail_sync_states` s WHERE s.gmail_integration_id=g.id),0) AS consecutive_failures " +
      "FROM `gmail_integrations` g WHERE g.organization_id=? ORDER BY g.email ASC",
    [organizationId],
  );
}

/**
 * True when a message was sent by the connected account itself (its own Sent
 * mail / the agent's own forwards). These are NEVER ingested — ingesting them
 * would re-detect the agent's forwarded invoice and forward it again, looping
 * every sync. Combined with the `in:inbox` query, this keeps processing to
 * genuinely incoming mail only.
 */
export function isSelfSent(fromHeader: string, accountEmail: string): boolean {
  const acct = accountEmail.trim().toLowerCase();
  return acct.length > 0 && fromHeader.toLowerCase().includes(acct);
}

export type ForwardStatus = "approved" | "pending" | "review";

/**
 * The forward-task status for a DETECTED invoice: below the threshold → review;
 * at/above → auto-forward when the mailbox has it on, otherwise wait for approval.
 */
export function decideForwardStatus(confPct: number, minConfidence: number, autoForward: boolean): ForwardStatus {
  if (confPct < minConfidence) return "review";
  return autoForward ? "approved" : "pending";
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
  // Register a Gmail push watch right away when Pub/Sub is configured, so the
  // account gets real-time notifications immediately after connecting (the
  // worker's renewDueWatches also recovers / renews it). Best-effort — a failure
  // here never blocks connecting; the polling fallback still covers the account.
  if (pubsubConfigured()) {
    await startGmailWatch(organizationId, id).catch(() => undefined);
  }
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

/** An attachment filename that looks like an invoice/bill/receipt document. */
const INVOICE_FILENAME = /invoice|tax[-_ ]?invoice|e[-_ ]?invoice|proforma|\binv[-_ ]?\d|\bbill[-_ ]?\d|billing|\breceipt/i;

/**
 * Heuristic email classifier (deterministic; AI classification can slot in
 * later). An email is an invoice candidate when it carries a supported
 * attachment AND either the subject/snippet mentions an invoice OR the
 * attachment itself is named like an invoice (e.g. "Invoice-123.pdf") — many
 * real invoices arrive with a generic subject and the word only inside the PDF.
 */
/**
 * A document-category key the routing rules match on. The classifier produces
 * the four SYSTEM categories; organization-specific CUSTOM categories are
 * detected separately in the sync loop (which has the org's category list).
 */
export type DocumentCategoryKey = "invoice" | "purchase_order" | "statement" | "other";

/**
 * The forward GATE. An email is forwarded only when it has a resolved
 * destination (this organization's own — never another's) AND either it is a
 * business-document candidate (forwarded to the organization destination), or it
 * matches an explicitly configured rule (when rules are in use). Ordinary mail
 * (not a document) is never forwarded via the destination.
 */
export function shouldForwardEmail(
  plan: { destination: string | null; source: "rule" | "rule_fallback" | "legacy" | "none" },
  isDocumentCandidate: boolean,
): boolean {
  if (!plan.destination) return false;
  if (isDocumentCandidate) return true;
  return plan.source === "rule" || plan.source === "rule_fallback";
}

/**
 * Resolve the routing category for an email: the system category from the
 * classifier, overridden by an organization CUSTOM category whose label appears
 * in the email text (so an admin's custom document type routes). Custom matches
 * require a label of at least 4 chars to avoid noise. Never changes invoice
 * detection — only the category key used for rule matching.
 */
export function resolveCategoryKey(
  systemCategory: string,
  text: string,
  customCategories: { categoryKey: string; label: string }[],
): string {
  const hay = text.toLowerCase();
  for (const cc of customCategories) {
    const label = cc.label.trim().toLowerCase();
    if (label.length >= 4 && hay.includes(label)) return cc.categoryKey;
  }
  return systemCategory;
}

/** Map the fine-grained classification to a routing category (all emails). */
export function classificationCategory(c: EmailClassification): DocumentCategoryKey {
  switch (c) {
    case "supplier_invoice":
    case "credit_note":
      return "invoice";
    case "purchase_order":
      return "purchase_order";
    case "general_finance":
      return "statement";
    default:
      return "other";
  }
}

export function classifyEmail(input: {
  subject: string;
  from: string;
  snippet: string;
  hasAttachment: boolean;
  attachmentNames?: string[];
}): { classification: EmailClassification; category: DocumentCategoryKey; isInvoiceCandidate: boolean; confidence: number } {
  const t = `${input.subject} ${input.snippet}`.toLowerCase();
  const has = (...k: string[]) => k.some((w) => t.includes(w));
  const fileLooksLikeInvoice = (input.attachmentNames ?? []).some((f) => INVOICE_FILENAME.test(f));

  const subjectInvoice = has("invoice", "tax invoice", "bill", "gstin", "gst invoice", "e-invoice", "proforma");

  let classification: EmailClassification = "irrelevant";
  if (has("credit note")) classification = "credit_note";
  else if (has("purchase order", "p.o.", " po ")) classification = "purchase_order";
  else if (has("remittance")) classification = "remittance_advice";
  else if (has("payment received", "payment confirmation")) classification = "payment_confirmation";
  else if (subjectInvoice) classification = "supplier_invoice";
  else if (has("quotation", "request for invoice", "please invoice")) classification = "customer_request";
  else if (has("statement", "account")) classification = "general_finance";

  const isInvoiceCandidate =
    input.hasAttachment && (classification === "supplier_invoice" || subjectInvoice || fileLooksLikeInvoice);

  // When only the attachment name flags it, still mark it a supplier invoice so
  // the UI and forwarding treat it consistently.
  if (isInvoiceCandidate && classification !== "supplier_invoice") classification = "supplier_invoice";

  // Heuristic confidence (0..1). The forwarding threshold decides auto vs review,
  // so an UNCERTAIN classification scores low and is held for review.
  let confidence: number;
  if (isInvoiceCandidate) {
    // Invoice confidences are unchanged (preserves existing behaviour + tests).
    if (has("tax invoice", "gst invoice", "gstin")) confidence = 0.93;
    else if (subjectInvoice) confidence = 0.82;
    else if (fileLooksLikeInvoice) confidence = 0.72; // detected via attachment name only
    else confidence = 0.62;
  } else {
    // Non-invoice categories: confidence reflects how strong the category signal
    // is. A clear PO/statement keyword scores mid-high (and higher with an
    // attachment); weak/none scores low so it only ever goes to review.
    switch (classification) {
      case "purchase_order":
        confidence = input.hasAttachment ? 0.85 : 0.78;
        break;
      case "general_finance": // statement / account
        confidence = input.hasAttachment ? 0.8 : 0.72;
        break;
      case "credit_note":
        confidence = input.hasAttachment ? 0.8 : 0.7;
        break;
      case "remittance_advice":
      case "payment_confirmation":
        confidence = 0.65;
        break;
      case "customer_request":
        confidence = 0.6;
        break;
      case "supplier_invoice":
        confidence = 0.4; // invoice words but no attachment — not a candidate
        break;
      default:
        confidence = 0.15; // generic / irrelevant
    }
  }
  return { classification, category: classificationCategory(classification), isInvoiceCandidate, confidence };
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
  // backfill: ingest + index historical mail ONLY — never create forward tasks
  // or enqueue forwarding (so a historical backfill can't re-forward old email).
  // query: an explicit Gmail search to use (historical backfill window) instead
  // of the incremental history anchor / default inbox query.
  opts: { maxMessages?: number; backfill?: boolean; query?: string } = {},
): Promise<SyncSummary> {
  // Deactivated orgs are paused: a sync/push/polling/backfill job queued BEFORE
  // deactivation must not run after it. All data is preserved; work resumes on
  // reactivation. (New jobs are already blocked at enqueue time; this is the
  // execution-time guard that also stops already-queued jobs.)
  if (!(await isOrganizationActive(organizationId))) {
    return { scanned: 0, newMessages: 0, invoicesCreated: 0, duplicates: 0, errors: 0, message: "Organization inactive — processing paused." };
  }
  const integration = await iQueryOne<GmailIntegrationRow>(
    "SELECT * FROM `gmail_integrations` WHERE organization_id=? AND id=?",
    [organizationId, integrationId],
  );
  if (!integration) throw new Error("Gmail account not found.");
  if (integration.status === "disconnected") throw new Error("Account is disconnected.");

  const summary: SyncSummary = { scanned: 0, newMessages: 0, invoicesCreated: 0, duplicates: 0, errors: 0, message: "" };

  try {
    const token = await getValidAccessToken(integration);
    const { refs: messages, nextHistoryId } = await selectMessageRefs(token, integration, opts.maxMessages ?? 25, opts.query);
    summary.scanned = messages.length;

    // Forwarding config for this org (review-first: queue tasks, forward later).
    // Phase 6: routing is resolved per message by configurable rules, falling
    // back to the legacy single-destination `forwarding_settings` behaviour when
    // no rule matches. Rules/destinations/CC are preloaded ONCE here so the
    // per-message resolve does no extra list queries. Skipped in backfill mode
    // (historical mail is never forwarded).
    const routing = opts.backfill
      ? null
      : {
          rules: await listRules(organizationId),
          destinations: await listDestinations(organizationId),
          orgCc: (await listCcRecipients(organizationId)).map((r) => r.email),
          // Organization CUSTOM categories (active), used to detect a configured
          // document type from the subject/snippet so rules can route it.
          customCategories: (await listCategories(organizationId)).filter((c) => !c.isSystem && c.isActive),
          // Per-org sender gating: only ALLOWED senders are forwarded (when any
          // are configured), and EXCLUDED senders are never forwarded. Loaded
          // once here so the per-message check does no extra queries.
          senderFilters: await listSenderFilters(organizationId),
        };

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
        // Never ingest the account's own Sent mail / the agent's forwards —
        // this (with the in:inbox query) prevents the forward-loop at the root.
        if (isSelfSent(from, integration.email)) continue;
        const atts = collectAttachments(msg).filter(isSupportedAttachment);
        const { classification, category, isInvoiceCandidate, confidence } = classifyEmail({
          subject,
          from,
          snippet: msg.snippet ?? "",
          hasAttachment: atts.length > 0,
          attachmentNames: atts.map((a) => a.filename),
        });
        const confPct = Math.round(confidence * 100);

        // A forwardable BUSINESS DOCUMENT: carries a supported attachment AND was
        // recognized as some business/finance document (invoice, purchase order,
        // statement, credit note, …) — NOT ordinary mail / newsletters
        // ("irrelevant"). This is what gets forwarded to the organization's
        // destination, so the agent supports different document types, not only
        // invoices. Invoice candidates remain a subset (they additionally run OCR).
        const isDocumentCandidate = atts.length > 0 && classification !== "irrelevant";

        // Final routing category: the system category from the classifier, or an
        // organization CUSTOM category detected from the subject/snippet (so an
        // admin's custom document type can be routed). Never applied to invoice
        // candidates, and never marks an email an invoice (general mail stays
        // general).
        const categoryKey =
          routing && !isInvoiceCandidate
            ? resolveCategoryKey(category, `${subject} ${msg.snippet ?? ""}`, routing.customCategories)
            : category;

        const emailMessageId = createId();
        const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : null;
        await iExecute(
          "INSERT INTO `email_messages` (`id`,`organization_id`,`gmail_integration_id`,`gmail_message_id`,`thread_id`," +
            "`from_address`,`to_address`,`subject`,`snippet`,`received_at`,`classification`,`classification_confidence`,`is_invoice_candidate`,`processing_status`) " +
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            emailMessageId, organizationId, integrationId, ref.id, msg.threadId ?? null,
            from.slice(0, 320), to.slice(0, 320), subject, (msg.snippet ?? "").slice(0, 2000), receivedAt,
            classification, confPct, isInvoiceCandidate, isInvoiceCandidate ? "pending" : "skipped",
          ],
        );
        summary.newMessages += 1;

        // Forward BUSINESS DOCUMENTS (review-first) to THIS organization's own
        // destination email. The destination comes from this org's forwarding
        // settings only — never another organization's (strict isolation, no
        // cross-org fallback). When no destination is configured, nothing is
        // forwarded. Auto-forward stays OFF by default and an uncertain
        // (below-threshold) document goes to review, not auto. Ordinary mail /
        // newsletters are not documents and are never forwarded.
        // Per-org sender gate: skip forwarding entirely unless this sender is
        // allowed and not excluded. The email is still ingested/recorded above —
        // only the FORWARD is gated. When the feature isn't configured (table not
        // migrated), evaluateSenderForward returns forward:true (no gating).
        const senderDecision = routing
          ? evaluateSenderForward(routing.senderFilters, from)
          : { forward: false as const };
        if (routing && !opts.backfill && senderDecision.forward) {
          const plan = await resolveForwardingPlan(
            organizationId,
            { integrationId, sender: from, categoryKey, confidencePct: confPct },
            routing,
          );
          const destination = plan.destination;
          if (shouldForwardEmail(plan, isDocumentCandidate)) {
            // Legacy path honours the mailbox's own auto-forward switch; a matched
            // rule carries its own auto_forward override.
            const effectiveAuto = plan.source === "legacy" ? integration.auto_forward : plan.autoForward;
            const forwardStatus = decideForwardStatus(confPct, plan.minConfidence, effectiveAuto);
            await iExecute(
              "INSERT INTO `invoice_forwards` (`id`,`organization_id`,`gmail_integration_id`,`email_message_id`," +
                "`source_gmail_message_id`,`destination`,`status`,`confidence`) VALUES (?,?,?,?,?,?,?,?) " +
                "ON DUPLICATE KEY UPDATE `id`=`id`",
              [createId(), organizationId, integrationId, emailMessageId, ref.id, destination, forwardStatus, confPct.toFixed(2)],
            );
            // Immediate forwarding: when eligible for auto-forward, enqueue a
            // forward job so the drain worker sends it within ~10s instead of
            // waiting for the periodic forwarding cycle.
            if (forwardStatus === "approved") {
              await enqueueJob({
                type: "forward",
                organizationId,
                payload: { organizationId },
                idempotencyKey: `forward:${organizationId}:${emailMessageId}`,
                priority: 10,
              }).catch(() => undefined);
            }
          }
        } // end general forwarding

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

/**
 * Re-check recent mail with the CURRENT detection logic. Normal syncs skip any
 * message already in the ledger, so improvements to classification don't reach
 * mail that was already scanned. This clears only the non-invoice ("skipped")
 * ledger rows for the account and forces a full re-scan, so previously-missed
 * invoices get picked up. Invoice rows and their forwards are left untouched.
 */
export async function rescanGmailAccount(
  organizationId: string,
  integrationId: string,
  actor: { id: string; email: string },
  opts: { maxMessages?: number } = {},
): Promise<SyncSummary> {
  // Remove only skipped (non-candidate) ledger rows so they are re-evaluated;
  // candidates/attachments/forwards are kept (and re-dedupe on their own keys).
  await iExecute(
    "DELETE FROM `email_messages` WHERE gmail_integration_id=? AND organization_id=? AND is_invoice_candidate=0",
    [integrationId, organizationId],
  );
  // Force a full query re-scan rather than an incremental history fetch.
  await iExecute("UPDATE `gmail_integrations` SET `history_id`=NULL WHERE id=? AND organization_id=?", [
    integrationId,
    organizationId,
  ]);
  await iExecute(
    "UPDATE `gmail_sync_states` SET `last_history_id`=NULL WHERE gmail_integration_id=?",
    [integrationId],
  );
  return syncGmailAccount(organizationId, integrationId, actor, { maxMessages: opts.maxMessages ?? 100 });
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
  queryOverride?: string,
): Promise<{ refs: { id: string }[]; nextHistoryId: string | null }> {
  const profile = await gmailGetProfile(token).catch(() => null);

  // An explicit query (historical backfill) always runs a full query and does
  // NOT advance/consume the incremental history anchor.
  if (queryOverride?.trim()) {
    const { messages } = await gmailListMessages(token, queryOverride.trim(), max);
    return { refs: messages.map((m) => ({ id: m.id })), nextHistoryId: integration.history_id ?? null };
  }

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
  // INCOMING inbox mail only — never the account's own Sent mail (which includes
  // the agent's forwards). This is the primary guard against the forwarding loop.
  const query = process.env.GMAIL_QUERY?.trim() || `in:inbox -in:sent -in:chats has:attachment newer_than:${days}d`;
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

/**
 * ALL connected integrations for an email address. The same inbox may be
 * connected in more than one organization (the unique key is per org+email), and
 * a Gmail push notification carries only the address — so the push handler must
 * sync every org's copy, each in its own organization context, rather than an
 * arbitrary single one. Only ACTIVE organizations are returned (a deactivated
 * org is paused). Returned rows carry the correct organization_id per row.
 */
export async function findConnectedIntegrationsByEmail(
  email: string,
): Promise<{ id: string; organization_id: string }[]> {
  return iQuery<{ id: string; organization_id: string }>(
    "SELECT g.id, g.organization_id FROM `gmail_integrations` g " +
      "JOIN `organizations` o ON o.id=g.organization_id AND o.status='active' " +
      "WHERE g.email=? AND g.status='connected'",
    [email.toLowerCase()],
  );
}

/** Return a valid access token for an account (used by the forwarding service). */
export async function getAccountAccessToken(organizationId: string, integrationId: string): Promise<string> {
  const integration = await iQueryOne<GmailIntegrationRow>(
    "SELECT * FROM `gmail_integrations` WHERE organization_id=? AND id=?",
    [organizationId, integrationId],
  );
  if (!integration) throw new Error("Gmail account not found.");
  return getValidAccessToken(integration);
}

/** Toggle per-account auto-forward (review-first default is off). */
export async function setAccountAutoForward(
  organizationId: string,
  integrationId: string,
  enabled: boolean,
): Promise<void> {
  await iExecute("UPDATE `gmail_integrations` SET `auto_forward`=? WHERE organization_id=? AND id=?", [
    enabled,
    organizationId,
    integrationId,
  ]);
}
