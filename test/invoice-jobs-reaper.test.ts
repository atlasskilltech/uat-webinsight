import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit test for reapStaleJobs (interrupted-job recovery). The DB layer is mocked
 * so we assert the recovery SQL and the returned count without a real database.
 */

const { iExecute } = vi.hoisted(() => ({ iExecute: vi.fn() }));

vi.mock("@/lib/invoice/db", () => ({
  iExecute,
  iQuery: vi.fn(async () => []),
  iTransaction: vi.fn(),
  ijson: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
}));

import { reapStaleJobs } from "@/lib/invoice/jobs";

beforeEach(() => {
  iExecute.mockReset();
  iExecute.mockResolvedValue({ affectedRows: 0 });
});

describe("reapStaleJobs", () => {
  it("requeues (or dead-letters) stale running jobs older than the window and returns the count", async () => {
    iExecute.mockResolvedValueOnce({ affectedRows: 3 });
    const n = await reapStaleJobs(10);
    expect(n).toBe(3);

    const [sql, params] = iExecute.mock.calls[0];
    expect(sql).toMatch(/UPDATE `processing_jobs`/);
    expect(sql).toMatch(/`status`='running'/); // only touches running jobs
    expect(sql).toMatch(/`locked_at` < DATE_SUB\(NOW\(3\), INTERVAL \? MINUTE\)/); // staleness window
    expect(sql).toMatch(/WHEN `attempts` >= `max_attempts` THEN 'dead'/); // exhausted -> dead-letter
    expect(sql).toMatch(/ELSE 'queued'/); // otherwise requeue
    expect(sql).toMatch(/`run_after`=NOW\(3\)/); // immediately eligible again
    expect(params).toEqual([10]);
  });

  it("returns 0 when nothing is stale", async () => {
    iExecute.mockResolvedValueOnce({ affectedRows: 0 });
    expect(await reapStaleJobs(15)).toBe(0);
  });

  it("defaults the staleness window to 15 minutes", async () => {
    await reapStaleJobs();
    const [, params] = iExecute.mock.calls[0];
    expect(params).toEqual([15]);
  });
});
