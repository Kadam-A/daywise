/**
 * Tests for lib/timeslot-utils.ts
 *
 * Covers: formatHour, formatTimeRange, taskBleeds, generateHourSlots
 * Run: npm test -- --testPathPattern=timeslot-utils
 */

import {
  formatHour,
  formatTimeRange,
  taskBleeds,
  generateHourSlots,
  BusySlot,
} from "../timeslot-utils";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Returns a Date set to midnight on a day N days from today */
const dayFromNow = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
};

const tomorrow = () => dayFromNow(1);
const today = () => dayFromNow(0);

/** Build an ISO busy slot anchored to a specific date at a given hour */
const makeBusySlot = (
  date: Date,
  startHour: number,
  durationMinutes: number,
  title = "Meeting"
): BusySlot => {
  const start = new Date(date);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { start: start.toISOString(), end: end.toISOString(), title };
};

// ─── formatHour ─────────────────────────────────────────────────────────────

describe("formatHour", () => {
  it("0 → 12:00 AM (midnight)", () => {
    expect(formatHour(0)).toBe("12:00 AM");
  });

  it("1 → 1:00 AM", () => {
    expect(formatHour(1)).toBe("1:00 AM");
  });

  it("11 → 11:00 AM", () => {
    expect(formatHour(11)).toBe("11:00 AM");
  });

  it("12 → 12:00 PM (noon)", () => {
    expect(formatHour(12)).toBe("12:00 PM");
  });

  it("13 → 1:00 PM (never '13:00 PM')", () => {
    expect(formatHour(13)).toBe("1:00 PM");
    expect(formatHour(13)).not.toContain("13");
  });

  it("23 → 11:00 PM (never '13:00 PM' or similar)", () => {
    expect(formatHour(23)).toBe("11:00 PM");
  });

  it("all hours 0–23 produce display hours between 1 and 12 only", () => {
    for (let h = 0; h <= 23; h++) {
      const label = formatHour(h);
      const hourNum = parseInt(label.split(":")[0], 10);
      expect(hourNum).toBeGreaterThanOrEqual(1);
      expect(hourNum).toBeLessThanOrEqual(12);
      console.log(`  formatHour(${h}) → ${label}`);
    }
  });
});

// ─── formatTimeRange ─────────────────────────────────────────────────────────

describe("formatTimeRange", () => {
  const date = tomorrow(); // use tomorrow so no past-time complications

  it("11PM + 60min → crosses midnight with (next day)", () => {
    const result = formatTimeRange(23, date, 60);
    expect(result).toBe("11:00 PM – 12:00 AM (next day)");
    console.log(`  11PM + 60min → ${result}`);
  });

  it("11PM + 120min → 1:00 AM next day", () => {
    const result = formatTimeRange(23, date, 120);
    expect(result).toBe("11:00 PM – 1:00 AM (next day)");
    console.log(`  11PM + 120min → ${result}`);
  });

  it("10PM + 60min → same day, no (next day) suffix", () => {
    const result = formatTimeRange(22, date, 60);
    expect(result).toBe("10:00 PM – 11:00 PM");
    expect(result).not.toContain("next day");
    console.log(`  10PM + 60min → ${result}`);
  });

  it("12AM + 60min → 12:00 AM – 1:00 AM (same day)", () => {
    const result = formatTimeRange(0, date, 60);
    expect(result).toBe("12:00 AM – 1:00 AM");
    expect(result).not.toContain("next day");
    console.log(`  12AM + 60min → ${result}`);
  });

  it("12PM + 90min → 12:00 PM – 1:30 PM", () => {
    const result = formatTimeRange(12, date, 90);
    expect(result).toBe("12:00 PM – 1:30 PM");
    console.log(`  12PM + 90min → ${result}`);
  });

  it("11AM + 60min → 11:00 AM – 12:00 PM", () => {
    const result = formatTimeRange(11, date, 60);
    expect(result).toBe("11:00 AM – 12:00 PM");
    console.log(`  11AM + 60min → ${result}`);
  });

  it("never produces an hour number >= 13 in any position", () => {
    const cases = [
      [23, 60], [23, 120], [22, 60], [0, 60],
      [12, 90], [11, 60], [13, 45], [1, 30],
    ] as [number, number][];

    for (const [h, d] of cases) {
      const result = formatTimeRange(h, date, d);
      // Extract all numbers from the time portion (before any "(next day)")
      const timePart = result.replace("(next day)", "").trim();
      const numbers = timePart.match(/\d+/g)?.map(Number) ?? [];
      // Hour numbers are those > 2 digits would be minutes; filter to plausible hour values
      const hourNumbers = numbers.filter((n) => n <= 59); // covers both hours and minutes
      // No hour display should be 13 or above
      const invalidHours = hourNumbers.filter((n) => n >= 13 && n <= 59 && n !== 30 && n !== 45);
      expect(invalidHours).toHaveLength(0);
      console.log(`  ${h}:00 + ${d}min → ${result}`);
    }
  });
});

// ─── taskBleeds ──────────────────────────────────────────────────────────────

describe("taskBleeds", () => {
  it("23h + 60min → true (exactly hits 24:00 = midnight = next day boundary)", () => {
    expect(taskBleeds(23, 60)).toBe(true);
  });

  it("23h + 61min → true (past midnight)", () => {
    expect(taskBleeds(23, 61)).toBe(true);
  });

  it("22h + 120min → true (22*60+120 = 1440)", () => {
    expect(taskBleeds(22, 120)).toBe(true);
  });

  it("22h + 119min → false (22*60+119 = 1439)", () => {
    expect(taskBleeds(22, 119)).toBe(false);
  });

  it("0h + 60min → false (well within the day)", () => {
    expect(taskBleeds(0, 60)).toBe(false);
  });

  it("12h + 720min (12 hrs) → true (12*60+720 = 1440)", () => {
    expect(taskBleeds(12, 720)).toBe(true);
  });

  it("12h + 719min → false", () => {
    expect(taskBleeds(12, 719)).toBe(false);
  });
});

// ─── generateHourSlots ───────────────────────────────────────────────────────

describe("generateHourSlots", () => {
  it("always generates exactly 24 slots", () => {
    const slots = generateHourSlots(tomorrow(), [], 60);
    expect(slots).toHaveLength(24);
    console.log(`  ✓ 24 slots generated`);
  });

  it("first slot is hour 0, label '12:00 AM'", () => {
    const slots = generateHourSlots(tomorrow(), [], 60);
    expect(slots[0].hour).toBe(0);
    expect(slots[0].label).toBe("12:00 AM");
  });

  it("last slot is hour 23, label '11:00 PM'", () => {
    const slots = generateHourSlots(tomorrow(), [], 60);
    expect(slots[23].hour).toBe(23);
    expect(slots[23].label).toBe("11:00 PM");
  });

  it("hours are sequential 0–23", () => {
    const slots = generateHourSlots(tomorrow(), [], 60);
    slots.forEach((slot, i) => expect(slot.hour).toBe(i));
  });

  it("tomorrow with no busy slots → all slots available", () => {
    const slots = generateHourSlots(tomorrow(), [], 60);
    const busy = slots.filter((s) => s.status === "busy");
    expect(busy).toHaveLength(0);
    console.log(`  ✓ All ${slots.length} tomorrow slots are available`);
  });

  it("today: past hours are marked busy with reason 'Past'", () => {
    const slots = generateHourSlots(today(), [], 60);
    const currentHour = new Date().getHours();
    // All slots strictly before currentHour should be busy
    for (let h = 0; h < currentHour; h++) {
      expect(slots[h].status).toBe("busy");
      expect(slots[h].busyReason).toBe("Past");
    }
    console.log(`  ✓ Hours 0–${currentHour - 1} are marked Past`);
  });

  it("slot overlapping a busy event → busy with event title", () => {
    const tom = tomorrow();
    const busySlots: BusySlot[] = [makeBusySlot(tom, 14, 60, "Team Standup")]; // 2PM tomorrow, 60min
    const slots = generateHourSlots(tom, busySlots, 60);

    const busyByEvent = slots.filter(
      (s) => s.status === "busy" && s.busyReason === "Team Standup"
    );
    expect(busyByEvent.length).toBeGreaterThan(0);
    console.log(
      `  ✓ ${busyByEvent.length} slot(s) marked busy due to "Team Standup"`
    );
  });

  it("11PM slot with 120min task → bleeds: true", () => {
    const slots = generateHourSlots(tomorrow(), [], 120);
    expect(slots[23].bleeds).toBe(true);
    console.log(`  ✓ 11PM + 120min bleeds past midnight`);
  });

  it("10PM slot with 60min task → bleeds: false", () => {
    const slots = generateHourSlots(tomorrow(), [], 60);
    expect(slots[22].bleeds).toBe(false);
    console.log(`  ✓ 10PM + 60min stays within the day`);
  });

  it("no slot label contains a display hour >= 13", () => {
    const slots = generateHourSlots(tomorrow(), [], 60);
    for (const slot of slots) {
      const hourNum = parseInt(slot.label.split(":")[0], 10);
      expect(hourNum).toBeLessThanOrEqual(12);
    }
    console.log(`  ✓ All labels use 12-hour format correctly`);
  });

  afterAll(() => {
    console.log("\n✅ timeslot-utils test suite complete");
  });
});
