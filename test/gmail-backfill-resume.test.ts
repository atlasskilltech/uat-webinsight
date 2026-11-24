import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Regression tests for Phase 5 historical Gmail search + backfill reliability.
 *
 * Covers the verification checks that are pure logic (no live DB needed):
 *   #1 Backfill RESUMES older on repeat calls — no silently-skipped messages.
 *   #3/#7 Backfill is BOUNDED per call (maxMessages / days input limits).
 *   #5 Backfill NEVER forwards (backfill:true is passed to the sync).
 *   #6 Organization / connected-account ISOLATION (cross-org refused).
 *   #8 Live search reports PARTIAL failures honestly (never claims full coverage).
 */

// Mutable cursor the mocked DB returns for the "oldest indexed message" query.
let oldestCursor: { oldest: string | null } | null = null;

vi.mock("@/lib/invoice/db", () => ({
  iQuery: vi.fn(async () => []),
  iQueryOne: vi.fn(async (sql: string) =>
    sql.includes("MIN(`received_at`)") ? oldestCursor : null,
  ),
}));

const syncGmailAccount = vi.fn(async (..._args: unknown[]) => ({
  newMessages: 2,
  invoicesCreated: 1,
  duplicates: 0,
}));
const getAccountAccessToken = vi.fn(async (..._args: unknown[]) => "token-xyz");

vi.mock("@/lib/invoice/services/gmail", () => ({
  // Only ORG-ATLAS has a connected account; any other org sees nothing.
  listGmailAccounts: vi.fn(async (orgId: string) =>
    orgId === "ORG-ATLAS"
      ? [{ id: "intg-1", email: "ap@atlas.test", status: "connected" }]
      : [],
  ),
  getAccountAccessToken: (...a: unknown[]) => getAccountAccessToken(...(a as [])),
  syncGmailAccount: (...a: unknown[]) => syncGmailAccount(...(a as [])),
  classifyEmail: vi.fn(),
}));

const gmailListMessages = vi.fn(async () => ({ messages: [], nextPageToken: undefined }));
vi.mock("@/lib/invoice/gmail/api", () => ({
  gmailListMessages: (...a: unknown[]) => gmailListMessages(...(a as [])),
  gmailGetMessage: vi.fn(),
  getHeader: vi.fn(() => null),
  collectAttachments: vi.fn(() => []),
}));

vi.mock("@/lib/invoice/services/agent", () => ({ listActivity: vi.fn(async () => []) }));
vi.mock("@/lib/invoice/services/forwarding", () => ({
  listForwards: vi.fn(async () => []),
  forwardCounts: vi.fn(async () => ({})),
}));

import { getTool, type AgentContext } from "@/lib/invoice/agent/tools";

const ctx: AgentContext = {
  organizationId: "ORG-ATLAS",
  user: { id: "u1", email: "tech@atlas.test" },
  role: "FINANCE_ADMIN",
};

beforeEach(() => {
  oldestCursor = null;
  syncGmailAccount.mockClear();
  getAccountAccessToken.mockClear();
  gmailListMessages.mockClear();
});

const backfill = () => getTool("backfill_email_index")!;

describe("backfill_email_index: resumable, bounded, isolated, never forwards", () => {
  it("#1 first call (empty index) starts from NEWEST — no before: cursor", async () => {
    oldestCursor = null;
    const res = await backfill().run(ctx, { account: "ap@atlas.test", days: 365, maxMessages: 200 });
    expect(res.ok).toBe(true);
    const opts = syncGmailAccount.mock.calls[0][3] as { query: string; backfill: boolean; maxMessages: number };
    expect(opts.query).not.toContain("before:");
    expect(opts.query).toContain("newer_than:365d");
    expect((res.data as { resuming: boolean }).resuming).toBe(false);
  });

  it("#1 repeat call RESUMES older via before:<oldest+1day> (no skipped window)", async () => {
    // Oldest already-indexed message is 2024-05-06; next call must walk older,
    // re-including the boundary day (dedupe handles the overlap) => before:2024/5/7.
    oldestCursor = { oldest: "2024-05-06T10:00:00.000Z" };
    const res = await backfill().run(ctx, { account: "ap@atlas.test", days: 3650, maxMessages: 200 });
    expect(res.ok).toBe(true);
    const opts = syncGmailAccount.mock.calls[0][3] as { query: string };
    expect(opts.query).toContain("before:2024/5/7");
    expect((res.data as { resuming: boolean }).resuming).toBe(true);
  });

  it("#1 the cursor advances across calls so progress is monotonic (older each time)", async () => {
    // Simulate two sequential calls as the index grows older.
    oldestCursor = { oldest: "2024-05-06T00:00:00.000Z" };
    await backfill().run(ctx, { account: "ap@atlas.test" });
    const q1 = (syncGmailAccount.mock.calls[0][3] as { query: string }).query;

    oldestCursor = { oldest: "2023-11-02T00:00:00.000Z" }; // older boundary after more ingest
    await backfill().run(ctx, { account: "ap@atlas.test" });
    const q2 = (syncGmailAccount.mock.calls[1][3] as { query: string }).query;

    expect(q1).toContain("before:2024/5/7");
    expect(q2).toContain("before:2023/11/3");
    expect(q1).not.toEqual(q2); // genuinely moved the window, not re-fetching page 1
  });

  it("#5 always passes backfill:true (never creates forward tasks / sends)", async () => {
    await backfill().run(ctx, { account: "ap@atlas.test" });
    const opts = syncGmailAccount.mock.calls[0][3] as { backfill: boolean; query: string };
    expect(opts.backfill).toBe(true);
    expect(opts.query).toContain("-in:sent"); // excludes the account's own sent mail
  });

  it("#3/#7 input schema bounds the work per call (maxMessages<=1000, days<=3650)", () => {
    const schema = backfill().input;
    expect(schema.safeParse({ account: "ap@atlas.test", maxMessages: 5000 }).success).toBe(false);
    expect(schema.safeParse({ account: "ap@atlas.test", days: 99999 }).success).toBe(false);
    expect(schema.safeParse({ account: "ap@atlas.test", maxMessages: 1000, days: 3650 }).success).toBe(true);
    expect(schema.safeParse({ account: "" }).success).toBe(false); // account required
  });

  it("#6 refuses an account not connected in the caller's organization (no sync runs)", async () => {
    const res = await backfill().run(ctx, { account: "someone-else@other.test" });
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/No connected Gmail account/i);
    expect(syncGmailAccount).not.toHaveBeenCalled();
  });

  it("#6 a different organization cannot reach this org's account", async () => {
    const otherOrg: AgentContext = { ...ctx, organizationId: "ORG-ISDI" };
    const res = await backfill().run(otherOrg, { account: "ap@atlas.test" });
    expect(res.ok).toBe(false);
    expect(syncGmailAccount).not.toHaveBeenCalled();
  });
});

describe("search_gmail_messages: honest partial-failure reporting (#8)", () => {
  const liveSearch = () => getTool("search_gmail_messages")!;

  it("reports an unreachable mailbox instead of claiming full coverage", async () => {
    getAccountAccessToken.mockRejectedValueOnce(new Error("token refresh failed: invalid_grant"));
    const res = await liveSearch().run(ctx, { query: "invoice", invoiceNumber: "INV-9" });
    expect(res.ok).toBe(true);
    const data = res.data as { notAccessed: { account: string }[]; matches: unknown[] };
    expect(data.notAccessed).toHaveLength(1);
    expect(data.notAccessed[0].account).toBe("ap@atlas.test");
    expect(res.summary).toMatch(/could not be accessed|Searched 0\/1/i);
    expect(res.summary).not.toMatch(/Searched all/i);
  });

  it("never exposes access tokens in results", async () => {
    gmailListMessages.mockResolvedValueOnce({ messages: [], nextPageToken: undefined });
    const res = await liveSearch().run(ctx, { query: "invoice" });
    expect(JSON.stringify(res)).not.toContain("token-xyz");
  });

  it("requires at least one filter (won't dump the whole mailbox)", async () => {
    const res = await liveSearch().run(ctx, {});
    expect(res.ok).toBe(false);
    expect(res.summary).toMatch(/at least one search filter/i);
  });
});
