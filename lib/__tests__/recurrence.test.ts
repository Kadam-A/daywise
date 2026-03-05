/**
 * Tests for lib/recurrence.ts
 *
 * Covers: generateNextInstance, isRecurringInstance, isRecurringTemplate,
 *         getRecurrenceDescription, and the internal getNextWeeklyDate logic.
 *
 * Run: npm test -- --testPathPattern=recurrence
 *
 * NOTE: Jan 1 2025 is a Wednesday — we use Jan 2025 as fixed anchor dates.
 *   Mon Jan 6 2025 → getDay()=1
 *   Wed Jan 8 2025 → getDay()=3
 */

import {
  generateNextInstance,
  isRecurringInstance,
  isRecurringTemplate,
  getRecurrenceDescription,
} from "../recurrence";
import { Task, RecurrenceRule } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal valid recurring task template */
const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  user_id: "u1",
  title: "Gym",
  scheduling_method: "MANUAL",
  duration_minutes: 60,
  priority: "medium",
  status: "pending_schedule",
  is_recurring: true,
  recurrence_rule: { frequency: "weekly", days: [1, 3] }, // Mon + Wed
  created_at: "2025-01-06T00:00:00.000Z",
  updated_at: "2025-01-06T00:00:00.000Z",
  ...overrides,
});

/** Fixed dates in Jan 2025 for deterministic testing */
const MON_JAN_6 = "2025-01-06T00:00:00.000Z";  // Monday
const WED_JAN_8 = "2025-01-08T00:00:00.000Z";  // Wednesday
const JAN_15    = "2025-01-15T00:00:00.000Z";  // Wednesday
const JAN_31    = "2025-01-31T00:00:00.000Z";  // Friday

// ─── generateNextInstance ────────────────────────────────────────────────────

describe("generateNextInstance", () => {
  // ── Guard rails ──────────────────────────────────────────────────────────

  it("returns null when is_recurring is false", () => {
    const task = makeTask({ is_recurring: false });
    expect(generateNextInstance(task)).toBeNull();
  });

  it("returns null when recurrence_rule is undefined", () => {
    const task = makeTask({ recurrence_rule: undefined });
    expect(generateNextInstance(task)).toBeNull();
  });

  // ── Daily ─────────────────────────────────────────────────────────────────

  it("daily: next instance is the following day", () => {
    const task = makeTask({ recurrence_rule: { frequency: "daily" } });
    const next = generateNextInstance(task, MON_JAN_6);

    expect(next).not.toBeNull();
    expect(next?.instance_date).toBe("2025-01-07"); // Tuesday
    console.log(`  daily from Mon Jan 6 → ${next?.instance_date}`);
  });

  // ── Monthly ───────────────────────────────────────────────────────────────

  it("monthly: same day next month (Jan 15 → Feb 15)", () => {
    const task = makeTask({ recurrence_rule: { frequency: "monthly" } });
    const next = generateNextInstance(task, JAN_15);

    expect(next?.instance_date).toBe("2025-02-15");
    console.log(`  monthly from Jan 15 → ${next?.instance_date}`);
  });

  it("monthly edge: Jan 31 → Feb 28 (clamps to last day of Feb)", () => {
    const task = makeTask({ recurrence_rule: { frequency: "monthly" } });
    const next = generateNextInstance(task, JAN_31);

    // date-fns addMonths handles overflow correctly
    expect(next?.instance_date).toBe("2025-02-28");
    console.log(`  monthly edge Jan 31 → ${next?.instance_date}`);
  });

  // ── Weekly ────────────────────────────────────────────────────────────────

  it("weekly Mon/Wed: completed Monday → next is Wednesday same week (+2 days)", () => {
    const task = makeTask({ recurrence_rule: { frequency: "weekly", days: [1, 3] } });
    const next = generateNextInstance(task, MON_JAN_6);

    expect(next?.instance_date).toBe("2025-01-08"); // Wed Jan 8
    console.log(`  Mon/Wed completed Mon Jan 6 → ${next?.instance_date}`);
  });

  it("weekly Mon/Wed: completed Wednesday → next is Monday NEXT week (+5 days)", () => {
    const task = makeTask({ recurrence_rule: { frequency: "weekly", days: [1, 3] } });
    const next = generateNextInstance(task, WED_JAN_8);

    expect(next?.instance_date).toBe("2025-01-13"); // Mon Jan 13
    console.log(`  Mon/Wed completed Wed Jan 8 → ${next?.instance_date}`);
  });

  it("weekly single day (Wed only): completed Wednesday → next Wednesday +7 days", () => {
    const task = makeTask({ recurrence_rule: { frequency: "weekly", days: [3] } });
    const next = generateNextInstance(task, WED_JAN_8);

    expect(next?.instance_date).toBe("2025-01-15"); // Wed Jan 15
    console.log(`  Wed-only completed Wed Jan 8 → ${next?.instance_date}`);
  });

  it("weekly empty days array: falls back to +7 days", () => {
    const task = makeTask({ recurrence_rule: { frequency: "weekly", days: [] } });
    const next = generateNextInstance(task, MON_JAN_6);

    // addDays(Monday, 7) = next Monday
    expect(next?.instance_date).toBe("2025-01-13");
    console.log(`  empty days[] from Mon Jan 6 → ${next?.instance_date}`);
  });

  // ── Returned object structure ─────────────────────────────────────────────

  it("copies key task fields to the new instance", () => {
    const task = makeTask({ title: "Morning Run", duration_minutes: 45, priority: "high" });
    const next = generateNextInstance(task, MON_JAN_6);

    expect(next?.title).toBe("Morning Run");
    expect(next?.duration_minutes).toBe(45);
    expect(next?.priority).toBe("high");
    expect(next?.user_id).toBe("u1");
  });

  it("new instance has status 'pending_schedule'", () => {
    const next = generateNextInstance(makeTask(), MON_JAN_6);
    expect(next?.status).toBe("pending_schedule");
  });

  it("new instance does NOT copy is_recurring (instances are not templates)", () => {
    const next = generateNextInstance(makeTask(), MON_JAN_6);
    expect(next?.is_recurring).toBeUndefined();
  });

  it("new instance sets recurrence_parent_id to parent task id", () => {
    const next = generateNextInstance(makeTask(), MON_JAN_6);
    expect(next?.recurrence_parent_id).toBe("t1");
  });

  it("new instance has instance_date in yyyy-MM-dd format", () => {
    const next = generateNextInstance(makeTask(), MON_JAN_6);
    expect(next?.instance_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("preserves due_date offset: 4-day gap from completed date carries forward to next instance", () => {
    // Parent: due Fri Jan 10 = 4 days after Mon Jan 6
    const taskWithDue = makeTask({ due_date: "2025-01-10T00:00:00.000Z" });
    const next = generateNextInstance(taskWithDue, MON_JAN_6); // completed Mon Jan 6

    // Next instance: Wed Jan 8 (+2 days from Mon Jan 6)
    expect(next?.instance_date).toBe("2025-01-08");

    // Next due_date: Wed Jan 8 + 4-day offset = Sun Jan 12
    expect(next?.due_date).toBe("2025-01-12T00:00:00.000Z");
    console.log(`  due_date offset preserved: next due = ${next?.due_date}`);
  });

  it("omits due_date when completedInstanceDate is not provided (cannot infer offset)", () => {
    const taskWithDue = makeTask({ due_date: "2025-01-10T00:00:00.000Z" });
    // No completedInstanceDate — can't compute meaningful offset
    const next = generateNextInstance(taskWithDue);
    expect(next?.due_date).toBeUndefined();
  });
});

// ─── isRecurringInstance ─────────────────────────────────────────────────────

describe("isRecurringInstance", () => {
  it("returns true when task has recurrence_parent_id", () => {
    const task = makeTask({ recurrence_parent_id: "parent-123" });
    expect(isRecurringInstance(task)).toBe(true);
  });

  it("returns false when task has no recurrence_parent_id", () => {
    const task = makeTask({ recurrence_parent_id: undefined });
    expect(isRecurringInstance(task)).toBe(false);
  });
});

// ─── isRecurringTemplate ─────────────────────────────────────────────────────

describe("isRecurringTemplate", () => {
  it("returns true when is_recurring=true and recurrence_rule is defined", () => {
    expect(isRecurringTemplate(makeTask())).toBe(true);
  });

  it("returns false when is_recurring is false (even with rule)", () => {
    expect(isRecurringTemplate(makeTask({ is_recurring: false }))).toBe(false);
  });

  it("returns false when recurrence_rule is missing (even with is_recurring)", () => {
    expect(isRecurringTemplate(makeTask({ recurrence_rule: undefined }))).toBe(false);
  });

  it("returns false for an instance (has recurrence_parent_id but no is_recurring)", () => {
    const instance = makeTask({ is_recurring: false, recurrence_parent_id: "parent-1" });
    expect(isRecurringTemplate(instance)).toBe(false);
  });
});

// ─── getRecurrenceDescription ────────────────────────────────────────────────

describe("getRecurrenceDescription", () => {
  it("daily → 'Repeats daily'", () => {
    const rule: RecurrenceRule = { frequency: "daily" };
    expect(getRecurrenceDescription(rule)).toBe("Repeats daily");
  });

  it("monthly → 'Repeats monthly'", () => {
    const rule: RecurrenceRule = { frequency: "monthly" };
    expect(getRecurrenceDescription(rule)).toBe("Repeats monthly");
  });

  it("weekly with no days → 'Repeats weekly'", () => {
    const rule: RecurrenceRule = { frequency: "weekly" };
    expect(getRecurrenceDescription(rule)).toBe("Repeats weekly");
  });

  it("weekly days=[1,3] → 'Repeats Mon, Wed'", () => {
    const rule: RecurrenceRule = { frequency: "weekly", days: [1, 3] };
    expect(getRecurrenceDescription(rule)).toBe("Repeats Mon, Wed");
  });

  it("weekly days=[1,2,3,4,5] → lists all weekdays", () => {
    const rule: RecurrenceRule = { frequency: "weekly", days: [1, 2, 3, 4, 5] };
    const result = getRecurrenceDescription(rule);
    expect(result).toContain("Mon");
    expect(result).toContain("Fri");
    console.log(`  Weekdays: ${result}`);
  });
});

afterAll(() => {
  console.log("\n✅ recurrence test suite complete");
});
