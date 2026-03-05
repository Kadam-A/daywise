/**
 * Tests for lib/utils.ts
 *
 * Covers: formatDuration, calculateEndTime, timeStringToMinutes,
 *         minutesToTimeString, doTimeSlotsOverlap, truncate, getInitials
 *
 * Run: npm test -- --testPathPattern=utils
 *
 * All functions are pure (no side effects, no mocks needed).
 */

import {
  formatDuration,
  calculateEndTime,
  timeStringToMinutes,
  minutesToTimeString,
  doTimeSlotsOverlap,
  truncate,
  getInitials,
} from "../utils";

// ─── formatDuration ──────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("0m → '0m'", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("30m → '30m'", () => {
    expect(formatDuration(30)).toBe("30m");
  });

  it("59m → '59m'", () => {
    expect(formatDuration(59)).toBe("59m");
  });

  it("60m → '1h' (no trailing 'm')", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(60)).not.toContain("m");
  });

  it("90m → '1h 30m'", () => {
    expect(formatDuration(90)).toBe("1h 30m");
  });

  it("120m → '2h' (no trailing 'm')", () => {
    expect(formatDuration(120)).toBe("2h");
  });

  it("61m → '1h 1m'", () => {
    expect(formatDuration(61)).toBe("1h 1m");
  });

  it("all clean-hour values omit minutes", () => {
    [60, 120, 180, 240].forEach((mins) => {
      const result = formatDuration(mins);
      expect(result).not.toContain("m");
      console.log(`  formatDuration(${mins}) → ${result}`);
    });
  });
});

// ─── calculateEndTime ────────────────────────────────────────────────────────

describe("calculateEndTime", () => {
  it("1:00 PM + 60min → 2:00 PM (same day)", () => {
    const start = "2025-01-06T13:00:00.000Z";
    const end = calculateEndTime(start, 60);
    expect(new Date(end).getUTCHours()).toBe(14);
    expect(new Date(end).getUTCDate()).toBe(6); // same day
  });

  it("11:00 PM + 120min → 1:00 AM next day", () => {
    const start = "2025-01-06T23:00:00.000Z";
    const end = calculateEndTime(start, 120);
    const endDate = new Date(end);
    expect(endDate.getUTCHours()).toBe(1);
    expect(endDate.getUTCDate()).toBe(7); // next day
    console.log(`  11PM + 120min → ${end}`);
  });

  it("returns a valid ISO 8601 string", () => {
    const end = calculateEndTime("2025-01-06T10:00:00.000Z", 30);
    expect(() => new Date(end)).not.toThrow();
    expect(new Date(end).toISOString()).toBe(end);
  });

  it("accepts a Date object as input", () => {
    const start = new Date("2025-01-06T09:00:00.000Z");
    const end = calculateEndTime(start, 45);
    expect(new Date(end).getUTCHours()).toBe(9);
    expect(new Date(end).getUTCMinutes()).toBe(45);
  });
});

// ─── timeStringToMinutes ─────────────────────────────────────────────────────

describe("timeStringToMinutes", () => {
  it("'00:00' → 0", () => {
    expect(timeStringToMinutes("00:00")).toBe(0);
  });

  it("'01:00' → 60", () => {
    expect(timeStringToMinutes("01:00")).toBe(60);
  });

  it("'14:30' → 870", () => {
    expect(timeStringToMinutes("14:30")).toBe(870);
  });

  it("'23:59' → 1439", () => {
    expect(timeStringToMinutes("23:59")).toBe(1439);
  });

  it("'12:00' → 720", () => {
    expect(timeStringToMinutes("12:00")).toBe(720);
  });
});

// ─── minutesToTimeString ─────────────────────────────────────────────────────

describe("minutesToTimeString", () => {
  it("0 → '00:00'", () => {
    expect(minutesToTimeString(0)).toBe("00:00");
  });

  it("60 → '01:00'", () => {
    expect(minutesToTimeString(60)).toBe("01:00");
  });

  it("870 → '14:30'", () => {
    expect(minutesToTimeString(870)).toBe("14:30");
  });

  it("1439 → '23:59'", () => {
    expect(minutesToTimeString(1439)).toBe("23:59");
  });

  it("round-trip: timeStringToMinutes → minutesToTimeString", () => {
    const cases = ["00:00", "09:15", "14:30", "23:59"];
    for (const t of cases) {
      expect(minutesToTimeString(timeStringToMinutes(t))).toBe(t);
      console.log(`  round-trip ${t} ✓`);
    }
  });
});

// ─── doTimeSlotsOverlap ──────────────────────────────────────────────────────

describe("doTimeSlotsOverlap", () => {
  /** ISO date anchored at midnight UTC Jan 6 2025 */
  const iso = (hours: number, minutes = 0) => {
    const d = new Date("2025-01-06T00:00:00.000Z");
    d.setUTCHours(hours, minutes, 0, 0);
    return d.toISOString();
  };

  it("overlapping in the middle: 1PM-3PM vs 2PM-4PM → true", () => {
    expect(doTimeSlotsOverlap(iso(13), iso(15), iso(14), iso(16))).toBe(true);
  });

  it("adjacent slots: 1PM-2PM vs 2PM-3PM → FALSE (back-to-back is allowed)", () => {
    // Critical: end of A == start of B is NOT an overlap
    expect(doTimeSlotsOverlap(iso(13), iso(14), iso(14), iso(15))).toBe(false);
    console.log("  ✓ Adjacent slots (end=start) are NOT an overlap");
  });

  it("slot B fully inside slot A: 1PM-4PM vs 2PM-3PM → true", () => {
    expect(doTimeSlotsOverlap(iso(13), iso(16), iso(14), iso(15))).toBe(true);
  });

  it("identical slots → true", () => {
    expect(doTimeSlotsOverlap(iso(13), iso(14), iso(13), iso(14))).toBe(true);
  });

  it("A completely before B: 1PM-2PM vs 3PM-4PM → false", () => {
    expect(doTimeSlotsOverlap(iso(13), iso(14), iso(15), iso(16))).toBe(false);
  });

  it("A completely after B: 3PM-4PM vs 1PM-2PM → false", () => {
    expect(doTimeSlotsOverlap(iso(15), iso(16), iso(13), iso(14))).toBe(false);
  });

  it("partial overlap at start: 1PM-2PM vs 1:30PM-2:30PM → true", () => {
    expect(doTimeSlotsOverlap(iso(13), iso(14), iso(13, 30), iso(14, 30))).toBe(true);
  });

  it("accepts Date objects as well as strings", () => {
    const a = new Date("2025-01-06T13:00:00.000Z");
    const b = new Date("2025-01-06T14:00:00.000Z");
    const c = new Date("2025-01-06T13:30:00.000Z");
    const d = new Date("2025-01-06T15:00:00.000Z");
    expect(doTimeSlotsOverlap(a, b, c, d)).toBe(true);
  });

  afterAll(() => {
    console.log("\n  ✓ All doTimeSlotsOverlap cases verified");
  });
});

// ─── truncate ────────────────────────────────────────────────────────────────

describe("truncate", () => {
  it("short text (below limit) → unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("text longer than maxLength → truncated with '...'", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("text exactly at maxLength → unchanged", () => {
    expect(truncate("12345678", 8)).toBe("12345678");
  });

  it("truncated result is always <= maxLength characters", () => {
    const result = truncate("this is a somewhat long string", 15);
    expect(result.length).toBeLessThanOrEqual(15);
    expect(result.endsWith("...")).toBe(true);
  });

  it("default maxLength is 50", () => {
    const longStr = "a".repeat(51);
    const result = truncate(longStr);
    expect(result.length).toBe(50);
    expect(result.endsWith("...")).toBe(true);
  });
});

// ─── getInitials ─────────────────────────────────────────────────────────────

describe("getInitials", () => {
  it("'John Doe' → 'JD'", () => {
    expect(getInitials("John Doe")).toBe("JD");
  });

  it("'Alice' → 'A' (single word)", () => {
    expect(getInitials("Alice")).toBe("A");
  });

  it("'John Paul Smith' → 'JP' (capped at 2 characters)", () => {
    expect(getInitials("John Paul Smith")).toBe("JP");
  });

  it("result is always uppercase", () => {
    expect(getInitials("john doe")).toBe("JD");
  });

  it("result never exceeds 2 characters", () => {
    const result = getInitials("A B C D E");
    expect(result.length).toBeLessThanOrEqual(2);
  });
});

afterAll(() => {
  console.log("\n✅ utils test suite complete");
});
