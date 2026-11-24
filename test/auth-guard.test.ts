import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SafeUser } from "@/lib/auth/types";

// Mock the session loader (also breaks the next-auth import chain in tests).
const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn<() => Promise<SafeUser | null>>() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));

import { requireUser, requireFullAccess, requireAdmin, isAuthError } from "@/lib/auth/guard";

const user = (over: Partial<SafeUser>): SafeUser => ({
  id: "u1",
  name: "U",
  email: "u@x.com",
  role: "user",
  status: "active",
  accessScope: "full",
  lastLoginAt: null,
  createdAt: new Date(0),
  ...over,
});

async function statusOf(fn: () => Promise<unknown>): Promise<number | "ok"> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return isAuthError(e) ? e.status : -1;
  }
}

beforeEach(() => getCurrentUser.mockReset());

describe("requireUser (unchanged — invoice features still work)", () => {
  it("allows any authenticated user, including invoice_only", async () => {
    getCurrentUser.mockResolvedValue(user({ accessScope: "invoice_only" }));
    expect(await statusOf(requireUser)).toBe("ok");
  });
  it("rejects an unauthenticated request (401)", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await statusOf(requireUser)).toBe(401);
  });
});

describe("requireFullAccess — protects restricted server actions / APIs", () => {
  it("allows a full-access user", async () => {
    getCurrentUser.mockResolvedValue(user({ accessScope: "full" }));
    expect(await statusOf(requireFullAccess)).toBe("ok");
  });
  it("REJECTS an invoice_only user (403)", async () => {
    getCurrentUser.mockResolvedValue(user({ accessScope: "invoice_only" }));
    expect(await statusOf(requireFullAccess)).toBe(403);
  });
  it("rejects unauthenticated (401)", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await statusOf(requireFullAccess)).toBe(401);
  });
});

describe("requireAdmin — admin + full access", () => {
  it("allows a full-access admin (existing admin unaffected)", async () => {
    getCurrentUser.mockResolvedValue(user({ role: "admin", accessScope: "full" }));
    expect(await statusOf(requireAdmin)).toBe("ok");
  });
  it("REJECTS an invoice_only admin (403)", async () => {
    getCurrentUser.mockResolvedValue(user({ role: "admin", accessScope: "invoice_only" }));
    expect(await statusOf(requireAdmin)).toBe(403);
  });
  it("rejects a full-access non-admin (403)", async () => {
    getCurrentUser.mockResolvedValue(user({ role: "user", accessScope: "full" }));
    expect(await statusOf(requireAdmin)).toBe(403);
  });
});

describe("revocation takes effect on the NEXT request", () => {
  it("re-reads scope each call — flipping to invoice_only immediately blocks, flipping back restores", async () => {
    getCurrentUser.mockResolvedValueOnce(user({ accessScope: "full" }));
    expect(await statusOf(requireFullAccess)).toBe("ok"); // request 1: full

    getCurrentUser.mockResolvedValueOnce(user({ accessScope: "invoice_only" }));
    expect(await statusOf(requireFullAccess)).toBe(403); // request 2: revoked

    getCurrentUser.mockResolvedValueOnce(user({ accessScope: "full" }));
    expect(await statusOf(requireFullAccess)).toBe("ok"); // request 3: restored
  });
});
