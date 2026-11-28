import { describe, it, expect } from "vitest";
import { isSelfSent, decideForwardStatus, isWithinForwardWindow } from "@/lib/invoice/services/gmail";

/**
 * Guards that prevent the forwarding loop and gate auto-forwarding. These are
 * pure helpers used by the Gmail sync; the DB-level duplicate guarantees
 * (unique keys, atomic claim) are enforced by migration 008 + sendForward.
 */

describe("gmail ingest: self-sent exclusion (loop prevention)", () => {
  const account = "tech@atlasuniversity.edu.in";

  it("treats the account's own outgoing mail (its forwards) as self-sent → never ingested", () => {
    expect(isSelfSent("Atlas Invoice Agent <tech@atlasuniversity.edu.in>", account)).toBe(true);
    expect(isSelfSent("tech@atlasuniversity.edu.in", account)).toBe(true);
  });

  it("treats genuine incoming mail from a vendor as NOT self-sent", () => {
    expect(isSelfSent("Acme Supplies <accounts@acme-supplies.com>", account)).toBe(false);
  });

  it("is case-insensitive and safe on empty inputs", () => {
    expect(isSelfSent("TECH@ATLASUNIVERSITY.EDU.IN", account)).toBe(true);
    expect(isSelfSent("someone@x.com", "")).toBe(false);
  });
});

describe("gmail ingest: forward-status decision", () => {
  it("auto-forwards (approved) only when above threshold AND auto-forward is ON", () => {
    expect(decideForwardStatus(93, 70, true)).toBe("approved");
  });
  it("waits for approval (pending) when above threshold but auto-forward is OFF", () => {
    expect(decideForwardStatus(93, 70, false)).toBe("pending");
  });
  it("sends to review when confidence is below the threshold (regardless of auto-forward)", () => {
    expect(decideForwardStatus(60, 70, true)).toBe("review");
    expect(decideForwardStatus(60, 70, false)).toBe("review");
  });
  it("treats exactly-at-threshold as eligible", () => {
    expect(decideForwardStatus(70, 70, true)).toBe("approved");
  });
});

describe("gmail ingest: backfill guard (only forward mail received after connecting)", () => {
  const connectedAt = new Date("2026-11-28T09:00:00Z"); // when the account was connected

  it("forwards mail received AT/AFTER the connection time", () => {
    expect(isWithinForwardWindow(new Date("2026-11-28T09:00:00Z"), connectedAt, null)).toBe(true); // exactly at
    expect(isWithinForwardWindow(new Date("2026-11-28T09:05:00Z"), connectedAt, null)).toBe(true); // 5 min after
  });

  it("does NOT forward mail received BEFORE the connection time (the back-forward bug)", () => {
    expect(isWithinForwardWindow(new Date("2026-11-02T10:00:00Z"), connectedAt, null)).toBe(false); // old mail
    expect(isWithinForwardWindow(new Date("2026-11-28T08:59:59Z"), connectedAt, null)).toBe(false); // 1s before
  });

  it("falls back to created_at when forward_since is null (pre-existing rows)", () => {
    const createdAt = new Date("2026-11-20T00:00:00Z");
    expect(isWithinForwardWindow(new Date("2026-11-25T00:00:00Z"), null, createdAt)).toBe(true);
    expect(isWithinForwardWindow(new Date("2026-11-10T00:00:00Z"), null, createdAt)).toBe(false);
  });

  it("never back-forwards a message with no received date, and does not block when no cutoff is known", () => {
    expect(isWithinForwardWindow(null, connectedAt, null)).toBe(false); // unknown receipt time → skip
    expect(isWithinForwardWindow(new Date("2026-11-02T00:00:00Z"), null, null)).toBe(true); // no cutoff → legacy allow
  });

  it("prefers forward_since over created_at (reconnect resets the window)", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z"); // old original connect
    const reconnectedAt = new Date("2026-11-28T09:00:00Z"); // reconnected today
    expect(isWithinForwardWindow(new Date("2026-06-01T00:00:00Z"), reconnectedAt, createdAt)).toBe(false); // before reconnect
    expect(isWithinForwardWindow(new Date("2026-11-28T10:00:00Z"), reconnectedAt, createdAt)).toBe(true);
  });

  it("drops the gate for a FUTURE (mis-stamped) forward_since so current mail forwards", () => {
    const now = new Date("2026-11-28T11:00:00Z");
    const skewed = new Date("2026-11-28T16:30:00Z"); // forward_since mis-stamped +5.5h (non-UTC/IST skew)
    // The real-world case the earlier "clamp to now" fix missed: mail that arrived
    // a minute or two BEFORE the sync tick. Clamping the future cutoff to `now`
    // left it "before" the cutoff and wrongly blocked — which is why forwarding
    // stayed dead on the IST server. A corrupt future cutoff is unreliable, so the
    // gate is dropped and such mail forwards.
    expect(isWithinForwardWindow(new Date("2026-11-28T10:59:00Z"), skewed, null, now)).toBe(true); // 1 min before the tick
    expect(isWithinForwardWindow(new Date("2026-11-28T10:58:30Z"), skewed, null, now)).toBe(true); // 90s before the tick
    expect(isWithinForwardWindow(new Date("2026-11-28T11:00:05Z"), skewed, null, now)).toBe(true); // just after
    // A corrupt cutoff carries no reliable backfill boundary, so even older mail
    // is allowed here; re-forwarding history is still prevented by the backfill
    // guard at the call site (forwards are not created during the initial sync).
    expect(isWithinForwardWindow(new Date("2026-11-02T00:00:00Z"), skewed, null, now)).toBe(true);
  });

  it("keeps blocking old mail for a CORRECT (past) forward_since", () => {
    const now = new Date("2026-11-28T11:00:00Z");
    const good = new Date("2026-11-28T09:00:00Z"); // connected 2h ago, correctly stamped
    expect(isWithinForwardWindow(new Date("2026-11-28T10:00:00Z"), good, null, now)).toBe(true); // after connect → forward
    expect(isWithinForwardWindow(new Date("2026-11-20T00:00:00Z"), good, null, now)).toBe(false); // before connect → held
  });
});
