/**
 * Tests for lib/offline.ts
 *
 * Covers: queueOperation, getPendingOperations, removePendingOperation,
 *         updateOperationRetry, clearFailedOperations, getPendingOperationCount
 *
 * Run: npm test -- --testPathPattern=offline
 *
 * Mocks: AsyncStorage (in-memory), NetInfo
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  queueOperation,
  getPendingOperations,
  removePendingOperation,
  updateOperationRetry,
  clearFailedOperations,
  getPendingOperationCount,
} from "../offline";

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("@react-native-community/netinfo", () => ({
  fetch: jest.fn(() =>
    Promise.resolve({ isConnected: true, isInternetReachable: true })
  ),
  addEventListener: jest.fn(() => jest.fn()),
}));

// ─── Setup ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "@tailoredtime:pending_operations";

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ─── queueOperation ──────────────────────────────────────────────────────────

describe("queueOperation", () => {
  it("adds one operation to an empty queue", async () => {
    await queueOperation("create_task", { title: "Buy milk" });

    const ops = await getPendingOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("create_task");
    expect(ops[0].payload).toEqual({ title: "Buy milk" });
    console.log("  ✓ Queued create_task to empty store");
  });

  it("appends to an existing queue (preserves order)", async () => {
    await queueOperation("create_task", { title: "First" });
    await queueOperation("update_task", { taskId: "t1", title: "Updated" });

    const ops = await getPendingOperations();
    expect(ops).toHaveLength(2);
    expect(ops[0].type).toBe("create_task");
    expect(ops[1].type).toBe("update_task");
  });

  it("each operation gets a unique id", async () => {
    await queueOperation("create_task", { title: "A" });
    await queueOperation("create_task", { title: "B" });

    const ops = await getPendingOperations();
    expect(ops[0].id).not.toBe(ops[1].id);
    console.log(`  IDs: ${ops[0].id} vs ${ops[1].id}`);
  });

  it("operation starts with retries=0", async () => {
    await queueOperation("delete_task", { taskId: "t1" });

    const ops = await getPendingOperations();
    expect(ops[0].retries).toBe(0);
  });

  it("operation stores a timestamp", async () => {
    const before = Date.now();
    await queueOperation("complete_task", { taskId: "t1" });
    const after = Date.now();

    const ops = await getPendingOperations();
    expect(ops[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(ops[0].timestamp).toBeLessThanOrEqual(after);
  });
});

// ─── getPendingOperations ────────────────────────────────────────────────────

describe("getPendingOperations", () => {
  it("returns [] when nothing is stored", async () => {
    const ops = await getPendingOperations();
    expect(ops).toEqual([]);
  });

  it("returns all queued operations", async () => {
    await queueOperation("create_task", { title: "Task A" });
    await queueOperation("update_task", { taskId: "t1" });

    const ops = await getPendingOperations();
    expect(ops).toHaveLength(2);
  });

  it("returns [] gracefully when storage contains invalid JSON", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "not-json{{");
    const ops = await getPendingOperations();
    expect(ops).toEqual([]);
  });
});

// ─── removePendingOperation ──────────────────────────────────────────────────

describe("removePendingOperation", () => {
  it("removes the target operation by id", async () => {
    await queueOperation("create_task", { title: "A" });
    await queueOperation("create_task", { title: "B" });

    const ops = await getPendingOperations();
    const idToRemove = ops[0].id;

    await removePendingOperation(idToRemove);

    const remaining = await getPendingOperations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).not.toBe(idToRemove);
  });

  it("leaves other operations intact after removal", async () => {
    await queueOperation("create_task", { title: "Keep me" });
    await queueOperation("delete_task", { taskId: "t-remove" });

    const ops = await getPendingOperations();
    const keepId = ops[0].id;
    const removeId = ops[1].id;

    await removePendingOperation(removeId);

    const remaining = await getPendingOperations();
    expect(remaining[0].id).toBe(keepId);
    expect(remaining[0].payload).toEqual({ title: "Keep me" });
  });

  it("is a no-op (no error) when id does not exist", async () => {
    await queueOperation("create_task", { title: "Still here" });

    await expect(removePendingOperation("non-existent-id")).resolves.not.toThrow();

    const ops = await getPendingOperations();
    expect(ops).toHaveLength(1);
  });
});

// ─── updateOperationRetry ────────────────────────────────────────────────────

describe("updateOperationRetry", () => {
  it("increments retry count for the target operation", async () => {
    await queueOperation("update_task", { taskId: "t1" });

    const [op] = await getPendingOperations();
    expect(op.retries).toBe(0);

    await updateOperationRetry(op.id);

    const [updated] = await getPendingOperations();
    expect(updated.retries).toBe(1);
  });

  it("incrementing twice results in retries=2", async () => {
    await queueOperation("update_task", { taskId: "t1" });
    const [op] = await getPendingOperations();

    await updateOperationRetry(op.id);
    await updateOperationRetry(op.id);

    const [updated] = await getPendingOperations();
    expect(updated.retries).toBe(2);
  });

  it("does not affect other operations in the queue", async () => {
    await queueOperation("create_task", { title: "First" });
    await queueOperation("delete_task", { taskId: "t2" });

    const ops = await getPendingOperations();
    await updateOperationRetry(ops[0].id);

    const updated = await getPendingOperations();
    expect(updated[0].retries).toBe(1);
    expect(updated[1].retries).toBe(0); // unchanged
  });
});

// ─── clearFailedOperations ───────────────────────────────────────────────────

describe("clearFailedOperations", () => {
  const setRetriesDirectly = async (id: string, retries: number) => {
    const ops = await getPendingOperations();
    const updated = ops.map((op) => (op.id === id ? { ...op, retries } : op));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  it("removes operations with retries >= maxRetries (default 5)", async () => {
    await queueOperation("create_task", { title: "Should go" });
    const [op] = await getPendingOperations();
    await setRetriesDirectly(op.id, 5); // retries=5, maxRetries=5 → 5 < 5 is false → removed

    const removed = await clearFailedOperations(5);
    expect(removed).toBe(1);

    const ops = await getPendingOperations();
    expect(ops).toHaveLength(0);
  });

  it("keeps operations with retries < maxRetries", async () => {
    await queueOperation("create_task", { title: "Keep me" });
    const [op] = await getPendingOperations();
    await setRetriesDirectly(op.id, 4); // 4 < 5 → kept

    await clearFailedOperations(5);

    const ops = await getPendingOperations();
    expect(ops).toHaveLength(1);
  });

  it("removes failed but keeps healthy in mixed queue", async () => {
    await queueOperation("create_task", { title: "Healthy" });
    await queueOperation("update_task", { taskId: "t1" });

    const ops = await getPendingOperations();
    await setRetriesDirectly(ops[0].id, 4); // healthy — retries 4 < 5
    await setRetriesDirectly(ops[1].id, 5); // failed — retries 5 >= 5

    const removed = await clearFailedOperations(5);
    expect(removed).toBe(1);

    const remaining = await getPendingOperations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload).toEqual({ title: "Healthy" });
  });

  it("returns 0 when queue is empty", async () => {
    const removed = await clearFailedOperations(5);
    expect(removed).toBe(0);
  });

  it("returns 0 when no operations have exceeded maxRetries", async () => {
    await queueOperation("create_task", { title: "Fine" });
    const removed = await clearFailedOperations(5);
    expect(removed).toBe(0);
  });
});

// ─── getPendingOperationCount ────────────────────────────────────────────────

describe("getPendingOperationCount", () => {
  it("returns 0 for empty queue", async () => {
    expect(await getPendingOperationCount()).toBe(0);
  });

  it("returns correct count after queueing", async () => {
    await queueOperation("create_task", { title: "A" });
    await queueOperation("delete_task", { taskId: "t1" });
    expect(await getPendingOperationCount()).toBe(2);
  });

  it("count decrements after removal", async () => {
    await queueOperation("create_task", { title: "A" });
    const [op] = await getPendingOperations();
    await removePendingOperation(op.id);
    expect(await getPendingOperationCount()).toBe(0);
  });
});

afterAll(() => {
  console.log("\n✅ offline test suite complete");
});
