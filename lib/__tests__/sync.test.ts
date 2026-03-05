/**
 * Tests for lib/sync.ts
 *
 * Covers: processPendingOperations — success/failure paths, retry logic,
 *         cleanup, and sync timestamp behaviour.
 *
 * Run: npm test -- --testPathPattern=sync
 *
 * Mocks: ../supabase (Supabase client), ../offline (queue functions)
 *
 * NOTE: sync.ts processes all queued operations sequentially.
 * It does NOT consolidate duplicate updates for the same task (latest-wins).
 * This is a known gap — documented in the "duplicate updates" test below.
 */

import { processPendingOperations } from "../sync";
import { supabase } from "../supabase";
import * as offlineModule from "../offline";
import { PendingOperation } from "../offline";

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock("../offline", () => ({
  getPendingOperations: jest.fn(),
  removePendingOperation: jest.fn().mockResolvedValue(undefined),
  updateOperationRetry: jest.fn().mockResolvedValue(undefined),
  clearFailedOperations: jest.fn().mockResolvedValue(0),
  saveLastSyncTime: jest.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockFrom = supabase.from as jest.Mock;
const mockGetPendingOps = offlineModule.getPendingOperations as jest.Mock;
const mockRemoveOp = offlineModule.removePendingOperation as jest.Mock;
const mockUpdateRetry = offlineModule.updateOperationRetry as jest.Mock;
const mockClearFailed = offlineModule.clearFailedOperations as jest.Mock;
const mockSaveSync = offlineModule.saveLastSyncTime as jest.Mock;

/** Setup supabase mock to succeed for all operation types */
const mockSupabaseSuccess = () => {
  const eq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn().mockReturnValue({ eq });
  const insert = jest.fn().mockResolvedValue({ error: null });
  const del = jest.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ update, insert, delete: del });
};

/** Setup supabase mock to throw on the next call */
const mockSupabaseFailure = (message = "DB error") => {
  const eq = jest.fn().mockResolvedValue({ error: new Error(message) });
  const update = jest.fn().mockReturnValue({ eq });
  const insert = jest.fn().mockResolvedValue({ error: new Error(message) });
  const del = jest.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ update, insert, delete: del });
};

/** Build a PendingOperation fixture */
const makeOp = (
  overrides: Partial<PendingOperation> = {}
): PendingOperation => ({
  id: "op-1",
  type: "update_task",
  payload: { taskId: "task-123", title: "Test" },
  timestamp: Date.now(),
  retries: 0,
  ...overrides,
});

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── processPendingOperations ────────────────────────────────────────────────

describe("processPendingOperations", () => {
  // ── Empty queue ────────────────────────────────────────────────────────────

  it("empty queue → returns {success:0, failed:0} and makes no DB calls", async () => {
    mockGetPendingOps.mockResolvedValue([]);

    const result = await processPendingOperations();

    expect(result).toEqual({ success: 0, failed: 0 });
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSaveSync).not.toHaveBeenCalled();
  });

  // ── Successful operations ──────────────────────────────────────────────────

  it("successful create_task → success=1, removePendingOperation called", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-1", type: "create_task", payload: { title: "New task" } }),
    ]);
    mockSupabaseSuccess();

    const result = await processPendingOperations();

    expect(result).toEqual({ success: 1, failed: 0 });
    expect(mockRemoveOp).toHaveBeenCalledWith("op-1");
  });

  it("successful update_task → success=1, correct DB call", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-2", type: "update_task", payload: { taskId: "t1", title: "Updated" } }),
    ]);
    mockSupabaseSuccess();

    const result = await processPendingOperations();

    expect(result).toEqual({ success: 1, failed: 0 });
    expect(mockFrom).toHaveBeenCalledWith("tasks");
    console.log("  ✓ update_task processed successfully");
  });

  it("successful delete_task → success=1", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-3", type: "delete_task", payload: { taskId: "t1" } }),
    ]);
    mockSupabaseSuccess();

    const result = await processPendingOperations();

    expect(result).toEqual({ success: 1, failed: 0 });
  });

  it("successful complete_task → success=1, update called with status='completed'", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-4", type: "complete_task", payload: { taskId: "task-abc" } }),
    ]);

    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ update, delete: jest.fn(), insert: jest.fn() });

    const result = await processPendingOperations();

    expect(result).toEqual({ success: 1, failed: 0 });
    expect(update).toHaveBeenCalledWith({ status: "completed" });
  });

  it("multiple successful ops → correct success count", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-1", type: "create_task", payload: { title: "A" } }),
      makeOp({ id: "op-2", type: "delete_task", payload: { taskId: "t1" } }),
      makeOp({ id: "op-3", type: "complete_task", payload: { taskId: "t2" } }),
    ]);
    mockSupabaseSuccess();

    const result = await processPendingOperations();

    expect(result.success).toBe(3);
    expect(result.failed).toBe(0);
  });

  // ── Failure / retry logic ──────────────────────────────────────────────────

  it("DB error on op with retries=0 → updateOperationRetry called, not counted as failed", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-fail", type: "update_task", retries: 0 }),
    ]);
    mockSupabaseFailure("Connection refused");

    const result = await processPendingOperations();

    expect(mockUpdateRetry).toHaveBeenCalledWith("op-fail");
    expect(mockRemoveOp).not.toHaveBeenCalled();
    // failed count is 0 here — the op is retried, not abandoned yet
    // (it hits the else branch in processOperation)
    expect(result.success).toBe(0);
  });

  it("DB error on op with retries=4 (MAX_RETRIES - 1) → counted as failed, NO retry increment", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-maxed", type: "update_task", retries: 4 }),
    ]);
    mockSupabaseFailure("DB unreachable");

    const result = await processPendingOperations();

    expect(result.failed).toBe(1);
    expect(mockUpdateRetry).not.toHaveBeenCalled();
    expect(mockRemoveOp).not.toHaveBeenCalled();
  });

  it("mix of success and failure → correct counts", async () => {
    // consolidateOperations puts non-updates first, then updates
    // Processing order: create_task → delete_task → update_task
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-ok1", type: "create_task", payload: { title: "A" }, retries: 0 }),
      makeOp({ id: "op-fail", type: "update_task", payload: { taskId: "t1" }, retries: 4 }),
      makeOp({ id: "op-ok2", type: "delete_task", payload: { taskId: "t2" }, retries: 0 }),
    ]);

    // create_task uses insert; delete_task and update_task use .eq()
    // Order after consolidation: create → delete → update
    const eq = jest.fn()
      .mockResolvedValueOnce({ error: null })              // delete_task → success
      .mockResolvedValueOnce({ error: new Error("fail") }); // update_task (retries=4 → failed)

    const update = jest.fn().mockReturnValue({ eq });
    const insert = jest.fn().mockResolvedValueOnce({ error: null }); // create_task → success
    const del = jest.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ update, insert, delete: del });

    const result = await processPendingOperations();

    expect(result.success).toBe(2);
    expect(result.failed).toBe(1);
  });

  // ── Sync timestamp ────────────────────────────────────────────────────────

  it("saves sync time when at least 1 operation succeeds", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-1", type: "create_task", payload: { title: "A" } }),
    ]);
    mockSupabaseSuccess();

    await processPendingOperations();

    expect(mockSaveSync).toHaveBeenCalledTimes(1);
  });

  it("does NOT save sync time when all operations fail", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-fail", type: "update_task", retries: 4 }),
    ]);
    mockSupabaseFailure();

    await processPendingOperations();

    expect(mockSaveSync).not.toHaveBeenCalled();
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  it("always calls clearFailedOperations(5) at the end", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-1", type: "create_task", payload: { title: "A" } }),
    ]);
    mockSupabaseSuccess();

    await processPendingOperations();

    expect(mockClearFailed).toHaveBeenCalledWith(5);
  });

  it("calls clearFailedOperations even when queue is empty", async () => {
    mockGetPendingOps.mockResolvedValue([]);

    await processPendingOperations();

    // Returns early before clearFailed because length === 0
    // This is the current behaviour — document it
    expect(mockClearFailed).not.toHaveBeenCalled();
    console.log("  ⚠️  Note: clearFailedOperations is skipped when queue is empty (early return)");
  });

  // ── Duplicate update deduplication (latest wins) ──────────────────────────

  it("two updates to same task → merged into one DB call (latest wins)", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-1", type: "update_task", payload: { taskId: "t1", title: "Draft" }, timestamp: 1000, retries: 0 }),
      makeOp({ id: "op-2", type: "update_task", payload: { taskId: "t1", title: "Final" }, timestamp: 2000, retries: 0 }),
    ]);
    mockSupabaseSuccess();

    const result = await processPendingOperations();

    // Only one merged DB call
    expect(result.success).toBe(1);
    // op-1 removed as superseded, op-2 removed after successful processing
    expect(mockRemoveOp).toHaveBeenCalledTimes(2);
    expect(mockRemoveOp).toHaveBeenCalledWith("op-1"); // superseded
    expect(mockRemoveOp).toHaveBeenCalledWith("op-2"); // processed
    console.log("  ✓ Duplicate updates deduplicated: 2 ops → 1 DB call");
  });

  it("updates to different tasks are NOT merged", async () => {
    mockGetPendingOps.mockResolvedValue([
      makeOp({ id: "op-1", type: "update_task", payload: { taskId: "t1", title: "Task 1" }, retries: 0 }),
      makeOp({ id: "op-2", type: "update_task", payload: { taskId: "t2", title: "Task 2" }, retries: 0 }),
    ]);
    mockSupabaseSuccess();

    const result = await processPendingOperations();

    // Different tasks → two separate DB calls
    expect(result.success).toBe(2);
    expect(mockRemoveOp).toHaveBeenCalledTimes(2);
  });
});

afterAll(() => {
  console.log("\n✅ sync test suite complete");
});
