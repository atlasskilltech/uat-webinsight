/**
 * MySQL-backed integration test for invoice forwarding de-duplication and the
 * ambiguous-send contract. Unlike the pure unit tests, this spins the REAL
 * services against a REAL, disposable MySQL/MariaDB database so the DB-level
 * guarantees (unique keys, atomic claim, migration 008) are actually exercised.
 *
 * NO REAL EMAILS ARE SENT: the entire Gmail network API is mocked. The OCR/AI
 * document pipeline is mocked too, so no OCR/LLM calls happen. The access token
 * is seeded (encrypted) and non-expired, so no token refresh / network occurs.
 *
 * The test SKIPS gracefully (so `npm test` stays green in CI) unless a MySQL
 * server is reachable. Point it at a throwaway server with:
 *   ITEST_DB_HOST (default 127.0.0.1)  ITEST_DB_PORT (default 3306)
 *   ITEST_DB_USER (default root)       ITEST_DB_PASSWORD (default empty)
 *   ITEST_DB_NAME (default atlas_invoice_itest — DROPPED & recreated each run)
 *
 * Scenarios (from the verification request):
 *   1. The same Gmail message across multiple syncs                → one row, no resend
 *   2. The same message via Rescan Inbox                            → reused, never reset/resent
 *   3. Two overlapping workers forwarding the same message          → sent exactly once
 *   4. A successful forward then a retry                            → not resent
 *   5. Crash/timeout after Gmail accepts the send, before DB update → not resent (ambiguous)
 *   6. A duplicate invoice forward                                  → rejected by the DB
 * Plus: migration 008 idempotency, attachments (filename/MIME/bytes) + all CC in
 * the outgoing MIME, and non-invoice emails never increasing invoice counts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import mysql2 from "mysql2/promise";

const DB = {
  host: process.env.ITEST_DB_HOST || "127.0.0.1",
  port: Number(process.env.ITEST_DB_PORT || 3306),
  user: process.env.ITEST_DB_USER || "root",
  password: process.env.ITEST_DB_PASSWORD ?? "",
  name: process.env.ITEST_DB_NAME || "atlas_invoice_itest",
};

/** Can we reach a MySQL server? Decides whether this suite runs or skips. */
async function dbReachable(): Promise<boolean> {
  try {
    const c = await mysql2.createConnection({
      host: DB.host,
      port: DB.port,
      user: DB.user,
      password: DB.password,
      connectTimeout: 2500,
    });
    await c.end();
    return true;
  } catch {
    return false;
  }
}

const READY = await dbReachable();
if (!READY) {
  // eslint-disable-next-line no-console
  console.warn(
    `[forwarding-dedup.integration] no MySQL at ${DB.host}:${DB.port} — skipping. ` +
      `Set ITEST_DB_* to run it against a throwaway database.`,
  );
}

// --- Mock the Gmail network API BEFORE importing any service ----------------
// Pure parsers (getHeader/collectAttachments/isSupportedAttachment) stay REAL;
// only the network functions are replaced. No real Gmail calls, no real email.
const g = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  getAttachment: vi.fn(),
  getRaw: vi.fn(),
  send: vi.fn(),
  getProfile: vi.fn(),
  listHistory: vi.fn(),
}));

vi.mock("@/lib/invoice/gmail/api", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    gmailListMessages: g.listMessages,
    gmailGetMessage: g.getMessage,
    gmailGetAttachment: g.getAttachment,
    gmailGetRaw: g.getRaw,
    gmailSend: g.send,
    gmailGetProfile: g.getProfile,
    gmailListHistory: g.listHistory,
    gmailWatch: vi.fn(async () => ({})),
    gmailStopWatch: vi.fn(async () => ({})),
  };
});

// Mock the OCR/AI document pipeline so a candidate's attachment does not trigger
// Document AI / OpenAI. We only need it to report "not a duplicate".
vi.mock("@/lib/invoice/services/processing", () => ({
  processUploadedDocument: vi.fn(async () => ({ duplicate: false, documentId: "doc_test", invoiceId: "inv_test" })),
}));

// Imported AFTER the mocks so they bind to the mocked Gmail API. The app DB pool
// is opened lazily on first query (in beforeAll, once ATLAS_INVOICE_DB_* is set).
import { iQuery, iQueryOne, iExecute } from "@/lib/invoice/db";
import { encryptSecret } from "@/lib/invoice/crypto";
import { GmailApiError } from "@/lib/invoice/gmail/oauth";
import {
  syncGmailAccount,
  rescanGmailAccount,
  listGmailAccounts,
} from "@/lib/invoice/services/gmail";
import {
  runForwarding,
  approveAndForward,
  listCcRecipients,
  getForwardingSettings,
} from "@/lib/invoice/services/forwarding";
import { getInvoiceDbStatus } from "@/lib/invoice/status";

// --- Test fixtures (generic, non-personal addresses) ------------------------
const ORG = "org_itest";
const INT = "int_itest";
const ACCOUNT_EMAIL = "invoices-inbox@example.test";
const DESTINATION = "finance@example.test";
const CC = ["ap1@example.test", "ap2@example.test"];
const ACTOR = { id: "user_itest", email: "approver@example.test" };

// The invoice message (detected via its ATTACHMENT name + "Tax Invoice" subject
// → 93% confidence → auto-forward eligible). Its attachment carries real bytes.
const INVOICE_MSG_ID = "gmsg_invoice_1";
const INVOICE_PDF = Buffer.from("%PDF-1.4 REAL INVOICE BYTES — integration test");
const INVOICE_RAW = Buffer.from(
  "From: Acme Supplies <billing@acme.example>\r\nSubject: Tax Invoice INV-9\r\n\r\nSee attached.",
  "utf8",
);
// A non-invoice newsletter — must NEVER become an invoice candidate or forward.
const NEWSLETTER_MSG_ID = "gmsg_newsletter_1";

type Part = {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  headers?: { name: string; value: string }[];
  parts?: Part[];
};
function makeMessage(id: string): { id: string; threadId: string; snippet: string; internalDate: string; payload: Part } {
  if (id === INVOICE_MSG_ID) {
    return {
      id,
      threadId: "thread_inv",
      snippet: "Please find the tax invoice attached.",
      internalDate: String(Date.UTC(2026, 10, 20)),
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "Subject", value: "Tax Invoice INV-9" },
          { name: "From", value: "Acme Supplies <billing@acme.example>" },
          { name: "To", value: ACCOUNT_EMAIL },
        ],
        parts: [
          { mimeType: "text/plain", body: { size: 10 } },
          { filename: "Invoice-INV-9.pdf", mimeType: "application/pdf", body: { attachmentId: "att_pdf_1", size: INVOICE_PDF.length } },
        ],
      },
    };
  }
  // Newsletter
  return {
    id,
    threadId: "thread_news",
    snippet: "This month's promotions and campus updates.",
    internalDate: String(Date.UTC(2026, 10, 21)),
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "Subject", value: "October Newsletter" },
        { name: "From", value: "Campus News <news@site.example>" },
        { name: "To", value: ACCOUNT_EMAIL },
      ],
      parts: [
        { mimeType: "text/plain", body: { size: 10 } },
        { filename: "newsletter.pdf", mimeType: "application/pdf", body: { attachmentId: "att_news_1", size: 20 } },
      ],
    },
  };
}

/** Apply every db/invoice/*.sql migration in order to a fresh connection. */
async function applyMigrations(conn: mysql2.Connection): Promise<void> {
  const dir = path.join(process.cwd(), "db", "invoice");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(path.join(dir, f), "utf8");
    await conn.query(sql);
  }
}

/** Seed the org / integration / forwarding settings / CC recipients. */
async function seed(): Promise<void> {
  // Valid, NON-expired, encrypted access token → getValidAccessToken returns it
  // without any network/refresh.
  const tokenEnc = encryptSecret("itest-access-token");
  const future = new Date(Date.now() + 60 * 60 * 1000);
  await iExecute("INSERT INTO `organizations` (`id`,`name`) VALUES (?,?)", [ORG, "ITest Org"]);
  await iExecute(
    "INSERT INTO `gmail_integrations` (`id`,`organization_id`,`email`,`access_token_enc`,`refresh_token_enc`,`token_expires_at`,`status`,`history_id`) " +
      "VALUES (?,?,?,?,?,?,'connected',NULL)",
    [INT, ORG, ACCOUNT_EMAIL, tokenEnc, encryptSecret("itest-refresh-token"), future],
  );
  await iExecute(
    "INSERT INTO `gmail_sync_states` (`id`,`organization_id`,`gmail_integration_id`) VALUES (?,?,?)",
    ["sync_itest", ORG, INT],
  );
  await iExecute(
    "INSERT INTO `forwarding_settings` (`organization_id`,`finance_destination`,`min_confidence`,`enabled`) VALUES (?,?,?,1)",
    [ORG, DESTINATION, "70.00"],
  );
  for (const [i, email] of CC.entries()) {
    await iExecute("INSERT INTO `forwarding_cc_recipients` (`id`,`organization_id`,`email`) VALUES (?,?,?)", [
      `cc_${i}`,
      ORG,
      email,
    ]);
  }
}

/** Remove all rows this test created, so each test starts clean. */
async function truncateAll(): Promise<void> {
  // children → parents; FK on forwarding_cc_recipients cascades from organizations
  for (const t of [
    "invoice_forwards",
    "email_attachments",
    "email_messages",
    "forwarding_cc_recipients",
    "forwarding_settings",
    "gmail_sync_states",
    "gmail_integrations",
    "organizations",
    "processing_jobs",
  ]) {
    await iExecute(`DELETE FROM \`${t}\``).catch(() => undefined);
  }
}

/** Reset the Gmail mocks to the happy path (invoice present, send succeeds). */
function resetGmailMocks(): void {
  g.listMessages.mockReset().mockResolvedValue({ messages: [{ id: INVOICE_MSG_ID }] });
  g.getMessage.mockReset().mockImplementation(async (_t: string, id: string) => makeMessage(id));
  g.getAttachment.mockReset().mockImplementation(async (_t: string, _m: string, attId: string) =>
    attId === "att_pdf_1" ? INVOICE_PDF : Buffer.from("other"),
  );
  g.getRaw.mockReset().mockResolvedValue(INVOICE_RAW.toString("base64url"));
  g.send.mockReset().mockResolvedValue({ id: "sent_gmail_id", threadId: "thread_sent" });
  // No Pub/Sub history → always falls back to the bounded inbox query.
  g.getProfile.mockReset().mockResolvedValue({ emailAddress: ACCOUNT_EMAIL, historyId: "" });
  g.listHistory.mockReset().mockResolvedValue({ expired: true, messageIds: [], historyId: "" });
}

describe.skipIf(!READY)("invoice forwarding — MySQL integration (disposable DB)", () => {
  beforeAll(async () => {
    // Create a disposable database and apply ALL migrations to it. Also applies
    // them a SECOND time to prove migration 008 is idempotent / safe to re-run.
    const admin = await mysql2.createConnection({
      host: DB.host,
      port: DB.port,
      user: DB.user,
      password: DB.password,
      multipleStatements: true,
    });
    await admin.query(`DROP DATABASE IF EXISTS \`${DB.name}\``);
    await admin.query(`CREATE DATABASE \`${DB.name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`USE \`${DB.name}\``);
    await applyMigrations(admin);
    // Re-running the SAME migration files must not throw (idempotent).
    await applyMigrations(admin);
    await admin.end();

    // Point the app's dedicated invoice pool at the disposable DB. The pool is
    // created lazily on first query, so setting env here (before any query) is
    // enough; clear any pool a previous file may have cached.
    const pooled = globalThis as unknown as { __invoicePool?: { end?: () => Promise<void> } };
    if (pooled.__invoicePool) {
      await pooled.__invoicePool.end?.().catch(() => undefined);
      delete pooled.__invoicePool;
    }
    process.env.ATLAS_INVOICE_DB_HOST = DB.host;
    process.env.ATLAS_INVOICE_DB_PORT = String(DB.port);
    process.env.ATLAS_INVOICE_DB_USER = DB.user;
    process.env.ATLAS_INVOICE_DB_PASSWORD = DB.password;
    process.env.ATLAS_INVOICE_DB_NAME = DB.name;
  }, 60_000);

  afterAll(async () => {
    const pooled = globalThis as unknown as { __invoicePool?: { end?: () => Promise<void> } };
    if (pooled.__invoicePool) {
      await pooled.__invoicePool.end?.().catch(() => undefined);
      delete pooled.__invoicePool;
    }
    const admin = await mysql2
      .createConnection({ host: DB.host, port: DB.port, user: DB.user, password: DB.password })
      .catch(() => null);
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${DB.name}\``).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  beforeEach(async () => {
    await truncateAll();
    await seed();
    resetGmailMocks();
  });

  async function countForwards(): Promise<number> {
    const r = await iQueryOne<{ c: number }>(
      "SELECT COUNT(*) c FROM `invoice_forwards` WHERE organization_id=? AND source_gmail_message_id=?",
      [ORG, INVOICE_MSG_ID],
    );
    return Number(r?.c ?? 0);
  }
  async function countMessages(): Promise<number> {
    const r = await iQueryOne<{ c: number }>(
      "SELECT COUNT(*) c FROM `email_messages` WHERE gmail_integration_id=? AND gmail_message_id=?",
      [INT, INVOICE_MSG_ID],
    );
    return Number(r?.c ?? 0);
  }
  async function theForward() {
    return iQueryOne<{ id: string; status: string; attempts: number; last_error: string | null; forwarded_message_id: string | null }>(
      "SELECT id, status, attempts, last_error, forwarded_message_id FROM `invoice_forwards` WHERE organization_id=? AND source_gmail_message_id=?",
      [ORG, INVOICE_MSG_ID],
    );
  }

  // --- Scenario 1 ---------------------------------------------------------
  it("1) the same Gmail message across multiple syncs is ingested & queued exactly once", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);
    await syncGmailAccount(ORG, INT, ACTOR);
    await syncGmailAccount(ORG, INT, ACTOR);

    expect(await countMessages()).toBe(1);
    expect(await countForwards()).toBe(1);
    const f = await theForward();
    // auto_forward defaults OFF (seeded gmail_integrations has no auto_forward=1) → pending.
    expect(["pending", "approved"]).toContain(f?.status);
  });

  // --- Scenario 2 ---------------------------------------------------------
  it("2) Rescan Inbox reuses the existing invoice record and never resets/resends it", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);
    const before = await theForward();
    // Approve + forward it so it is in a terminal 'forwarded' state.
    await approveAndForward(ORG, ACTOR, before!.id);
    const sentCalls = g.send.mock.calls.length;
    expect(sentCalls).toBe(1);
    const forwardedId = (await theForward())!.forwarded_message_id;
    expect((await theForward())!.status).toBe("forwarded");

    // Rescan: deletes only non-candidate rows; the invoice + its forward stay.
    await rescanGmailAccount(ORG, INT, ACTOR);

    expect(await countMessages()).toBe(1);
    expect(await countForwards()).toBe(1);
    const after = await theForward();
    expect(after!.status).toBe("forwarded"); // NOT reset to pending/approved
    expect(after!.forwarded_message_id).toBe(forwardedId);
    expect(g.send.mock.calls.length).toBe(sentCalls); // NOT resent
  });

  // --- Scenario 3 ---------------------------------------------------------
  it("3) two overlapping workers forwarding the same message send it exactly once", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);
    const f = await theForward();
    // Put it in the 'approved' state so the forwarding runners will pick it up.
    await iExecute("UPDATE `invoice_forwards` SET status='approved' WHERE id=?", [f!.id]);

    // Two runners race. The atomic claim (approved→sending) must let only one send.
    const [a, b] = await Promise.all([runForwarding(ORG), runForwarding(ORG)]);

    expect(g.send.mock.calls.length).toBe(1); // sent exactly once
    const sentTotal = a.forwarded + b.forwarded;
    expect(sentTotal).toBe(1);
    expect((await theForward())!.status).toBe("forwarded");
    expect(await countForwards()).toBe(1);
  });

  // --- Scenario 4 ---------------------------------------------------------
  it("4) a successful forward, then a retry, does not resend", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);
    const f = await theForward();
    const r1 = await approveAndForward(ORG, ACTOR, f!.id);
    expect(r1.ok).toBe(true);
    expect(g.send.mock.calls.length).toBe(1);

    // Retry the exact same approval action.
    const r2 = await approveAndForward(ORG, ACTOR, f!.id);
    expect(r2.ok).toBe(true);
    expect(r2.message).toMatch(/already forwarded/i);
    expect(g.send.mock.calls.length).toBe(1); // still exactly one send
  });

  // --- Scenario 5 ---------------------------------------------------------
  it("5a) a crash after Gmail accepted the send (status left 'sending') is NOT resent", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);
    const f = await theForward();
    // Simulate a crash mid-send: Gmail accepted it, but the process died before
    // writing 'forwarded'. The row is stuck in 'sending'.
    await iExecute("UPDATE `invoice_forwards` SET status='sending', attempts=1 WHERE id=?", [f!.id]);

    // A subsequent forwarding cycle only retries 'approved' rows — never 'sending'.
    const res = await runForwarding(ORG);
    expect(g.send.mock.calls.length).toBe(0); // never resent
    expect(res.forwarded).toBe(0);
    expect((await theForward())!.status).toBe("sending"); // parked for reconciliation
  });

  it("5b) an AMBIGUOUS send (network/timeout) parks the row for review and is NOT auto-retried", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);
    const f = await theForward();
    await iExecute("UPDATE `invoice_forwards` SET status='approved' WHERE id=?", [f!.id]);

    // A raw (non-GmailApiError) error = Gmail may or may not have sent it.
    g.send.mockRejectedValueOnce(new Error("socket hang up"));
    const res = await runForwarding(ORG);

    expect(g.send.mock.calls.length).toBe(1);
    expect(res.unknown).toBe(1);
    expect(res.forwarded).toBe(0);
    expect(res.failed).toBe(0);
    const parked = await theForward();
    expect(parked!.status).toBe("review"); // NOT 'failed', NOT 'approved'
    expect(parked!.last_error).toMatch(/UNKNOWN/);

    // The very next forwarding cycle must NOT blindly retry a 'review' row.
    const res2 = await runForwarding(ORG);
    expect(g.send.mock.calls.length).toBe(1); // unchanged — no blind retry
    expect(res2.forwarded).toBe(0);
  });

  it("5c) a DEFINITE Gmail rejection (HTTP error) marks the row 'failed' (not sent)", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);
    const f = await theForward();
    await iExecute("UPDATE `invoice_forwards` SET status='approved' WHERE id=?", [f!.id]);

    g.send.mockRejectedValueOnce(new GmailApiError("Recipient address rejected", 400));
    const res = await runForwarding(ORG);
    expect(res.failed).toBe(1);
    expect(res.unknown).toBe(0);
    expect((await theForward())!.status).toBe("failed");
  });

  it("5d) an UNCERTAIN Gmail 5xx server error is AMBIGUOUS (review), NOT a definite failure, and is NOT auto-retried", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);
    const f = await theForward();
    await iExecute("UPDATE `invoice_forwards` SET status='approved' WHERE id=?", [f!.id]);

    // 503 (and any 5xx/429/408) = Gmail may or may not have accepted it.
    g.send.mockRejectedValueOnce(new GmailApiError("Gmail API error: 503", 503));
    const res = await runForwarding(ORG);
    expect(res.unknown).toBe(1);
    expect(res.failed).toBe(0); // explicitly NOT a definite failure
    const parked = await theForward();
    expect(parked!.status).toBe("review");
    expect(parked!.last_error).toMatch(/UNKNOWN.*HTTP 503/);

    // Not auto-retried on the next cycle.
    const res2 = await runForwarding(ORG);
    expect(g.send.mock.calls.length).toBe(1);
    expect(res2.forwarded).toBe(0);
  });

  // --- Scenario 6 ---------------------------------------------------------
  it("6) a duplicate forward for the same (org, Gmail message, destination) is rejected by the DB", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);

    // (a) The message-scoped unique key catches a duplicate even when it is
    // attached to a DIFFERENT email_messages row (so the secondary
    // (email_message_id, destination) key would NOT catch it). Create a second
    // valid email_messages row, then try to forward the SAME Gmail message id
    // to the SAME destination again.
    await iExecute(
      "INSERT INTO `email_messages` (`id`,`organization_id`,`gmail_integration_id`,`gmail_message_id`,`is_invoice_candidate`,`processing_status`) " +
        "VALUES (?,?,?,?,1,'processed')",
      ["em_dup_row", ORG, INT, `${INVOICE_MSG_ID}_dup`],
    );
    await expect(
      iExecute(
        "INSERT INTO `invoice_forwards` (`id`,`organization_id`,`gmail_integration_id`,`email_message_id`,`source_gmail_message_id`,`destination`,`status`) " +
          "VALUES (?,?,?,?,?,?,'approved')",
        ["dup_forward_1", ORG, INT, "em_dup_row", INVOICE_MSG_ID, DESTINATION],
      ),
    ).rejects.toThrow(/duplicate entry/i);

    // (b) The secondary (email_message_id, destination) key still guards the
    // same email row being forwarded twice to the same destination.
    const em = await iQueryOne<{ id: string }>(
      "SELECT id FROM `email_messages` WHERE gmail_integration_id=? AND gmail_message_id=?",
      [INT, INVOICE_MSG_ID],
    );
    await expect(
      iExecute(
        "INSERT INTO `invoice_forwards` (`id`,`organization_id`,`gmail_integration_id`,`email_message_id`,`source_gmail_message_id`,`destination`,`status`) " +
          "VALUES (?,?,?,?,?,?,'approved')",
        ["dup_forward_2", ORG, INT, em!.id, INVOICE_MSG_ID, DESTINATION],
      ),
    ).rejects.toThrow(/duplicate entry/i);

    // Still exactly one real forward for this Gmail message.
    expect(await countForwards()).toBe(1);
  });

  // --- Attachments + CC in the outgoing MIME ------------------------------
  it("forwards the ACTUAL PDF (filename + MIME + bytes) and every CC recipient — no real email sent", async () => {
    await syncGmailAccount(ORG, INT, ACTOR);
    const f = await theForward();
    await approveAndForward(ORG, ACTOR, f!.id);

    expect(g.send.mock.calls.length).toBe(1);
    const rawB64Url: string = g.send.mock.calls[0][1];
    const mime = Buffer.from(rawB64Url, "base64url").toString("utf8");

    // Finance destination is the To; both CC addresses are present.
    expect(mime).toContain(`To: ${DESTINATION}`);
    expect(mime).toContain(`Cc: ${CC.join(", ")}`);

    // The real PDF attachment: filename + MIME type preserved, bytes decodable.
    expect(mime).toContain('Content-Type: application/pdf; name="Invoice-INV-9.pdf"');
    expect(mime).toContain('filename="Invoice-INV-9.pdf"');
    const marker = 'filename="Invoice-INV-9.pdf"';
    const b64Marker = "Content-Transfer-Encoding: base64\r\n\r\n";
    const bodyStart = mime.indexOf(b64Marker, mime.indexOf(marker)) + b64Marker.length;
    const b64 = mime.slice(bodyStart, mime.indexOf("\r\n--", bodyStart)).replace(/\r\n/g, "");
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(INVOICE_PDF.toString("utf8"));

    // original.eml is still attached as an additional option.
    expect(mime).toContain('filename="original.eml"');

    // The CC list the service used matches what is persisted.
    const cc = (await listCcRecipients(ORG)).map((r) => r.email);
    expect(cc).toEqual(CC);
  });

  // --- Non-invoice emails never increase invoice counts -------------------
  it("a non-invoice newsletter is NOT counted as an invoice and is NOT forwarded", async () => {
    g.listMessages.mockResolvedValue({ messages: [{ id: INVOICE_MSG_ID }, { id: NEWSLETTER_MSG_ID }] });
    await syncGmailAccount(ORG, INT, ACTOR);

    // Only the invoice is a candidate / forward; the newsletter is ingested as skipped.
    const candidates = await iQueryOne<{ c: number }>(
      "SELECT COUNT(*) c FROM `email_messages` WHERE organization_id=? AND is_invoice_candidate=1",
      [ORG],
    );
    expect(Number(candidates?.c)).toBe(1);
    const forwards = await iQueryOne<{ c: number }>(
      "SELECT COUNT(*) c FROM `invoice_forwards` WHERE organization_id=?",
      [ORG],
    );
    expect(Number(forwards?.c)).toBe(1);

    // The dashboard/account view reflects invoice-only counts.
    const accounts = await listGmailAccounts(ORG);
    const acct = accounts.find((a) => a.id === INT)!;
    expect(Number(acct.invoice_detected)).toBe(1); // the newsletter did NOT bump this
  });

  // --- Hardening: reachable-but-unmigrated DB must not crash --------------
  it("degrades gracefully when the invoice DB is reachable but not migrated to 008 (no crash)", async () => {
    // Simulate a deploy-before-migrate window: the latest table is absent.
    await iExecute("DROP TABLE IF EXISTS `forwarding_cc_recipients`");
    try {
      // The Settings-page crash path: listCcRecipients must return [] not throw.
      expect(await listCcRecipients(ORG)).toEqual([]);

      // Status reports the base schema present but the newer migration pending.
      const st = await getInvoiceDbStatus();
      expect(st.reachable).toBe(true);
      expect(st.migrated).toBe(true);
      expect(st.schemaOutdated).toBe(true);

      // getForwardingSettings still works while its own table exists...
      expect((await getForwardingSettings(ORG)).financeDestination).toBe(DESTINATION);
      // ...and also tolerates ITS table being absent (returns safe defaults).
      await iExecute("DROP TABLE IF EXISTS `forwarding_settings`");
      expect(await getForwardingSettings(ORG)).toEqual({
        financeDestination: null,
        minConfidence: 70,
        enabled: true,
      });
    } finally {
      // Recreate the dropped tables so other tests / beforeEach are unaffected.
      const conn = await mysql2.createConnection({
        host: DB.host,
        port: DB.port,
        user: DB.user,
        password: DB.password,
        database: DB.name,
        multipleStatements: true,
      });
      for (const f of ["007_forwarding.sql", "008_forwarding_cc_and_dedup.sql"]) {
        await conn.query(readFileSync(path.join(process.cwd(), "db", "invoice", f), "utf8"));
      }
      await conn.end();
    }
  });

  // --- Migration 008 / schema shape ---------------------------------------
  it("migration 008 produced the message-scoped unique index on NOT NULL columns", async () => {
    const idx = await iQuery<{ COLUMN_NAME: string; NULLABLE: string; NON_UNIQUE: number }>(
      "SELECT s.COLUMN_NAME, c.IS_NULLABLE AS NULLABLE, s.NON_UNIQUE FROM information_schema.STATISTICS s " +
        "JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA=s.TABLE_SCHEMA AND c.TABLE_NAME=s.TABLE_NAME AND c.COLUMN_NAME=s.COLUMN_NAME " +
        "WHERE s.TABLE_SCHEMA=DATABASE() AND s.TABLE_NAME='invoice_forwards' AND s.INDEX_NAME='invoice_forwards_msg_dest_key' " +
        "ORDER BY s.SEQ_IN_INDEX",
      [],
    );
    expect(idx.map((r) => r.COLUMN_NAME)).toEqual([
      "organization_id",
      "source_gmail_message_id",
      "destination",
    ]);
    // Unique, and every column is NOT NULL (so there is no NULL-duplicate loophole).
    expect(idx.every((r) => Number(r.NON_UNIQUE) === 0)).toBe(true);
    expect(idx.every((r) => r.NULLABLE === "NO")).toBe(true);
  });
});
