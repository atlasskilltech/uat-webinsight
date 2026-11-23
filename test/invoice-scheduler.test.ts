import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * In-process invoice worker scheduler tests. The DB-backed handlers and the job
 * reaper are mocked, so no database is touched; we assert the SCHEDULER's own
 * behaviour: startup, singleton guard, disabled mode, per-task in-flight guard
 * (duplicate prevention) and graceful shutdown. Timers are faked.
 */

vi.mock("@/lib/invoice/worker/handlers", () => ({
  drainJobs: vi.fn(async () => ({ task: "drain", ran: 0, detail: {} })),
  runDueGmailSyncs: vi.fn(async () => ({ task: "gmail_sync", ran: 0, detail: {} })),
  runForwardingAll: vi.fn(async () => ({ task: "forward", ran: 0, detail: {} })),
}));
vi.mock("@/lib/invoice/jobs", () => ({
  reapStaleJobs: vi.fn(async () => 0),
}));

import * as handlers from "@/lib/invoice/worker/handlers";
import { reapStaleJobs } from "@/lib/invoice/jobs";
import {
  startInvoiceWorkerScheduler,
  stopInvoiceWorkerScheduler,
  runGuarded,
  invoiceWorkerDisabled,
} from "@/lib/invoice/worker/scheduler";

const drainMock = handlers.drainJobs as unknown as ReturnType<typeof vi.fn>;
const syncMock = handlers.runDueGmailSyncs as unknown as ReturnType<typeof vi.fn>;
const forwardMock = handlers.runForwardingAll as unknown as ReturnType<typeof vi.fn>;
const reapMock = reapStaleJobs as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.INVOICE_WORKER_DISABLED;
  process.env.INVOICE_WORKER_DRAIN_SECONDS = "5";
  process.env.INVOICE_WORKER_SYNC_MINUTES = "1";
});
afterEach(() => {
  stopInvoiceWorkerScheduler(); // resets the singleton + clears timers/listeners
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  delete process.env.INVOICE_WORKER_DISABLED;
  delete process.env.INVOICE_WORKER_DRAIN_SECONDS;
  delete process.env.INVOICE_WORKER_SYNC_MINUTES;
});

describe("invoice worker scheduler: startup", () => {
  it("runs drain (with reaper), sync and forward after their first-run delays", async () => {
    startInvoiceWorkerScheduler();
    await vi.advanceTimersByTimeAsync(31_000); // drain 8s, sync 20s, forward 30s
    expect(drainMock).toHaveBeenCalled();
    expect(reapMock).toHaveBeenCalled(); // drain recovers stale jobs first
    expect(syncMock).toHaveBeenCalled();
    expect(forwardMock).toHaveBeenCalled();
  });
});

describe("invoice worker scheduler: singleton (no multiple schedulers)", () => {
  it("starting twice does not double-schedule", async () => {
    process.env.INVOICE_WORKER_DRAIN_SECONDS = "600"; // interval won't fire inside the window
    startInvoiceWorkerScheduler();
    startInvoiceWorkerScheduler(); // ignored by the singleton guard
    await vi.advanceTimersByTimeAsync(9_000); // only the single 8s first-run fires
    expect(drainMock).toHaveBeenCalledTimes(1);
  });
});

describe("invoice worker scheduler: disabled mode", () => {
  it("does not schedule anything when INVOICE_WORKER_DISABLED=1", async () => {
    process.env.INVOICE_WORKER_DISABLED = "1";
    expect(invoiceWorkerDisabled()).toBe(true);
    startInvoiceWorkerScheduler();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(drainMock).not.toHaveBeenCalled();
    expect(syncMock).not.toHaveBeenCalled();
    expect(forwardMock).not.toHaveBeenCalled();
  });
});

describe("invoice worker scheduler: in-flight guard (duplicate prevention)", () => {
  it("skips a task run while the previous run of that task is still in flight", async () => {
    vi.useRealTimers(); // this test drives runGuarded directly, no timers
    let release: () => void = () => {};
    const slow = vi.fn(() => new Promise<void>((r) => (release = r)));

    const p1 = runGuarded("drain", slow); // starts; marks drain in-flight
    const p2 = runGuarded("drain", slow); // dropped while in-flight
    expect(slow).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([p1, p2]);

    // once the first run finished, the task can run again
    await runGuarded("drain", async () => {
      slow();
    });
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("guards each task independently", async () => {
    vi.useRealTimers();
    let release: () => void = () => {};
    const slow = vi.fn(() => new Promise<void>((r) => (release = r)));
    const fast = vi.fn(async () => {});

    const pDrain = runGuarded("drain", slow); // drain busy
    await runGuarded("sync", fast); // a DIFFERENT task still runs
    expect(fast).toHaveBeenCalledTimes(1);

    release();
    await pDrain;
  });
});

describe("invoice worker scheduler: graceful shutdown", () => {
  it("stops scheduling new ticks after stopInvoiceWorkerScheduler()", async () => {
    startInvoiceWorkerScheduler();
    await vi.advanceTimersByTimeAsync(9_000);
    const callsBefore = drainMock.mock.calls.length;
    expect(callsBefore).toBeGreaterThanOrEqual(1);

    stopInvoiceWorkerScheduler();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(drainMock.mock.calls.length).toBe(callsBefore); // no further ticks
  });

  it("can be restarted after a stop (singleton flag is reset)", async () => {
    startInvoiceWorkerScheduler();
    await vi.advanceTimersByTimeAsync(9_000);
    stopInvoiceWorkerScheduler();
    vi.clearAllMocks();

    startInvoiceWorkerScheduler(); // starts cleanly again
    await vi.advanceTimersByTimeAsync(9_000);
    expect(drainMock).toHaveBeenCalled();
  });
});
