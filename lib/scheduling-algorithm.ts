/**
 * TailoredTime - Pre-Filtering Algorithm (Stage 1 ONLY)
 *
 * This file implements ONLY the pre-filtering stage.
 * For the full scheduling flow (algorithm + AI), use lib/scheduling.ts
 *
 * Purpose: Narrow 100+ slots down to ~15-20 viable candidates
 * Next Step: These candidates are sent to AI for final ranking
 *
 * See: SCHEDULING_ALGORITHM_DECISIONS.md
 */

import {
  addDays,
  startOfDay,
  setHours,
  setMinutes,
  addMinutes,
  isBefore,
  differenceInDays,
  differenceInHours,
  getDay,
} from "date-fns";
import {
  TimeSlot,
  PersonalityData,
  Task,
  CalendarEvent,
} from "./types";
import { doTimeSlotsOverlap } from "./utils";

// Configuration
const MIN_VIABLE_SCORE = 40; // Slots below this are filtered out
const MAX_CANDIDATES = 20; // Top N to send to AI
const DEFAULT_LOOK_AHEAD_DAYS = 14; // Default search window

/**
 * Pre-filter available slots to viable candidates
 * This is STAGE 1 - algorithm narrows options
 *
 * @returns Top 15-20 candidates for AI to rank
 */
export function preFilterTimeSlots(
  task: Task,
  personality: PersonalityData,
  existingEvents: CalendarEvent[],
  existingTasks: Task[],
  lookAheadDays: number = DEFAULT_LOOK_AHEAD_DAYS,
): TimeSlot[] {
  console.log("[preFilterTimeSlots] Pre-filtering for task:", task.title);

  // Step 1: Generate all possible time slots (with deadline clamping)
  const allSlots = generateAllSlots(task, personality, lookAheadDays);

  if (allSlots.length === 0) {
    console.warn("[preFilterTimeSlots] No slots generated (deadline may be past)");
    return [];
  }

  // Step 2: Filter out busy times
  const availableSlots = filterBusySlots(allSlots, existingEvents, existingTasks);

  if (availableSlots.length === 0) {
    console.warn("[preFilterTimeSlots] No available slots (all busy)");
    return [];
  }

  // Step 3: Score each slot
  const scoredSlots = availableSlots.map((slot) => ({
    slot,
    score: calculateSlotScore(slot, task, personality, existingTasks),
  }));

  // Step 4: Filter viable slots (score >= 40)
  const viableSlots = scoredSlots.filter((s) => s.score >= MIN_VIABLE_SCORE);

  // Step 5: Sort and take top candidates
  viableSlots.sort((a, b) => b.score - a.score);
  const topCandidates = viableSlots.slice(0, MAX_CANDIDATES);

  console.log(
    `[preFilterTimeSlots] ${allSlots.length} → ${availableSlots.length} available → ${viableSlots.length} viable → ${topCandidates.length} candidates`,
  );

  return topCandidates.map((c) => ({
    ...c.slot,
    score: c.score,
    reason: "", // AI will generate personalized reasons
  }));
}

/**
 * Generate all possible slots
 * ✅ FIXED: Clamps to deadline if task has one
 */
function generateAllSlots(
  task: Task,
  personality: PersonalityData,
  lookAheadDays: number,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const now = new Date();
  const duration = task.duration_minutes;

  // ✅ CLAMP look-ahead to deadline
  let effectiveLookAhead = lookAheadDays;

  if (task.due_date) {
    const deadline = new Date(task.due_date);
    const daysUntilDeadline = differenceInDays(deadline, now);

    // If deadline is past, return empty
    if (daysUntilDeadline < 0) {
      console.warn("[generateAllSlots] Deadline is in the past");
      return [];
    }

    // Clamp to deadline (+1 to include deadline day itself)
    effectiveLookAhead = Math.min(
      lookAheadDays,
      Math.max(1, daysUntilDeadline + 1),
    );
  }

  console.log(
    `[generateAllSlots] Effective look-ahead: ${effectiveLookAhead} days (deadline: ${task.due_date || "none"})`,
  );

  // Default work hours
  const DEFAULT_START = 8;
  const DEFAULT_END = 20;

  for (let day = 0; day < effectiveLookAhead; day++) {
    const currentDay = addDays(startOfDay(now), day);
    const dayOfWeek = getDay(currentDay);

    // Check custom work windows
    const preferredWindow = personality.preferred_windows?.find(
      (w) => w.day === dayOfWeek,
    );

    let startHour = DEFAULT_START;
    let endHour = DEFAULT_END;

    if (preferredWindow) {
      [startHour] = preferredWindow.start.split(":").map(Number);
      [endHour] = preferredWindow.end.split(":").map(Number);
    }

    // Generate hourly slots
    for (let hour = startHour; hour <= endHour; hour++) {
      const slotStart = setMinutes(setHours(currentDay, hour), 0);
      const slotEnd = addMinutes(slotStart, duration);

      // Skip past times
      if (isBefore(slotStart, now)) continue;

      // Skip if extends beyond work hours
      if (slotEnd.getHours() > endHour) continue;

      // Skip if extends past deadline
      if (task.due_date && slotEnd > new Date(task.due_date)) continue;

      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        score: 0,
        reason: "",
      });
    }
  }

  return slots;
}

/** Filter busy slots */
function filterBusySlots(
  candidateSlots: TimeSlot[],
  existingEvents: CalendarEvent[],
  existingTasks: Task[],
): TimeSlot[] {
  return candidateSlots.filter((slot) => {
    const overlapsEvent = existingEvents.some((event) =>
      doTimeSlotsOverlap(slot.start, slot.end, event.start_time, event.end_time),
    );

    const overlapsTask = existingTasks.some(
      (task) =>
        task.scheduled_start &&
        task.scheduled_end &&
        doTimeSlotsOverlap(
          slot.start,
          slot.end,
          task.scheduled_start,
          task.scheduled_end,
        ),
    );

    return !overlapsEvent && !overlapsTask;
  });
}

/** Calculate slot score (all 8 filters) */
function calculateSlotScore(
  slot: TimeSlot,
  task: Task,
  personality: PersonalityData,
  existingTasks: Task[],
): number {
  let score = 100;
  const slotTime = new Date(slot.start);
  const hour = slotTime.getHours();
  const dayOfWeek = getDay(slotTime);

  // 1. Chronotype
  score += applyChronotypeFilter(personality.chronotype, hour);

  // 2. Focus duration
  score += applyFocusDurationFilter(personality.focus_duration, task.duration_minutes);

  // 3. Deadline style
  if (task.due_date) {
    score += applyDeadlineStyleFilter(personality.deadline_style, slot.start, task.due_date);
  }

  // 4. Back-to-back
  score += applyBackToBackFilter(slot, existingTasks);

  // 5. Break frequency
  score += applyBreakFrequencyFilter(personality.break_frequency, slot, existingTasks);

  // 6. Task switching
  score += applyTaskSwitchingFilter(personality.task_switching, slot, existingTasks);

  // 7. Universal bad times
  score += applyUniversalBadTimes(hour, dayOfWeek);

  // 8. High priority boost
  if (task.priority === "high" && task.due_date) {
    score += applyHighPriorityBoost(slot.start, task.due_date);
  }

  return Math.max(0, Math.min(100, score));
}

// FILTER IMPLEMENTATIONS (from SCHEDULING_ALGORITHM_DECISIONS.md)

function applyChronotypeFilter(chronotype: number, hour: number): number {
  if (chronotype < 30) {
    // Night Owl
    if (hour >= 6 && hour < 9) return -40;
    if (hour >= 9 && hour < 12) return -20;
    if (hour >= 14 && hour <= 22) return +10;
  } else if (chronotype > 70) {
    // Early Bird
    if (hour >= 18 && hour <= 22) return -40;
    if (hour >= 15 && hour < 18) return -20;
    if (hour >= 6 && hour <= 14) return +10;
  } else {
    // Neutral
    if (hour < 8 || hour > 20) return -15;
  }
  return 0;
}

function applyFocusDurationFilter(focusDuration: number, taskDuration: number): number {
  if (focusDuration < 30 && taskDuration > 90) return -25;
  if (focusDuration > 70 && taskDuration < 60) return -15;
  return 0;
}

function applyDeadlineStyleFilter(
  deadlineStyle: number,
  slotStart: string,
  dueDate: string,
): number {
  const daysUntilDeadline = differenceInDays(new Date(dueDate), new Date(slotStart));

  if (deadlineStyle < 30) {
    // Early Starter
    if (daysUntilDeadline < 1) return -35;
    if (daysUntilDeadline > 10) return +5;
  } else if (deadlineStyle > 70) {
    // Deadline Driven
    if (daysUntilDeadline < 0.5) return -10;
    if (daysUntilDeadline >= 1 && daysUntilDeadline <= 3) return +10;
    if (daysUntilDeadline > 7) return -20;
  }
  return 0;
}

function applyBackToBackFilter(slot: TimeSlot, existingTasks: Task[]): number {
  const slotStart = new Date(slot.start);
  const hasBackToBack = existingTasks.some((task) => {
    if (!task.scheduled_end) return false;
    const taskEnd = new Date(task.scheduled_end);
    const minutesDiff = differenceInHours(slotStart, taskEnd) * 60;
    return minutesDiff >= 0 && minutesDiff < 15;
  });
  return hasBackToBack ? -30 : 0;
}

function applyBreakFrequencyFilter(
  breakFrequency: number,
  slot: TimeSlot,
  existingTasks: Task[],
): number {
  const slotStart = new Date(slot.start);
  const previousTasks = existingTasks
    .filter((t) => t.scheduled_end && new Date(t.scheduled_end) < slotStart)
    .sort((a, b) => new Date(b.scheduled_end!).getTime() - new Date(a.scheduled_end!).getTime());

  if (previousTasks.length > 0) {
    const gapMinutes = differenceInHours(slotStart, new Date(previousTasks[0].scheduled_end!)) * 60;
    if (breakFrequency < 30 && gapMinutes > 90) return -15;
    if (breakFrequency > 70 && gapMinutes < 30) return -15;
  }
  return 0;
}

function applyTaskSwitchingFilter(
  taskSwitching: number,
  slot: TimeSlot,
  existingTasks: Task[],
): number {
  const slotDate = startOfDay(new Date(slot.start));
  const tasksOnSameDay = existingTasks.filter((task) => {
    if (!task.scheduled_start) return false;
    return startOfDay(new Date(task.scheduled_start)).getTime() === slotDate.getTime();
  }).length;

  if (taskSwitching < 30 && tasksOnSameDay >= 3) return -25;
  if (taskSwitching > 70 && tasksOnSameDay === 0) return +5;
  return 0;
}

function applyUniversalBadTimes(hour: number, dayOfWeek: number): number {
  let penalty = 0;
  if (dayOfWeek === 1 && hour < 10) penalty -= 15; // Monday morning
  if (dayOfWeek === 5 && hour >= 15) penalty -= 15; // Friday afternoon
  if (hour === 12) penalty -= 10; // Lunch
  return penalty;
}

function applyHighPriorityBoost(slotStart: string, dueDate: string): number {
  const hoursUntilDeadline = differenceInHours(new Date(dueDate), new Date(slotStart));
  return hoursUntilDeadline <= 48 && hoursUntilDeadline > 0 ? +10 : 0;
}
