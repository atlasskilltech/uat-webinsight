import { describe, it, expect } from "vitest";
import { isSelfSent, decideForwardStatus } from "@/lib/invoice/services/gmail";

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
