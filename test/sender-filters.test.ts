import { describe, it, expect } from "vitest";
import {
  extractSenderEmail,
  normalizeSenderPattern,
  senderMatchesPattern,
  evaluateSenderForward,
  type SenderFilters,
} from "@/lib/invoice/services/forwarding";

/**
 * Per-organisation sender gating for forwarding:
 *   - Allowed senders: when any are configured, ONLY those senders forward.
 *     With none configured (but the feature on), nothing forwards (fail-closed).
 *   - Excluded senders: never forwarded, even if otherwise allowed (block wins).
 * Patterns are a full email or a bare domain (also matches sub-domains).
 * When the feature table isn't migrated (configured:false), there is NO gating.
 */

const F = (allow: string[], block: string[], configured = true): SenderFilters => ({
  configured,
  allow: allow.map((pattern, i) => ({ id: `a${i}`, kind: "allow" as const, pattern })),
  block: block.map((pattern, i) => ({ id: `b${i}`, kind: "block" as const, pattern })),
});

describe("extractSenderEmail", () => {
  it("pulls the address from a display-name From header", () => {
    expect(extractSenderEmail('"Acme Billing" <billing@acme.com>')).toBe("billing@acme.com");
  });
  it("handles a bare address and lower-cases it", () => {
    expect(extractSenderEmail("Billing@ACME.com")).toBe("billing@acme.com");
  });
  it("handles 'Name email' without angle brackets", () => {
    expect(extractSenderEmail("Acme billing@acme.com")).toBe("billing@acme.com");
  });
  it("returns null when there is no parseable address", () => {
    expect(extractSenderEmail("not an email")).toBeNull();
    expect(extractSenderEmail("")).toBeNull();
  });

  // Regression: unusual but RFC-legal From headers must not be mis-parsed into a
  // wrong/unparseable address (which, with gating active, would wrongly drop a
  // legitimate allowed sender).
  it("ignores a quoted display name containing angle brackets and an @", () => {
    expect(extractSenderEmail('"Weird <tag> x@evil.com" <real@acme.com>')).toBe("real@acme.com");
  });
  it("handles a comma inside a quoted display name", () => {
    expect(extractSenderEmail('"Doe, John" <john@x.com>')).toBe("john@x.com");
  });
  it("handles a backslash-escaped quote in the display name", () => {
    expect(extractSenderEmail('"a\\"b" <c@d.com>')).toBe("c@d.com");
  });
  it("takes the real addr-spec when stray brackets precede it", () => {
    expect(extractSenderEmail("Name <not-an-addr> <real@acme.com>")).toBe("real@acme.com");
  });
  it("handles the address-in-comment form billing@acme.com (Acme)", () => {
    expect(extractSenderEmail("billing@acme.com (Acme Billing)")).toBe("billing@acme.com");
  });
  it("returns null for the null-sender <>", () => {
    expect(extractSenderEmail("<>")).toBeNull();
  });
  it("still parses a normal display-name address", () => {
    expect(extractSenderEmail("John Doe <john@x.com>")).toBe("john@x.com");
  });
});

describe("normalizeSenderPattern", () => {
  it("accepts a full email", () => {
    expect(normalizeSenderPattern("  Billing@Acme.com ")).toEqual({ ok: true, value: "billing@acme.com" });
  });
  it("accepts a bare domain and a leading-@ domain", () => {
    expect(normalizeSenderPattern("razorpay.com")).toEqual({ ok: true, value: "razorpay.com" });
    expect(normalizeSenderPattern("@razorpay.com")).toEqual({ ok: true, value: "razorpay.com" });
  });
  it("rejects junk", () => {
    expect(normalizeSenderPattern("").ok).toBe(false);
    expect(normalizeSenderPattern("nope").ok).toBe(false); // no dot, not an email
    expect(normalizeSenderPattern("a@b").ok).toBe(false); // not a valid email
  });
});

describe("senderMatchesPattern", () => {
  it("matches an exact email pattern only exactly", () => {
    expect(senderMatchesPattern("billing@acme.com", "billing@acme.com")).toBe(true);
    expect(senderMatchesPattern("other@acme.com", "billing@acme.com")).toBe(false);
  });
  it("matches a domain pattern on the domain and its sub-domains", () => {
    expect(senderMatchesPattern("a@acme.com", "acme.com")).toBe(true);
    expect(senderMatchesPattern("a@mail.acme.com", "acme.com")).toBe(true);
    expect(senderMatchesPattern("a@notacme.com", "acme.com")).toBe(false);
    expect(senderMatchesPattern("a@acme.com.evil.com", "acme.com")).toBe(false); // not a sub-domain of acme.com
  });
  it("tolerates a leading @ on a domain pattern", () => {
    expect(senderMatchesPattern("a@acme.com", "@acme.com")).toBe(true);
  });
});

describe("evaluateSenderForward — the forward gate", () => {
  const from = (addr: string) => `"Vendor" <${addr}>`;

  it("does NOT gate when the feature is not configured (pre-migration)", () => {
    const r = evaluateSenderForward(F([], [], false), from("anyone@anywhere.com"));
    expect(r).toEqual({ forward: true, reason: "not_configured" });
  });

  it("forwards everything when configured but no allowed senders exist (allow-list restricts only when populated)", () => {
    const r = evaluateSenderForward(F([], []), from("vendor@acme.com"));
    expect(r.forward).toBe(true);
  });

  it("still blocks an excluded sender even when the allow-list is empty", () => {
    const r = evaluateSenderForward(F([], ["spam.com"]), from("bulk@spam.com"));
    expect(r.forward).toBe(false);
    expect(r.reason).toBe("blocked");
  });

  it("forwards only senders on the allow-list (exact + domain)", () => {
    const filters = F(["billing@acme.com", "vendorco.com"], []);
    expect(evaluateSenderForward(filters, from("billing@acme.com")).forward).toBe(true);
    expect(evaluateSenderForward(filters, from("ap@vendorco.com")).forward).toBe(true); // domain
    expect(evaluateSenderForward(filters, from("ap@mail.vendorco.com")).forward).toBe(true); // sub-domain
    const blocked = evaluateSenderForward(filters, from("spam@other.com"));
    expect(blocked.forward).toBe(false);
    expect(blocked.reason).toBe("not_in_allowlist");
  });

  it("exclusions always win, even over an allowed domain (the Razorpay case)", () => {
    // Allow the whole domain, but exclude one vendor address / sub-sender.
    const filters = F(["acme.com"], ["razorpay.com", "noreply@acme.com"]);
    expect(evaluateSenderForward(filters, from("ap@acme.com")).forward).toBe(true);
    const r1 = evaluateSenderForward(filters, from("payments@razorpay.com"));
    expect(r1).toEqual({ forward: false, reason: "blocked" });
    const r2 = evaluateSenderForward(filters, from("noreply@acme.com")); // allowed by domain, excluded by address
    expect(r2).toEqual({ forward: false, reason: "blocked" });
  });

  it("fails closed on an unparseable sender when gating is active", () => {
    const r = evaluateSenderForward(F(["acme.com"], []), "garbled-from-header");
    expect(r.forward).toBe(false);
    expect(r.reason).toBe("unparseable_sender");
  });
});
