import "server-only";
import { iQuery, iQueryOne, iExecute, isMissingTableError } from "../db";
import { createId } from "@/lib/id";
import { logInvoiceAudit } from "../audit";
import { getAccountAccessToken } from "./gmail";
import { gmailGetRaw, gmailGetAttachment, gmailGetMessage, gmailSend } from "../gmail/api";
import { GmailApiError } from "../gmail/oauth";
import { isOrganizationActive } from "./org-admin";
import { buildOriginalBodyHtml } from "./original-body";

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
  const defaults: ForwardingSettings = { financeDestination: null, minConfidence: 70, enabled: true };
  try {
    const row = await iQueryOne<{ finance_destination: string | null; min_confidence: string; enabled: boolean }>(
      "SELECT finance_destination, min_confidence, enabled FROM `forwarding_settings` WHERE organization_id=?",
      [organizationId],
    );
    return {
      financeDestination: row?.finance_destination ?? null,
      minConfidence: Number(row?.min_confidence ?? 70),
      enabled: row?.enabled ?? true,
    };
  } catch (e) {
    // DB reachable but not migrated to this table yet → safe defaults, no crash.
    if (isMissingTableError(e)) return defaults;
    throw e;
  }
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
  try {
    return await iQuery<CcRecipient>(
      "SELECT `id`, `email` FROM `forwarding_cc_recipients` WHERE organization_id=? ORDER BY `email` ASC",
      [organizationId],
    );
  } catch (e) {
    // The forwarding_cc_recipients table is created by migration 008. If the
    // invoice DB is reachable but not yet migrated to it, treat it as "no CC
    // recipients yet" rather than throwing (which would crash the Settings page
    // and any forward). Re-raise anything that is not a missing-table error.
    if (isMissingTableError(e)) return [];
    throw e;
  }
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

/**
 * Remove a CC recipient by id (scoped to the org). Returns "Recipient not found"
 * when the id does not belong to THIS organization, so a stale or cross-org id
 * is not silently reported as removed. The DELETE stays organization-scoped, so
 * no other organization's recipient can ever be affected.
 */
export async function removeCcRecipient(
  organizationId: string,
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await iExecute("DELETE FROM `forwarding_cc_recipients` WHERE organization_id=? AND id=?", [
    organizationId,
    id,
  ]);
  if (res.affectedRows === 0) return { ok: false, message: "Recipient not found." };
  return { ok: true, message: "CC recipient removed." };
}

/**
 * Per-destination CC addresses (Phase 6) for a given destination email, scoped
 * to the org. Missing-table-safe: returns [] when the routing tables aren't
 * migrated yet, so forwarding keeps working with only the org-wide CC list.
 */
async function destinationCc(organizationId: string, destinationEmail: string): Promise<string[]> {
  try {
    const row = await iQueryOne<{ cc_emails: string | null }>(
      "SELECT `cc_emails` FROM `forwarding_destinations` WHERE organization_id=? AND email=?",
      [organizationId, destinationEmail.toLowerCase()],
    );
    if (!row?.cc_emails) return [];
    const arr = JSON.parse(row.cc_emails);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch (e) {
    if (isMissingTableError(e)) return [];
    return []; // malformed JSON or transient read: fall back to org-wide CC only
  }
}

/**
 * The complete CC list applied to a forward to `destinationEmail`: the org-wide
 * recipients plus any CC addresses configured on the matching destination
 * record, de-duplicated (case-insensitive). Org-wide CC always applies.
 */
async function resolveForwardCc(organizationId: string, destinationEmail: string): Promise<string[]> {
  const orgCc = (await listCcRecipients(organizationId)).map((r) => r.email);
  const destCc = await destinationCc(organizationId, destinationEmail);
  const out: string[] = [];
  for (const e of [...destCc, ...orgCc]) {
    const n = e.toLowerCase();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Edit a CC recipient's address (validated + de-duplicated). */
export async function updateCcRecipient(
  organizationId: string,
  id: string,
  rawEmail: string,
): Promise<{ ok: boolean; message: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, message: "Enter a valid email address." };
  // Existence check is organization-scoped: a stale or cross-org id resolves to
  // no row here and returns "Recipient not found" (never a false success, never
  // another org's recipient). Done as a SELECT rather than relying on UPDATE
  // affectedRows, which is 0 when the address is unchanged even though the row
  // exists.
  const existing = await iQueryOne<{ id: string }>(
    "SELECT `id` FROM `forwarding_cc_recipients` WHERE organization_id=? AND id=?",
    [organizationId, id],
  );
  if (!existing) return { ok: false, message: "Recipient not found." };
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

// --- Sender filters (allowed senders + exclusions) --------------------------

/**
 * Per-organisation sender gating for forwarding:
 *
 *   - ALLOWED senders ("allow"): when an org has at least one, ONLY mail from
 *     those senders is forwarded. With NONE configured there is no restriction —
 *     every sender forwards (the default, out-of-the-box behaviour).
 *   - EXCLUDED senders ("block", e.g. a vendor like Razorpay): mail from them is
 *     NEVER forwarded, even if it would otherwise be allowed (block wins).
 *
 * A pattern is a full email (billing@razorpay.com) OR a bare domain
 * (razorpay.com — also matches sub-domains like billing.razorpay.com). All
 * matching is case-insensitive and strictly scoped to the organisation.
 */
export type SenderFilterKind = "allow" | "block";

export interface SenderFilter {
  id: string;
  kind: SenderFilterKind;
  pattern: string;
}

/** The org's filters, plus `configured` = whether the feature's table exists. */
export interface SenderFilters {
  /** False when the forwarding_sender_filters table is not migrated yet. When
   *  false, NO gating is applied (pre-migration behaviour is unchanged). */
  configured: boolean;
  allow: SenderFilter[];
  block: SenderFilter[];
}

/** A bare DNS domain (no scheme, no path), used for domain-style patterns. */
const DOMAIN_RE = /^(?=.{1,255}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Pull the email address out of a raw From header, which may be
 * `"Vendor Name" <billing@acme.com>` or just `billing@acme.com`. Returns the
 * lower-cased address, or null when none can be parsed.
 */
export function extractSenderEmail(fromHeader: string): string | null {
  if (!fromHeader) return null;
  // 1) Remove quoted display-name strings first — they can legally contain '<',
  //    '>' and '@' (e.g. `"Weird <tag> x@evil.com" <real@acme.com>`), which would
  //    otherwise be mistaken for the address. Backslash-escaped quotes honoured.
  const unquoted = fromHeader.replace(/"(?:[^"\\]|\\.)*"/g, " ");
  // 2) Prefer the angle-addr <addr>. When several remain, the LAST is the real
  //    addr-spec (earlier ones are leftover display-name fragments).
  const angles = [...unquoted.matchAll(/<([^<>]*)>/g)];
  const base = (angles.length ? angles[angles.length - 1][1] : unquoted).toLowerCase();
  // 3) Pull the first email-looking token out of the chosen segment (handles the
  //    comment form `billing@acme.com (Acme)` and stray surrounding text).
  const token = base.match(/[^\s"'<>(),;:]+@[^\s"'<>(),;:]+/);
  const email = (token ? token[0] : base).trim();
  return EMAIL_RE.test(email) ? email : null;
}

/**
 * Validate + normalize a sender-filter pattern. Accepts a full email address or
 * a bare domain (a leading "@" is tolerated, e.g. "@acme.com"). Lower-cased.
 */
export function normalizeSenderPattern(
  raw: string,
): { ok: true; value: string } | { ok: false; message: string } {
  let v = raw.trim().toLowerCase();
  if (!v) return { ok: false, message: "Enter a sender email or domain." };
  if (v.length > 320) return { ok: false, message: "That value is too long." };
  if (v.startsWith("@")) v = v.slice(1); // "@acme.com" -> "acme.com"
  const invalid = { ok: false as const, message: "Enter a valid email address or domain (e.g. billing@acme.com or acme.com)." };
  if (v.includes("@")) return EMAIL_RE.test(v) ? { ok: true, value: v } : invalid;
  return DOMAIN_RE.test(v) ? { ok: true, value: v } : invalid;
}

/**
 * Does a sender address match a pattern? A full-email pattern matches exactly;
 * a domain pattern matches the sender's domain exactly OR as a sub-domain
 * (so "acme.com" matches both "a@acme.com" and "a@mail.acme.com").
 */
export function senderMatchesPattern(senderEmail: string, pattern: string): boolean {
  const s = senderEmail.trim().toLowerCase();
  const p = pattern.trim().toLowerCase().replace(/^@/, "");
  if (!s || !p) return false;
  if (p.includes("@")) return s === p; // exact address
  const at = s.lastIndexOf("@");
  if (at < 0) return false;
  const domain = s.slice(at + 1);
  return domain === p || domain.endsWith("." + p); // domain or sub-domain
}

export type SenderForwardReason =
  | "not_configured" // no gating applied (table not migrated, OR the allow-list is empty → no restriction)
  | "blocked" // sender is on the exclusion list
  | "allowed" // sender matches an allowed entry
  | "empty_allowlist" // retained for back-compat; no longer produced (an empty allow-list no longer blocks)
  | "not_in_allowlist" // allow entries exist and the sender is not among them
  | "unparseable_sender"; // allow entries exist, but the sender couldn't be parsed (fail-closed)

/**
 * Decide whether an email from `fromHeader` may be forwarded, given an org's
 * sender filters. Fail-closed when gating is active: block wins; with no allowed
 * senders nothing forwards; an unparseable sender is not forwarded. When the
 * feature isn't configured (table missing), forwarding is NOT gated.
 */
export function evaluateSenderForward(
  filters: SenderFilters,
  fromHeader: string,
): { forward: boolean; reason: SenderForwardReason } {
  if (!filters.configured) return { forward: true, reason: "not_configured" };
  const email = extractSenderEmail(fromHeader);
  // Exclusions win over everything else.
  if (email && filters.block.some((f) => senderMatchesPattern(email, f.pattern))) {
    return { forward: false, reason: "blocked" };
  }
  // The allow-list RESTRICTS only when it has entries. An empty allow-list means
  // "no sender restriction" — every sender forwards (subject to exclusions) — so
  // the default, out-of-the-box setup forwards normally. Add allowed senders only
  // to limit forwarding to a specific set.
  if (filters.allow.length === 0) return { forward: true, reason: "not_configured" };
  if (!email) return { forward: false, reason: "unparseable_sender" };
  if (filters.allow.some((f) => senderMatchesPattern(email, f.pattern))) {
    return { forward: true, reason: "allowed" };
  }
  return { forward: false, reason: "not_in_allowlist" };
}

/**
 * Human-readable explanation for WHY a forward was withheld by sender filters —
 * used in the task's `last_error` (shown in "Recent forwards") and in approval
 * messages so a Finance Admin can see whether it was the exclusion list or the
 * allowed-senders list that stopped it.
 */
export function senderBlockReason(reason: SenderForwardReason): string {
  switch (reason) {
    case "blocked":
      return "the sender is on this organisation's excluded list";
    case "empty_allowlist":
      return "this organisation has no allowed senders configured";
    case "not_in_allowlist":
      return "the sender is not in this organisation's allowed senders";
    case "unparseable_sender":
      return "the sender address could not be parsed and the allowed-senders list is active";
    default:
      return "it was blocked by this organisation's sender filters";
  }
}

/**
 * Load an org's sender filters. Missing-table-safe: when the
 * forwarding_sender_filters table isn't migrated yet, returns configured:false
 * so the caller applies NO gating (pre-migration behaviour is unchanged).
 */
export async function listSenderFilters(organizationId: string): Promise<SenderFilters> {
  try {
    const rows = await iQuery<{ id: string; kind: string; pattern: string }>(
      "SELECT `id`, `kind`, `pattern` FROM `forwarding_sender_filters` WHERE organization_id=? ORDER BY `pattern` ASC",
      [organizationId],
    );
    const allow: SenderFilter[] = [];
    const block: SenderFilter[] = [];
    for (const r of rows) {
      const kind: SenderFilterKind = r.kind === "block" ? "block" : "allow";
      (kind === "block" ? block : allow).push({ id: r.id, kind, pattern: r.pattern });
    }
    return { configured: true, allow, block };
  } catch (e) {
    if (isMissingTableError(e)) return { configured: false, allow: [], block: [] };
    throw e;
  }
}

/** Shown when a write is attempted before migration 011 has created the table. */
const SENDER_FILTERS_NOT_ACTIVE =
  "Sender filtering isn't activated on this environment yet. Apply migration 011 (npm run invoice:db:init) to enable it, then add senders here.";

/** Add an allowed or excluded sender (idempotent). */
export async function addSenderFilter(
  organizationId: string,
  actor: { id: string; email: string },
  kind: SenderFilterKind,
  rawPattern: string,
): Promise<{ ok: boolean; message: string }> {
  const k: SenderFilterKind = kind === "block" ? "block" : "allow";
  const norm = normalizeSenderPattern(rawPattern);
  if (!norm.ok) return { ok: false, message: norm.message };
  const id = createId();
  let res: { affectedRows: number };
  try {
    res = await iExecute(
      "INSERT INTO `forwarding_sender_filters` (`id`,`organization_id`,`kind`,`pattern`) VALUES (?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE `id`=`id`",
      [id, organizationId, k, norm.value],
    );
  } catch (e) {
    if (isMissingTableError(e)) return { ok: false, message: SENDER_FILTERS_NOT_ACTIVE };
    throw e;
  }
  if (res.affectedRows === 0) {
    return { ok: false, message: k === "block" ? "That sender is already excluded." : "That sender is already allowed." };
  }
  // Audit uses entityId = row id (consistent with removeSenderFilter), with the
  // kind/pattern carried in the before/after payload.
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: k === "block" ? "forwarding.sender_excluded" : "forwarding.sender_allowed",
    entityType: "forwarding_sender_filter",
    entityId: id,
    after: { kind: k, pattern: norm.value },
  });
  return {
    ok: true,
    message: k === "block" ? `Excluded ${norm.value} from forwarding.` : `Added ${norm.value} to allowed senders.`,
  };
}

/** Remove a sender filter by id (strictly org-scoped). */
export async function removeSenderFilter(
  organizationId: string,
  actor: { id: string; email: string },
  id: string,
): Promise<{ ok: boolean; message: string }> {
  // Fetch first (org-scoped) so the audit record carries the same shape as add
  // (entityId = row id, with the removed kind/pattern in the payload). A stale or
  // cross-org id resolves to no row here → "Entry not found" (never a cross-org
  // delete, never a false success).
  let existing: { id: string; kind: string; pattern: string } | null;
  try {
    existing = await iQueryOne<{ id: string; kind: string; pattern: string }>(
      "SELECT `id`, `kind`, `pattern` FROM `forwarding_sender_filters` WHERE organization_id=? AND id=?",
      [organizationId, id],
    );
  } catch (e) {
    if (isMissingTableError(e)) return { ok: false, message: SENDER_FILTERS_NOT_ACTIVE };
    throw e;
  }
  if (!existing) return { ok: false, message: "Entry not found." };
  await iExecute("DELETE FROM `forwarding_sender_filters` WHERE organization_id=? AND id=?", [organizationId, id]);
  await logInvoiceAudit({
    organizationId,
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "forwarding.sender_filter_removed",
    entityType: "forwarding_sender_filter",
    entityId: existing.id,
    before: { kind: existing.kind === "block" ? "block" : "allow", pattern: existing.pattern },
  });
  return { ok: true, message: "Removed." };
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
  /** Set when a human/agent approved this forward (null = auto-forwarded). */
  approved_by: string | null;
  // joined
  subject: string | null;
  from_address: string | null;
  to_address: string | null;
  account_email: string | null;
  /** Connected Gmail account display name (null = fall back to account_email). */
  account_display_name: string | null;
  received_at: Date | string | null;
  organisation_name: string | null;
  /** Joined from email_messages: the document classification (e.g. supplier_invoice). */
  classification: string | null;
  is_invoice_candidate: number | null;
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
    "SELECT f.*, m.subject, m.from_address, m.to_address, m.received_at, m.classification, m.is_invoice_candidate, " +
      "g.email AS account_email, g.display_name AS account_display_name, o.name AS organisation_name " +
      "FROM `invoice_forwards` f " +
      "LEFT JOIN `email_messages` m ON m.id = f.email_message_id " +
      "LEFT JOIN `gmail_integrations` g ON g.id = f.gmail_integration_id " +
      "LEFT JOIN `organizations` o ON o.id = f.organization_id " +
      `WHERE ${where.join(" AND ")} ORDER BY f.created_at DESC LIMIT ?`,
    params,
  );
}

/** Fetch a single forward task (with the joined fields sendForward needs). */
async function getForward(organizationId: string, forwardId: string): Promise<ForwardRow | null> {
  return iQueryOne<ForwardRow>(
    "SELECT f.*, m.subject, m.from_address, m.to_address, m.received_at, m.classification, m.is_invoice_candidate, " +
      "g.email AS account_email, g.display_name AS account_display_name, o.name AS organisation_name " +
      "FROM `invoice_forwards` f " +
      "LEFT JOIN `email_messages` m ON m.id = f.email_message_id " +
      "LEFT JOIN `gmail_integrations` g ON g.id = f.gmail_integration_id " +
      "LEFT JOIN `organizations` o ON o.id = f.organization_id " +
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

export interface ForwardBodyInput {
  /** The organization that forwarded this email (shown prominently). */
  organisationName: string;
  /** Connected Gmail account name (or its email) that RECEIVED the original mail;
   *  used for the forwarded-email subject. Empty → a generic fallback. */
  accountName?: string;
  subject: string;
  from: string;
  /** Original recipient (To header of the received email). */
  to: string;
  date: string;
  confidence: string | null;
  /** Cleaned filenames of the attachments included directly on the forward. */
  attachmentFilenames: string[];
  /** SANITIZED HTML of the original email body, inlined below the metadata so the
   *  recipient can read it without opening original.eml. Empty = none available. */
  originalBodyHtml?: string;
}

/** Escape a value for safe insertion into HTML (sender/subject are untrusted). */
function htmlEscape(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RenderedForwardBody {
  /** Subject BEFORE RFC2047 header encoding (buildForwardMime encodes it). */
  subject: string;
  /** MIME Content-Type of the body part, e.g. `text/plain; charset="UTF-8"`. */
  contentType: string;
  /** Content-Transfer-Encoding of the body part, e.g. `8bit`. */
  encoding: string;
  /** The rendered body content. */
  body: string;
}

/**
 * Render the forwarded message's subject + a clean, professional HTML body.
 *
 * This is the single presentation seam — it only produces the body part shown to
 * the recipient. The MIME assembly (the actual attachments, the full original as
 * original.eml, headers, CC) stays in buildForwardMime and is UNCHANGED, so
 * delivery and attachment handling are preserved. The layout is table-based with
 * inline styles so it renders consistently in Gmail and Outlook, works for any
 * document type (invoices, POs, GST documents, statements, general business
 * email), and is populated dynamically per organization.
 */
export function renderForwardBody(input: ForwardBodyInput): RenderedForwardBody {
  const subjectText = cleanHeader(input.subject) || "(no subject)";
  // The forwarded email's Subject names the CONNECTED mailbox that received the
  // original mail (its display name, or its email as a fallback) — never the
  // original sender or the Finance recipient. The original subject is still
  // shown in the body metadata below.
  const receivedBy = cleanHeader(input.accountName ?? "").trim() || "the connected mailbox";
  const forwardSubject = `You have received an email from ${receivedBy}`;
  // Forwarded emails present under a fixed "Finance & Accounts" label rather
  // than the raw organisation name (product branding). "&" is HTML-escaped.
  const brand = htmlEscape("Finance & Accounts");
  const from = htmlEscape(cleanHeader(input.from) || "—");
  const to = htmlEscape(cleanHeader(input.to) || "—");
  const date = htmlEscape(cleanHeader(input.date) || "—");
  const subject = htmlEscape(subjectText);
  const names = input.attachmentFilenames;

  const metaRow = (label: string, value: string, last = false) =>
    `<tr><td style="padding:10px 14px;${last ? "" : "border-bottom:1px solid #eef2f7;"}width:84px;color:#64748b;` +
    `font-size:12px;font-family:Arial,Helvetica,sans-serif;vertical-align:top;">${label}</td>` +
    `<td style="padding:10px 14px;${last ? "" : "border-bottom:1px solid #eef2f7;"}color:#0f172a;font-size:13px;` +
    `font-family:Arial,Helvetica,sans-serif;font-weight:600;word-break:break-word;">${value}</td></tr>`;

  const attachmentRows = names.length
    ? names
        .map(
          (n) =>
            `<tr><td style="padding:8px 14px;border-top:1px solid #eef2f7;color:#334155;font-size:13px;` +
            `font-family:Arial,Helvetica,sans-serif;">&#128206;&nbsp; ${htmlEscape(n)}</td></tr>`,
        )
        .join("")
    : "";

  // The original email body, inlined (already sanitized by the caller). When
  // absent, a short note points to original.eml.
  const originalBlock = input.originalBodyHtml && input.originalBodyHtml.trim()
    ? `<tr><td style="padding:18px 24px 4px;">
         <div style="color:#64748b;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;margin-bottom:8px;">Original message</div>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
           <tr><td style="padding:16px 18px;background:#ffffff;color:#0f172a;font-size:13px;line-height:1.55;font-family:Arial,Helvetica,sans-serif;word-break:break-word;">${input.originalBodyHtml}</td></tr>
         </table>
       </td></tr>`
    : `<tr><td style="padding:16px 24px 0;"><p style="color:#64748b;font-size:12px;font-family:Arial,Helvetica,sans-serif;margin:0;">The original message content is attached as <b>original.eml</b>.</p></td></tr>`;

  const attachmentsBlock = names.length
    ? `<tr><td style="padding:4px 24px 0;">
         <div style="color:#64748b;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;margin-bottom:6px;">Attachments (${names.length})</div>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">${attachmentRows}</table>
       </td></tr>`
    : "";

  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forwarded document</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <tr><td bgcolor="#0f172a" style="background:#0f172a;padding:22px 24px;">
          <div style="color:#ffffff;font-size:19px;font-weight:700;font-family:Arial,Helvetica,sans-serif;line-height:1.2;">${brand}</div>
          <div style="color:#94a3b8;font-size:12px;font-family:Arial,Helvetica,sans-serif;margin-top:5px;">Forwarded by the ${brand} email assistant</div>
        </td></tr>
        <tr><td style="padding:22px 24px 6px;">
          <span style="display:inline-block;background:#ecfdf5;color:#047857;font-size:11px;font-weight:700;letter-spacing:.04em;padding:5px 12px;border-radius:999px;font-family:Arial,Helvetica,sans-serif;">FORWARDED DOCUMENT</span>
          <p style="color:#334155;font-size:14px;line-height:1.55;font-family:Arial,Helvetica,sans-serif;margin:14px 0 0;">
            A document was received and automatically forwarded to you by <b>${brand}</b>. The details of the original message are below, with its attachments included and the complete original email attached as <b>original.eml</b>.
          </p>
        </td></tr>
        <tr><td style="padding:14px 24px 2px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
            ${metaRow("From", from)}
            ${metaRow("To", to)}
            ${metaRow("Date", date)}
            ${metaRow("Subject", subject, true)}
          </table>
        </td></tr>
        ${originalBlock}
        ${attachmentsBlock}
        <tr><td style="padding:16px 24px 20px;">
          <p style="color:#94a3b8;font-size:12px;line-height:1.5;font-family:Arial,Helvetica,sans-serif;margin:0;">
            This is an automated forward — please reply to the original sender (${from}), not to this message.
          </p>
        </td></tr>
        <tr><td bgcolor="#f8fafc" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 24px;">
          <p style="color:#94a3b8;font-size:11px;font-family:Arial,Helvetica,sans-serif;margin:0;">Automated message from ${brand}. Forwarded securely by the organization's email assistant.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return {
    subject: forwardSubject,
    contentType: 'text/html; charset="UTF-8"',
    encoding: "8bit",
    body,
  };
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
  organisationName?: string;
  /** Connected Gmail account name (or email) that received the original mail. */
  accountName?: string;
  subject: string;
  from: string;
  to?: string;
  date: string;
  confidence: string | null;
  rawOriginalBase64Url: string;
  attachments?: ForwardAttachment[];
  originalBodyHtml?: string;
}): string {
  const boundary = `atlasinv_${createId()}`;
  const emlStandardB64 = wrap76(Buffer.from(input.rawOriginalBase64Url, "base64url").toString("base64"));
  const attachments = input.attachments ?? [];
  const cc = (input.cc ?? []).map((e) => cleanHeader(e)).filter(Boolean);

  // The subject + (HTML) body come from the template renderer. The MIME assembly
  // below (attachments + original.eml) is unchanged.
  const rendered = renderForwardBody({
    organisationName: input.organisationName ?? "",
    accountName: input.accountName ?? "",
    subject: input.subject,
    from: input.from,
    to: input.to ?? "",
    date: input.date,
    confidence: input.confidence,
    attachmentFilenames: attachments.map((a) => cleanFilename(a.filename)),
    originalBodyHtml: input.originalBodyHtml,
  });

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
    `Subject: ${encodeHeaderWord(rendered.subject)}\r\n` +
    "MIME-Version: 1.0\r\n" +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${rendered.contentType}\r\n` +
    `Content-Transfer-Encoding: ${rendered.encoding}\r\n\r\n` +
    `${rendered.body}\r\n` +
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
): Promise<"forwarded" | "failed" | "skipped" | "unknown" | "blocked"> {
  if (forward.status === "forwarded") return "forwarded";

  // SEND-TIME sender gate (authoritative). This is the single choke point every
  // send path funnels through — the drain worker (runForwarding), manual approval
  // (approveAndForward) and the AI-agent forward (forwardEmailById → approve) —
  // so no path can bypass the restriction. Re-checked HERE, at send time, so a
  // sender excluded (or an allowed-senders list changed) AFTER the task was
  // queued or approved is never forwarded. It runs BEFORE the atomic claim, so no
  // message is sent; the task is moved out of the queue to 'skipped' with an
  // explanatory last_error (surfaced in "Recent forwards"). Every runner runs
  // this same check, so a race cannot slip a blocked send through.
  const gate = evaluateSenderForward(await listSenderFilters(organizationId), forward.from_address ?? "");
  if (!gate.forward) {
    await iExecute(
      "UPDATE `invoice_forwards` SET `status`='skipped', `last_error`=? WHERE id=? AND `status`='approved'",
      [`Not forwarded: ${senderBlockReason(gate.reason)}.`, forward.id],
    );
    return "blocked";
  }

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
    // Inline the original body (sanitized) so the recipient can read it without
    // opening original.eml. Best-effort: on any failure we still forward, with
    // the complete original preserved as original.eml.
    let originalBodyHtml = "";
    try {
      const parsed = await gmailGetMessage(token, forward.source_gmail_message_id);
      originalBodyHtml = await buildOriginalBodyHtml(token, forward.source_gmail_message_id, parsed);
    } catch {
      originalBodyHtml = "";
    }

    const cc = await resolveForwardCc(organizationId, forward.destination);
    mime = buildForwardMime({
      destination: forward.destination,
      cc,
      organisationName: forward.organisation_name ?? "",
      // Name the mailbox that received the mail: its display name, else its email.
      accountName: forward.account_display_name || forward.account_email || "",
      subject: forward.subject ?? "",
      from: forward.from_address ?? "",
      to: forward.to_address ?? "",
      date: forward.received_at ? new Date(forward.received_at).toUTCString() : "",
      confidence: forward.confidence,
      originalBodyHtml,
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
    // Loud server log so a send failure (esp. HTTP 403 = the connected account is
    // missing gmail.send → reconnect it) is visible without opening the DB.
    console.error(
      `[invoice-forward] SEND FAILED id=${forward.id} dest=${forward.destination} http=${status || "n/a"} ` +
        `${status === 403 ? "(403 — account likely missing gmail.send scope; RECONNECT the Gmail account) " : ""}${msg}`,
    );
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
  // Deactivated orgs are paused: a forward job queued BEFORE deactivation must
  // not send after it. Approved rows are preserved and resume on reactivation.
  if (!(await isOrganizationActive(organizationId))) {
    return { forwarded: 0, failed: 0, unknown: 0, pending: 0 };
  }

  // Auto-approve for auto-forward mailboxes: promote any 'pending' forward whose
  // mailbox currently has auto-forward ON to 'approved', so enabling auto-forward
  // also sends invoices that were queued BEFORE it was turned on — not only ones
  // that arrive afterward. A 'pending' row already passed the confidence
  // threshold (a below-threshold document is 'review', which is NOT promoted and
  // still needs a human). The sender gate still runs at send time in sendForward,
  // so this cannot bypass the sender allow/exclude rule.
  await iExecute(
    "UPDATE `invoice_forwards` f JOIN `gmail_integrations` g ON g.id = f.gmail_integration_id " +
      "SET f.`status`='approved' " +
      "WHERE f.`organization_id`=? AND f.`status`='pending' AND g.`auto_forward`=1",
    [organizationId],
  );

  // Disable is authoritative (symmetric to the promotion above): turning a
  // mailbox's auto-forward OFF must stop auto-forwards that were queued while it
  // was ON but not yet sent. Demote any AUTO-created 'approved' row (approved_by
  // IS NULL) back to 'pending' when its mailbox now has auto-forward OFF, so it
  // is held — never auto-sent — until auto-forward is re-enabled (which re-
  // promotes it) or a human approves it. A human/agent approval carries
  // approved_by and is deliberately untouched here, so an explicit approval still
  // sends regardless of the mailbox switch.
  await iExecute(
    "UPDATE `invoice_forwards` f JOIN `gmail_integrations` g ON g.id = f.gmail_integration_id " +
      "SET f.`status`='pending' " +
      "WHERE f.`organization_id`=? AND f.`status`='approved' AND f.`approved_by` IS NULL AND g.`auto_forward`=0",
    [organizationId],
  );

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

  // Sender gate at approval time: if the sender has since been excluded, or the
  // allowed-senders list no longer admits it, do NOT forward. Move the task to
  // 'skipped' with an explanatory reason and tell the approver which list stopped
  // it. (sendForward re-checks this too, as the final backstop.)
  const gate = evaluateSenderForward(await listSenderFilters(organizationId), row.from_address ?? "");
  if (!gate.forward) {
    await iExecute(
      "UPDATE `invoice_forwards` SET `status`='skipped', `last_error`=? WHERE organization_id=? AND id=? AND `status` IN ('pending','review','failed','approved')",
      [`Not forwarded: ${senderBlockReason(gate.reason)}.`, organizationId, forwardId],
    );
    return { ok: false, message: `Not forwarded — ${senderBlockReason(gate.reason)}. Update Allowed senders / Excluded senders in Settings.` };
  }

  // Only move to 'approved' from a non-terminal state (never re-open a forwarded one).
  await iExecute(
    "UPDATE `invoice_forwards` SET `status`='approved', `approved_by`=? WHERE id=? AND `status` IN ('pending','review','failed','approved')",
    [actor.id, forwardId],
  );
  // Carry approved_by so sendForward records this as a human/agent approval.
  const result = await sendForward(organizationId, { ...row, status: "approved", approved_by: actor.id });
  if (result === "forwarded") return { ok: true, message: "Forwarded to Finance & Accounts." };
  if (result === "blocked") {
    return {
      ok: false,
      message: "Not forwarded — the sender is on this organisation's excluded list. Remove it from Excluded senders in Settings.",
    };
  }
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
  const email = await iQueryOne<{ id: string; gmail_integration_id: string; gmail_message_id: string; from_address: string | null; classification_confidence: string | null }>(
    "SELECT id, gmail_integration_id, gmail_message_id, from_address, classification_confidence FROM `email_messages` WHERE organization_id=? AND id=?",
    [organizationId, emailMessageId],
  );
  if (!email) return { ok: false, message: "Email not found." };

  // Sender gating applies even to an explicit forward: an EXCLUDED sender is
  // never forwarded, and (once allowed senders are configured) only an allowed
  // sender may be forwarded. Keeps the allow-list / exclusions authoritative.
  const senderDecision = evaluateSenderForward(await listSenderFilters(organizationId), email.from_address ?? "");
  if (!senderDecision.forward) {
    return {
      ok: false,
      message: `Not forwarded — ${senderBlockReason(senderDecision.reason)}. Update Allowed senders / Excluded senders in Settings.`,
    };
  }

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
