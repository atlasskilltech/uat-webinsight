/**
 * Security regression: server actions in the restricted (non-Invoice-Agent)
 * modules must reject invoice_only users even when invoked directly (bypassing
 * the UI / the page-level layout guard). Full-access users are not blocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SafeUser } from "@/lib/auth/types";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn<() => Promise<SafeUser | null>>() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({
  execute: vi.fn(async () => ({ affectedRows: 1 })),
  queryOne: vi.fn(async () => null),
  query: vi.fn(async () => []),
  json: (v: unknown) => (v == null ? null : JSON.stringify(v)),
  transaction: async (fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => [[]]) }),
}));

import { deleteReport } from "@/app/reports/actions";
import { deleteTask } from "@/app/work/actions";
import { deleteServerAsset } from "@/app/operations/actions";
import { deleteIssue } from "@/app/issues/actions";
import { deleteAudit } from "@/app/inspector/actions";
import { deleteResearch } from "@/app/competitors/actions";

const user = (over: Partial<SafeUser> = {}): SafeUser => ({
  id: "u1", name: "U", email: "u@x.com", role: "user", status: "active",
  accessScope: "full", lastLoginAt: null, createdAt: new Date(0), ...over,
});

const restrictedDeletes: [string, (id: string) => Promise<void>][] = [
  ["reports.deleteReport", deleteReport],
  ["work.deleteTask", deleteTask],
  ["operations.deleteServerAsset", deleteServerAsset],
  ["issues.deleteIssue", deleteIssue],
  ["inspector.deleteAudit", deleteAudit],
  ["competitors.deleteResearch", deleteResearch],
];

beforeEach(() => getCurrentUser.mockReset());

describe("restricted module server actions reject invoice_only (direct invocation)", () => {
  for (const [name, action] of restrictedDeletes) {
    it(`${name} throws 403 for an invoice_only user`, async () => {
      getCurrentUser.mockResolvedValue(user({ accessScope: "invoice_only" }));
      await expect(action("some-id")).rejects.toMatchObject({ status: 403 });
    });
  }

  it("also rejects an invoice_only ADMIN (scope beats role)", async () => {
    getCurrentUser.mockResolvedValue(user({ role: "admin", accessScope: "invoice_only" }));
    await expect(deleteReport("x")).rejects.toMatchObject({ status: 403 });
  });

  it("does NOT block a full-access user (passes the guard and proceeds)", async () => {
    getCurrentUser.mockResolvedValue(user({ accessScope: "full" }));
    await expect(deleteReport("x")).resolves.toBeUndefined();
  });

  it("rejects an unauthenticated caller (401)", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(deleteReport("x")).rejects.toMatchObject({ status: 401 });
  });
});
