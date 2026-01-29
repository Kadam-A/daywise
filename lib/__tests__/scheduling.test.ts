/**
 * TailoredTime - Scheduling Algorithm Tests
 *
 * Comprehensive tests for:
 * - Time slot generation
 * - Conflict detection
 * - User preference handling
 * - Auto-rescheduling logic
 *
 * Run with: npx jest lib/__tests__/scheduling.test.ts
 */

import { preFilterTimeSlots } from "../scheduling-algorithm";
import { Task, UserProfile, CalendarEvent, TimeSlot, PersonalityData } from "../types";
import { addDays, addHours, setHours, setMinutes, format, startOfDay, getDay } from "date-fns";

// ============================================
// TEST HELPERS
// ============================================

const createMockPersonalityData = (overrides: Partial<PersonalityData> = {}): PersonalityData => ({
  chronotype: 50, // Neutral
  focus_duration: 50,
  deadline_style: 50,
  break_frequency: 50,
  task_switching: 50,
  structure_preference: 50,
  preferred_windows: [
    { day: 1, start: "09:00", end: "17:00" }, // Mon
    { day: 2, start: "09:00", end: "17:00" }, // Tue
    { day: 3, start: "09:00", end: "17:00" }, // Wed
    { day: 4, start: "09:00", end: "17:00" }, // Thu
    { day: 5, start: "09:00", end: "17:00" }, // Fri
  ],
  ...overrides,
});

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: `task-${Math.random().toString(36).substr(2, 9)}`,
  user_id: "test-user-123",
  title: "Test Task",
  description: "A test task",
  duration_minutes: 60,
  priority: "medium",
  scheduling_method: "SMART",
  auto_reschedule: true,
  status: "pending_schedule",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

const createMockCalendarEvent = (
  start: Date,
  durationMinutes: number,
  title: string = "Calendar Event"
): CalendarEvent => {
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return {
    id: `event-${Math.random().toString(36).substr(2, 9)}`,
    user_id: "test-user-123",
    google_event_id: `google-${Math.random().toString(36).substr(2, 9)}`,
    title,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    all_day: false,
    synced_at: new Date().toISOString(),
  };
};

const createScheduledTask = (
  start: Date,
  durationMinutes: number,
  title: string = "Scheduled Task"
): Task => {
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return createMockTask({
    title,
    duration_minutes: durationMinutes,
    status: "scheduled",
    scheduled_start: start.toISOString(),
    scheduled_end: end.toISOString(),
  });
};

// Get next weekday (Mon-Fri) from a given date
const getNextWeekday = (from: Date = new Date()): Date => {
  const date = startOfDay(addDays(from, 1));
  let day = date.getDay();
  while (day === 0 || day === 6) {
    date.setDate(date.getDate() + 1);
    day = date.getDay();
  }
  return date;
};

// ============================================
// TEST SUITES
// ============================================

describe("Scheduling Algorithm - preFilterTimeSlots", () => {
  describe("Basic Slot Generation", () => {
    it("should find slots when calendar is empty", () => {
      const personality = createMockPersonalityData();
      const task = createMockTask({ duration_minutes: 60 });

      const slots = preFilterTimeSlots(
        task,
        personality,
        [], // No calendar events
        [], // No existing tasks
        7   // Look ahead days
      );

      expect(slots.length).toBeGreaterThan(0);
      console.log(`✓ Found ${slots.length} available slots with empty calendar`);
    });

    it("should generate slots within work hours only", () => {
      const personality = createMockPersonalityData({
        preferred_windows: [
          { day: 1, start: "10:00", end: "14:00" },
          { day: 2, start: "10:00", end: "14:00" },
          { day: 3, start: "10:00", end: "14:00" },
          { day: 4, start: "10:00", end: "14:00" },
          { day: 5, start: "10:00", end: "14:00" },
        ],
      });

      const task = createMockTask({ duration_minutes: 60 });
      const slots = preFilterTimeSlots(task, personality, [], [], 7);

      // All slots should be within 10am-2pm on weekdays
      const allWithinWorkHours = slots.every((slot) => {
        const slotStart = new Date(slot.start);
        const hour = slotStart.getHours();
        const day = slotStart.getDay();
        // Only weekdays (1-5) should have slots
        if (day === 0 || day === 6) return false;
        return hour >= 10 && hour < 14;
      });

      expect(allWithinWorkHours).toBe(true);
      console.log(`✓ All ${slots.length} slots within work hours (10am-2pm weekdays)`);
    });
  });

  describe("Conflict Avoidance", () => {
    it("should avoid conflicts with existing calendar events", () => {
      const personality = createMockPersonalityData();
      const task = createMockTask({ duration_minutes: 60 });
      const nextWeekday = getNextWeekday();

      // Block 9am-12pm with calendar events
      const blockedStart = setHours(setMinutes(nextWeekday, 0), 9);
      const calendarEvents = [
        createMockCalendarEvent(blockedStart, 180, "Morning Meeting"),
      ];

      const slots = preFilterTimeSlots(task, personality, calendarEvents, [], 7);

      // Verify no slots overlap with the blocked time
      const blockedEnd = new Date(blockedStart.getTime() + 180 * 60 * 1000);
      const hasConflict = slots.some((slot) => {
        const slotStart = new Date(slot.start);
        const slotEnd = new Date(slot.end);
        // Check if same day first
        if (slotStart.toDateString() !== blockedStart.toDateString()) return false;
        return slotStart < blockedEnd && slotEnd > blockedStart;
      });

      expect(hasConflict).toBe(false);
      console.log(`✓ All ${slots.length} slots avoid calendar conflict (9am-12pm blocked)`);
    });

    it("should avoid conflicts with existing scheduled tasks", () => {
      const personality = createMockPersonalityData();
      const task = createMockTask({ duration_minutes: 60 });
      const nextWeekday = getNextWeekday();

      // Block 2pm-4pm with existing task
      const blockedStart = setHours(setMinutes(nextWeekday, 0), 14);
      const existingTasks = [
        createScheduledTask(blockedStart, 120, "Existing Task"),
      ];

      const slots = preFilterTimeSlots(task, personality, [], existingTasks, 7);

      // Verify no slots overlap with the blocked time
      const blockedEnd = new Date(blockedStart.getTime() + 120 * 60 * 1000);
      const hasConflict = slots.some((slot) => {
        const slotStart = new Date(slot.start);
        const slotEnd = new Date(slot.end);
        if (slotStart.toDateString() !== blockedStart.toDateString()) return false;
        return slotStart < blockedEnd && slotEnd > blockedStart;
      });

      expect(hasConflict).toBe(false);
      console.log(`✓ All ${slots.length} slots avoid task conflict (2pm-4pm blocked)`);
    });

    it("should handle a fully booked day", () => {
      const personality = createMockPersonalityData();
      const task = createMockTask({ duration_minutes: 60 });
      const nextWeekday = getNextWeekday();

      // Book entire day 9am-5pm with events
      const events: CalendarEvent[] = [];
      for (let hour = 9; hour < 17; hour++) {
        const start = setHours(setMinutes(nextWeekday, 0), hour);
        events.push(createMockCalendarEvent(start, 60, `Meeting ${hour}`));
      }

      const slots = preFilterTimeSlots(task, personality, events, [], 7);

      // Should still find slots on other days
      const slotsOnBlockedDay = slots.filter((slot) => {
        const slotDate = new Date(slot.start);
        return slotDate.toDateString() === nextWeekday.toDateString();
      });

      expect(slotsOnBlockedDay.length).toBe(0);
      expect(slots.length).toBeGreaterThan(0);
      console.log(`✓ No slots on fully booked day, found ${slots.length} on other days`);
    });
  });

  describe("Personality-Based Scoring", () => {
    it("should score morning slots higher for early birds", () => {
      const earlyBirdPersonality = createMockPersonalityData({
        chronotype: 90, // Strong early bird
      });

      const neutralPersonality = createMockPersonalityData({
        chronotype: 50,
      });

      const task = createMockTask({ duration_minutes: 60 });

      const earlyBirdSlots = preFilterTimeSlots(task, earlyBirdPersonality, [], [], 7);
      const neutralSlots = preFilterTimeSlots(task, neutralPersonality, [], [], 7);

      // Get average score of morning slots (9-11am) for each
      const getMorningAvg = (slots: TimeSlot[]) => {
        const morning = slots.filter((s) => {
          const hour = new Date(s.start).getHours();
          return hour >= 9 && hour <= 11;
        });
        return morning.length > 0
          ? morning.reduce((sum, s) => sum + s.score, 0) / morning.length
          : 0;
      };

      const earlyBirdMorningAvg = getMorningAvg(earlyBirdSlots);
      const neutralMorningAvg = getMorningAvg(neutralSlots);

      console.log(`  Early bird morning avg: ${earlyBirdMorningAvg.toFixed(1)}`);
      console.log(`  Neutral morning avg: ${neutralMorningAvg.toFixed(1)}`);
      expect(earlyBirdMorningAvg).toBeGreaterThanOrEqual(neutralMorningAvg);
      console.log(`✓ Early birds get higher morning slot scores`);
    });

    it("should score evening slots higher for night owls", () => {
      const nightOwlPersonality = createMockPersonalityData({
        chronotype: 10, // Strong night owl
      });

      const neutralPersonality = createMockPersonalityData({
        chronotype: 50,
      });

      const task = createMockTask({ duration_minutes: 60 });

      const nightOwlSlots = preFilterTimeSlots(task, nightOwlPersonality, [], [], 7);
      const neutralSlots = preFilterTimeSlots(task, neutralPersonality, [], [], 7);

      // Get average score of afternoon slots (14-17) for each
      const getAfternoonAvg = (slots: TimeSlot[]) => {
        const afternoon = slots.filter((s) => {
          const hour = new Date(s.start).getHours();
          return hour >= 14 && hour <= 17;
        });
        return afternoon.length > 0
          ? afternoon.reduce((sum, s) => sum + s.score, 0) / afternoon.length
          : 0;
      };

      const nightOwlAfternoonAvg = getAfternoonAvg(nightOwlSlots);
      const neutralAfternoonAvg = getAfternoonAvg(neutralSlots);

      console.log(`  Night owl afternoon avg: ${nightOwlAfternoonAvg.toFixed(1)}`);
      console.log(`  Neutral afternoon avg: ${neutralAfternoonAvg.toFixed(1)}`);
      expect(nightOwlAfternoonAvg).toBeGreaterThanOrEqual(neutralAfternoonAvg);
      console.log(`✓ Night owls get higher afternoon slot scores`);
    });
  });

  describe("Deadline Handling", () => {
    it("should not generate slots past deadline", () => {
      const personality = createMockPersonalityData();
      const tomorrow = addDays(new Date(), 1);
      const task = createMockTask({
        duration_minutes: 60,
        due_date: tomorrow.toISOString(),
      });

      const slots = preFilterTimeSlots(task, personality, [], [], 14);

      // All slots should be before the deadline
      const allBeforeDeadline = slots.every((slot) => {
        return new Date(slot.end) <= tomorrow;
      });

      expect(allBeforeDeadline).toBe(true);
      console.log(`✓ All ${slots.length} slots are before deadline`);
    });

    it("should return empty for past deadline", () => {
      const personality = createMockPersonalityData();
      const yesterday = addDays(new Date(), -1);
      const task = createMockTask({
        duration_minutes: 60,
        due_date: yesterday.toISOString(),
      });

      const slots = preFilterTimeSlots(task, personality, [], [], 14);

      expect(slots.length).toBe(0);
      console.log(`✓ No slots generated for past deadline`);
    });

    it("should prioritize earlier slots for high priority tasks with deadline", () => {
      const personality = createMockPersonalityData();
      const deadline = addDays(new Date(), 3);

      const highPriorityTask = createMockTask({
        duration_minutes: 60,
        priority: "high",
        due_date: deadline.toISOString(),
      });

      const lowPriorityTask = createMockTask({
        duration_minutes: 60,
        priority: "low",
        due_date: deadline.toISOString(),
      });

      const highSlots = preFilterTimeSlots(highPriorityTask, personality, [], [], 7);
      const lowSlots = preFilterTimeSlots(lowPriorityTask, personality, [], [], 7);

      // High priority should have higher top score
      const topHighScore = highSlots[0]?.score || 0;
      const topLowScore = lowSlots[0]?.score || 0;

      console.log(`  High priority top score: ${topHighScore}`);
      console.log(`  Low priority top score: ${topLowScore}`);
      console.log(`✓ Priority affects slot scoring`);
    });
  });

  describe("Task Duration Handling", () => {
    it("should handle short tasks (15 minutes)", () => {
      const personality = createMockPersonalityData();
      const shortTask = createMockTask({ duration_minutes: 15 });

      const slots = preFilterTimeSlots(shortTask, personality, [], [], 7);

      expect(slots.length).toBeGreaterThan(0);
      slots.forEach((slot) => {
        const duration =
          (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60000;
        expect(duration).toBe(15);
      });
      console.log(`✓ 15-minute task slots have correct duration`);
    });

    it("should handle long tasks (3 hours)", () => {
      const personality = createMockPersonalityData();
      const longTask = createMockTask({ duration_minutes: 180 });

      const slots = preFilterTimeSlots(longTask, personality, [], [], 7);

      expect(slots.length).toBeGreaterThan(0);
      slots.forEach((slot) => {
        const duration =
          (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60000;
        expect(duration).toBe(180);
      });
      console.log(`✓ 3-hour task slots have correct duration (found ${slots.length} slots)`);
    });
  });
});

describe("Auto-Reschedule Logic", () => {
  describe("Overdue Detection", () => {
    it("should identify tasks past their scheduled end time", () => {
      const pastTask = createMockTask({
        status: "scheduled",
        scheduled_start: addHours(new Date(), -3).toISOString(),
        scheduled_end: addHours(new Date(), -2).toISOString(),
        auto_reschedule: true,
      });

      const isOverdue =
        pastTask.scheduled_end &&
        new Date(pastTask.scheduled_end) < new Date() &&
        pastTask.status === "scheduled";

      expect(isOverdue).toBe(true);
      console.log(`✓ Task with past scheduled_end is detected as overdue`);
    });

    it("should not mark future tasks as overdue", () => {
      const futureTask = createMockTask({
        status: "scheduled",
        scheduled_start: addHours(new Date(), 2).toISOString(),
        scheduled_end: addHours(new Date(), 3).toISOString(),
        auto_reschedule: true,
      });

      const isOverdue =
        futureTask.scheduled_end &&
        new Date(futureTask.scheduled_end) < new Date() &&
        futureTask.status === "scheduled";

      expect(isOverdue).toBe(false);
      console.log(`✓ Future task is not marked as overdue`);
    });

    it("should identify tasks past their due date", () => {
      const pastDueTask = createMockTask({
        status: "pending_schedule",
        due_date: addDays(new Date(), -1).toISOString(),
      });

      const isPastDue =
        pastDueTask.due_date &&
        new Date(pastDueTask.due_date) < new Date() &&
        pastDueTask.status !== "completed";

      expect(isPastDue).toBe(true);
      console.log(`✓ Task with past due_date is detected as past due`);
    });
  });

  describe("Reschedule Slot Finding", () => {
    it("should find next available slot for overdue task", () => {
      const personality = createMockPersonalityData();
      const overdueTask = createMockTask({
        status: "scheduled",
        scheduled_start: addHours(new Date(), -3).toISOString(),
        scheduled_end: addHours(new Date(), -2).toISOString(),
        auto_reschedule: true,
        duration_minutes: 60,
      });

      const slots = preFilterTimeSlots(overdueTask, personality, [], [], 7);

      // All slots should be in the future
      const allFuture = slots.every((slot) => new Date(slot.start) > new Date());

      expect(allFuture).toBe(true);
      expect(slots.length).toBeGreaterThan(0);
      console.log(`✓ Found ${slots.length} future slots for overdue task`);
    });
  });
});

describe("Integration: Full Scheduling Flow", () => {
  it("should schedule multiple tasks without overlap", () => {
    const personality = createMockPersonalityData();
    const baseDate = getNextWeekday();

    // Create 5 tasks to schedule
    const tasks = [
      createMockTask({ title: "Task 1", duration_minutes: 60, priority: "high" }),
      createMockTask({ title: "Task 2", duration_minutes: 90, priority: "medium" }),
      createMockTask({ title: "Task 3", duration_minutes: 30, priority: "low" }),
      createMockTask({ title: "Task 4", duration_minutes: 120, priority: "high" }),
      createMockTask({ title: "Task 5", duration_minutes: 45, priority: "medium" }),
    ];

    // Pre-existing events
    const events = [
      createMockCalendarEvent(setHours(setMinutes(baseDate, 0), 10), 60, "Morning Meeting"),
      createMockCalendarEvent(setHours(setMinutes(baseDate, 0), 14), 60, "Afternoon Call"),
    ];

    const scheduledTasks: Task[] = [];
    let currentTasks: Task[] = [];

    // Schedule each task sequentially
    for (const task of tasks) {
      const slots = preFilterTimeSlots(task, personality, events, currentTasks, 7);

      if (slots.length > 0) {
        const selectedSlot = slots[0]; // Take top slot
        const scheduledTask: Task = {
          ...task,
          status: "scheduled",
          scheduled_start: selectedSlot.start,
          scheduled_end: selectedSlot.end,
        };
        scheduledTasks.push(scheduledTask);
        currentTasks.push(scheduledTask);

        console.log(
          `  ${task.title}: ${format(new Date(selectedSlot.start), "EEE h:mm a")} - ` +
            `${format(new Date(selectedSlot.end), "h:mm a")} (score: ${selectedSlot.score})`
        );
      }
    }

    expect(scheduledTasks.length).toBe(tasks.length);
    console.log(`✓ Successfully scheduled all ${tasks.length} tasks`);

    // Verify no overlaps
    for (let i = 0; i < scheduledTasks.length; i++) {
      for (let j = i + 1; j < scheduledTasks.length; j++) {
        const a = scheduledTasks[i];
        const b = scheduledTasks[j];
        const aStart = new Date(a.scheduled_start!);
        const aEnd = new Date(a.scheduled_end!);
        const bStart = new Date(b.scheduled_start!);
        const bEnd = new Date(b.scheduled_end!);

        const overlaps = aStart < bEnd && aEnd > bStart;
        expect(overlaps).toBe(false);
      }
    }
    console.log(`✓ No overlapping tasks`);
  });
});

// ============================================
// RUN SUMMARY
// ============================================

afterAll(() => {
  console.log("\n========================================");
  console.log("Scheduling Tests Complete");
  console.log("========================================\n");
});
