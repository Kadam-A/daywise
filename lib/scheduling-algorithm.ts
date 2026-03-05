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
  endOfDay,
  setHours,
  setMinutes,
  addMinutes,
  isBefore,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  getDay,
} from "date-fns";
import {
  TimeSlot,
  PersonalityData,
  Task,
  CalendarEvent,
  TaskType,
  SchedulingFactor,
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

  // Step 3: Score each slot with factors
  const scoredSlots = availableSlots.map((slot) => {
    const result = calculateSlotScoreWithFactors(slot, task, personality, existingTasks);
    return {
      slot,
      score: result.score,
      factors: result.factors,
    };
  });

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
    factors: c.factors, // Include factors for transparency
  }));
}

/**
 * Generate all possible slots
 * Clamps to deadline if task has one.
 * If no due_date, assigns a synthetic deadline to bound the search
 * so the AI has a focused window to work with.
 */
function generateAllSlots(
  task: Task,
  personality: PersonalityData,
  lookAheadDays: number,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const now = new Date();
  const duration = task.duration_minutes;

  // If no due_date, assign a synthetic deadline to bind the AI search window.
  // 7 days for high priority, 10 for medium, 14 for low.
  const effectiveDueDate = task.due_date
    ? task.due_date
    : addDays(now, task.priority === "high" ? 7 : task.priority === "medium" ? 10 : 14).toISOString();

  // CLAMP look-ahead to deadline
  let effectiveLookAhead = lookAheadDays;

  // Treat due date as end-of-day locally — stored as midnight UTC but intent is "by end of that day"
  const deadline = endOfDay(new Date(effectiveDueDate));
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

  console.log(
    `[generateAllSlots] Effective look-ahead: ${effectiveLookAhead} days (deadline: ${effectiveDueDate}, synthetic: ${!task.due_date})`,
  );

  // Default work hours
  const DEFAULT_START = 8;
  const DEFAULT_END = 20;

  for (let day = 0; day < effectiveLookAhead; day++) {
    const currentDay = addDays(startOfDay(now), day);
    const dayOfWeek = getDay(currentDay);

    // Check custom work windows
    const hasCustomWindows = personality.preferred_windows && personality.preferred_windows.length > 0;
    const preferredWindow = personality.preferred_windows?.find(
      (w) => w.day === dayOfWeek,
    );

    // If the user has configured work windows but this day isn't in them, skip it entirely.
    // (e.g. Mon–Fri only → weekends are excluded)
    // If no windows configured at all, fall back to defaults for every day.
    if (hasCustomWindows && !preferredWindow) continue;

    let startHour = DEFAULT_START;
    let endHour = DEFAULT_END;

    if (preferredWindow) {
      [startHour] = preferredWindow.start.split(":").map(Number);
      [endHour] = preferredWindow.end.split(":").map(Number);
    }

    // Generate slots at 30-minute increments
    for (let hour = startHour; hour <= endHour; hour++) {
      for (const minute of [0, 30]) {
        const slotStart = setMinutes(setHours(currentDay, hour), minute);
        const slotEnd = addMinutes(slotStart, duration);

        // Reject any slot that has already started
        if (isBefore(slotStart, now)) continue;

        // Skip if extends beyond work hours
        const endHourDecimal = slotEnd.getHours() + slotEnd.getMinutes() / 60;
        if (endHourDecimal > endHour) continue;

        // Skip if extends past end of deadline day
        // Use endOfDay so slots on the due date itself are not incorrectly excluded
        if (slotEnd > endOfDay(new Date(effectiveDueDate))) continue;

        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
          score: 0,
          reason: "",
        });
      }
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
  const now = new Date();
  return candidateSlots.filter((slot) => {
    // Hard guard: never allow a slot that has already started
    if (isBefore(new Date(slot.start), now)) return false;

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

/** Calculate slot score with detailed factors (all 9 filters) */
function calculateSlotScoreWithFactors(
  slot: TimeSlot,
  task: Task,
  personality: PersonalityData,
  existingTasks: Task[],
): { score: number; factors: SchedulingFactor[] } {
  let score = 100;
  const factors: SchedulingFactor[] = [];
  const slotTime = new Date(slot.start);
  const hour = slotTime.getHours();
  const dayOfWeek = getDay(slotTime);

  // Helper to add factor if impact is significant
  const addFactor = (name: string, impact: number, description: string, icon?: string) => {
    if (impact !== 0) {
      factors.push({ name, impact, description, icon });
    }
  };

  // 1. Chronotype
  const chronotypeImpact = applyChronotypeFilter(personality, hour);
  score += chronotypeImpact;
  if (chronotypeImpact !== 0) {
    const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    if (chronotypeImpact > 0) {
      addFactor("chronotype", chronotypeImpact, `Peak ${timeOfDay} energy for you`, "weather-sunny");
    } else {
      addFactor("chronotype", chronotypeImpact, `Lower energy time for your rhythm`, "weather-night");
    }
  }

  // 2. Focus duration
  const focusImpact = applyFocusDurationFilter(personality.focus_duration, task.duration_minutes);
  score += focusImpact;
  if (focusImpact !== 0) {
    if (focusImpact > 0) {
      addFactor("focus_duration", focusImpact, `Good length for your focus style`, "timer-outline");
    } else {
      addFactor("focus_duration", focusImpact, `May not match your preferred session length`, "timer-off-outline");
    }
  }

  // 3. Deadline style
  if (task.due_date) {
    const deadlineImpact = applyDeadlineStyleFilter(personality.deadline_style, slot.start, task.due_date);
    score += deadlineImpact;
    if (deadlineImpact !== 0) {
      const daysUntil = differenceInDays(new Date(task.due_date), slotTime);
      if (deadlineImpact > 0 && personality.deadline_style > 70) {
        addFactor("deadline_style", deadlineImpact, `Good timing for your deadline-driven style`, "target");
      } else if (deadlineImpact > 0) {
        addFactor("deadline_style", deadlineImpact, `Healthy buffer before deadline`, "shield-check");
      } else if (daysUntil < 1) {
        addFactor("deadline_style", deadlineImpact, `Cutting it close to deadline`, "alert-circle");
      } else {
        addFactor("deadline_style", deadlineImpact, `May feel too far from deadline`, "calendar-clock");
      }
    }
  }

  // 4. Back-to-back
  const backToBackImpact = applyBackToBackFilter(slot, existingTasks);
  score += backToBackImpact;
  if (backToBackImpact !== 0) {
    addFactor("spacing", backToBackImpact, `No buffer after previous task`, "arrow-collapse-horizontal");
  }

  // 5. Break frequency
  const breakImpact = applyBreakFrequencyFilter(personality.break_frequency, slot, existingTasks);
  score += breakImpact;
  if (breakImpact !== 0) {
    if (personality.break_frequency < 30) {
      addFactor("break_frequency", breakImpact, `May need more breaks than this allows`, "coffee");
    } else {
      addFactor("break_frequency", breakImpact, `Gap may interrupt your flow`, "lightning-bolt-circle");
    }
  }

  // 6. Task switching
  const switchingImpact = applyTaskSwitchingFilter(personality.task_switching, slot, existingTasks);
  score += switchingImpact;
  if (switchingImpact !== 0) {
    if (switchingImpact > 0) {
      addFactor("task_switching", switchingImpact, `Good variety for your multitask style`, "swap-horizontal");
    } else {
      addFactor("task_switching", switchingImpact, `May be too many switches for you`, "swap-horizontal-circle");
    }
  }

  // 7. Universal bad times
  const universalImpact = applyUniversalBadTimes(hour, dayOfWeek);
  score += universalImpact;
  if (universalImpact !== 0) {
    if (dayOfWeek === 1 && hour < 10) {
      addFactor("timing", universalImpact, `Monday mornings are typically slower`, "calendar-alert");
    } else if (dayOfWeek === 5 && hour >= 15) {
      addFactor("timing", universalImpact, `Friday afternoons can drag`, "calendar-weekend");
    } else if (hour === 12) {
      addFactor("timing", universalImpact, `Lunch hour overlap`, "food");
    }
  }

  // 8. High priority boost
  if (task.priority === "high" && task.due_date) {
    const priorityImpact = applyHighPriorityBoost(slot.start, task.due_date);
    score += priorityImpact;
    if (priorityImpact > 0) {
      addFactor("priority", priorityImpact, `Urgent task, sooner is better`, "alert-decagram");
    }
  }

  // 9. Task type energy matching
  if (task.task_type) {
    const typeImpact = applyTaskTypeEnergyFilter(task.task_type, personality, hour);
    score += typeImpact;
    if (typeImpact !== 0) {
      const typeLabels: Record<TaskType, string> = {
        deep_work: "deep work",
        admin: "admin tasks",
        creative: "creative work",
        communication: "meetings",
        quick_task: "quick tasks",
      };
      if (typeImpact > 0) {
        addFactor("task_type", typeImpact, `Optimal energy for ${typeLabels[task.task_type]}`, "brain");
      } else {
        addFactor("task_type", typeImpact, `Not ideal energy for ${typeLabels[task.task_type]}`, "sleep");
      }
    }
  }

  // Sort factors by absolute impact (most significant first)
  factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return {
    score: Math.max(0, Math.min(100, score)),
    factors: factors.slice(0, 3), // Return top 3 most impactful factors
  };
}

// FILTER IMPLEMENTATIONS (from SCHEDULING_ALGORITHM_DECISIONS.md)

function applyChronotypeFilter(personality: PersonalityData, hour: number): number {
  if (personality.peak_windows && personality.peak_windows.length > 0) {
    const inPeak = personality.peak_windows.some((w) => hour >= w.start && hour < w.end);
    if (inPeak) return +10;
    const minDist = Math.min(
      ...personality.peak_windows.flatMap((w) => [Math.abs(hour - w.start), Math.abs(hour - w.end)]),
    );
    if (minDist <= 1) return 0;
    if (minDist <= 3) return -20;
    return -35;
  }
  return applyLegacyChronotypeFilter(personality.chronotype, hour);
}

function applyLegacyChronotypeFilter(chronotype: number, hour: number): number {
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
    const minutesDiff = differenceInMinutes(slotStart, taskEnd);
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
    const gapMinutes = differenceInMinutes(slotStart, new Date(previousTasks[0].scheduled_end!));
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

/**
 * Task Type Energy Matching Filter
 * Matches task cognitive demands with user's energy levels throughout the day
 *
 * Energy curves based on chronotype:
 * - Early birds: Peak 6-12, dip 13-15, moderate 15-18
 * - Night owls: Low 6-11, rising 12-15, peak 16-22
 * - Neutral: Peak 9-12, dip 13-14, moderate 14-18
 */
function applyTaskTypeEnergyFilter(
  taskType: TaskType,
  personality: PersonalityData,
  hour: number,
): number {
  // Derive early-bird / night-owl from peak_windows if available
  let isEarlyBird: boolean;
  let isNightOwl: boolean;
  if (personality.peak_windows && personality.peak_windows.length > 0) {
    isEarlyBird = personality.peak_windows.some((w) => w.start < 12);
    isNightOwl = personality.peak_windows.every((w) => w.start >= 14);
  } else {
    isEarlyBird = personality.chronotype > 70;
    isNightOwl = personality.chronotype < 30;
  }

  // Define energy levels by time for each chronotype
  const getEnergyLevel = (h: number): "peak" | "moderate" | "dip" => {
    if (isEarlyBird) {
      if (h >= 6 && h <= 11) return "peak";
      if (h >= 12 && h <= 14) return "dip"; // Post-lunch slump
      if (h >= 15 && h <= 17) return "moderate";
      return "dip";
    } else if (isNightOwl) {
      if (h >= 6 && h <= 10) return "dip"; // Morning fog
      if (h >= 11 && h <= 14) return "moderate";
      if (h >= 15 && h <= 21) return "peak";
      return "moderate";
    } else {
      // Neutral chronotype
      if (h >= 9 && h <= 12) return "peak";
      if (h >= 13 && h <= 14) return "dip"; // Post-lunch
      if (h >= 15 && h <= 18) return "moderate";
      return "dip";
    }
  };

  const energy = getEnergyLevel(hour);

  switch (taskType) {
    case "deep_work":
      // High cognitive load - needs peak energy
      if (energy === "peak") return +15;
      if (energy === "dip") return -25;
      return -5; // moderate

    case "admin":
      // Low cognitive load - can be done during energy dips
      if (energy === "dip") return +10; // Actually good for routine tasks
      if (energy === "peak") return -10; // Waste of peak energy
      return 0;

    case "creative":
      // Needs mental freshness - peak or fresh moderate
      if (energy === "peak") return +12;
      if (energy === "dip") return -20;
      // Bonus for first slot of the day (fresh mind)
      if ((isEarlyBird && hour <= 8) || (isNightOwl && hour >= 15 && hour <= 16)) return +8;
      return 0;

    case "communication":
      // Meetings/calls - mid-energy times, avoid extremes
      if (hour >= 10 && hour <= 11) return +10; // Mid-morning sweet spot
      if (hour >= 14 && hour <= 16) return +8; // Early afternoon
      if (energy === "dip") return -5; // Slightly avoid low energy
      if (hour < 9 || hour > 18) return -15; // Avoid early/late for meetings
      return 0;

    case "quick_task":
      // Can be done anytime - slight preference for transition times
      if (hour === 8 || hour === 13 || hour === 17) return +5; // Transition times
      return 0;

    default:
      return 0;
  }
}
