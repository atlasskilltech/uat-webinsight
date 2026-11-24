import { describe, it, expect, afterEach } from "vitest";
import { gmailPollFallbackMinutes } from "@/lib/invoice/config";

const orig = process.env.GMAIL_SYNC_INTERVAL_MIN;
afterEach(() => {
  if (orig === undefined) delete process.env.GMAIL_SYNC_INTERVAL_MIN;
  else process.env.GMAIL_SYNC_INTERVAL_MIN = orig;
});

describe("Gmail polling fallback cadence is capped at 2 minutes", () => {
  it("defaults to 2 when unset or invalid", () => {
    delete process.env.GMAIL_SYNC_INTERVAL_MIN;
    expect(gmailPollFallbackMinutes()).toBe(2);
    process.env.GMAIL_SYNC_INTERVAL_MIN = "not-a-number";
    expect(gmailPollFallbackMinutes()).toBe(2);
    process.env.GMAIL_SYNC_INTERVAL_MIN = "0";
    expect(gmailPollFallbackMinutes()).toBe(2);
  });

  it("CAPS any larger value at 2 (the maximum fallback latency)", () => {
    for (const v of ["3", "5", "10", "60"]) {
      process.env.GMAIL_SYNC_INTERVAL_MIN = v;
      expect(gmailPollFallbackMinutes()).toBe(2);
    }
  });

  it("allows a smaller override (min 1)", () => {
    process.env.GMAIL_SYNC_INTERVAL_MIN = "1";
    expect(gmailPollFallbackMinutes()).toBe(1);
  });
});
