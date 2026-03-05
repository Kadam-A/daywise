/**
 * TailoredTime - Scheduling Orchestrator
 *
 * This is the MAIN entry point for task scheduling.
 * Combines Stage 1 (algorithm) + Stage 2 (AI) into one flow.
 *
 * Architecture:
 * 1. Pre-filter with algorithm (lib/scheduling-algorithm.ts)
 * 2. Rank with AI (lib/openai.ts)
 * 3. Return top 3 personalized recommendations
 *
 * See: SCHEDULING_ALGORITHM_DECISIONS.md
 */

import { preFilterTimeSlots } from "./scheduling-algorithm";
import { rankSlotsWithAI } from "./openai";
import { SchedulingInput, SchedulingOutput, Task, TimeSlot } from "./types";
import { supabase } from "./supabase";
import { safeCreateCalendarEvent, safeUpdateCalendarEvent } from "./google-calendar";
import { scheduleTaskReminder } from "./notifications";
import { format, isAfter, isBefore, startOfDay } from "date-fns";

/**
 * MAIN FUNCTION: Schedule a task using two-stage hybrid approach
 *
 * This is what you call from the UI when user creates a SMART task.
 *
 * @param input - Task, user profile, existing events/tasks
 * @returns Top 3 AI-ranked time slots with personalized explanations
 */
export async function scheduleTask(
  input: SchedulingInput,
): Promise<SchedulingOutput> {
  const { task, userProfile, existingEvents, existingTasks, lookAheadDays } = input;

  console.log("[scheduleTask] Starting two-stage scheduling for:", task.title);

  // ========================================
  // STAGE 1: PRE-FILTERING (Algorithm)
  // ========================================
  const candidates = preFilterTimeSlots(
    task,
    userProfile.personality_data,
    existingEvents,
    existingTasks,
    lookAheadDays,
  );

  if (candidates.length === 0) {
    console.warn("[scheduleTask] No viable candidates found");
    return {
      slots: [],
      explanation:
        "No available time slots found. Try extending your work hours or deadline.",
      metadata: {
        total_slots_evaluated: 0,
        search_window_days: lookAheadDays || 14,
        personality_factors_used: [],
      },
    };
  }

  console.log(`[scheduleTask] Stage 1 complete: ${candidates.length} candidates`);

  // ========================================
  // STAGE 2: AI RANKING
  // ========================================
  const aiRanked = await rankSlotsWithAI(
    candidates,
    task,
    userProfile,
    existingTasks,
  );

  console.log(`[scheduleTask] Stage 2 complete: ${aiRanked.length} AI-ranked slots`);
  console.log("=== AI SLOT RESULTS ===");
  const fmtLocal = (iso: string) =>
    new Date(iso).toLocaleString([], {
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  aiRanked.forEach((slot, i) => {
    console.log(`[${i + 1}] ${fmtLocal(slot.start)} → ${fmtLocal(slot.end)}`);
    console.log(`    Reason: ${slot.reason}`);
  });
  console.log("=======================");

  // ========================================
  // RETURN FINAL RESULT
  // ========================================
  return {
    slots: aiRanked, // Top 3 from AI
    explanation: generateOverallExplanation(aiRanked, candidates.length),
    metadata: {
      total_slots_evaluated: candidates.length,
      search_window_days: lookAheadDays || 14,
      personality_factors_used: [
        "chronotype",
        "focus_duration",
        "deadline_style",
        "break_frequency",
        "task_switching",
        "structure_preference",
      ],
    },
  };
}

/**
 * Generate overall explanation for the recommendations
 */
function generateOverallExplanation(
  rankedSlots: TimeSlot[],
  totalCandidates: number,
): string {
  if (rankedSlots.length === 0) {
    return "No suitable times found. Please try manual scheduling.";
  }

  const topScore = rankedSlots[0].score || 0;

  if (rankedSlots.length === 1) {
    return `I found 1 good time slot (${topScore}% match) from ${totalCandidates} options.`;
  }

  return `I analyzed ${totalCandidates} time slots and picked the best ${rankedSlots.length} based on your personality and schedule. Top match: ${topScore}%.`;
}

/**
 * Helper: Get just the top recommendation (for "smart pick" UI)
 *
 * Use this when showing the single best option first,
 * with "Show other times" button to reveal alternatives.
 */
export async function getTopRecommendation(
  input: SchedulingInput,
): Promise<TimeSlot | null> {
  const result = await scheduleTask(input);
  return result.slots.length > 0 ? result.slots[0] : null;
}

/**
 * Save a scheduled slot to Supabase and sync with Google Calendar.
 * Shared utility used by BulkRescheduleModal and auto-reschedule.
 */
export async function saveScheduledSlot(task: Task, slot: TimeSlot): Promise<boolean> {
  try {
    let googleEventId = task.google_event_id;

    if (googleEventId) {
      await safeUpdateCalendarEvent(googleEventId, task.title, task.description, slot.start, slot.end);
    } else {
      const result = await safeCreateCalendarEvent(task.title, task.description, slot.start, slot.end);
      if (result.success && result.eventId) {
        googleEventId = result.eventId;
      }
    }

    // Update due_date if:
    // 1. No due_date exists, OR
    // 2. Current due_date is already in the past (expired), OR
    // 3. Slot is scheduled after the current due_date (would become immediately overdue)
    // In all these cases, set due_date to the slot's day.
    // Otherwise preserve the original deadline.
    const slotDay = startOfDay(new Date(slot.start));
    const today = startOfDay(new Date());
    const currentDueDay = task.due_date ? startOfDay(new Date(task.due_date)) : null;
    const newDueDate =
      !currentDueDay ||
      !isAfter(currentDueDay, today) ||   // today or past → update to slot day
      isAfter(slotDay, currentDueDay)      // slot after due_date → bump forward
        ? format(slotDay, "yyyy-MM-dd")
        : task.due_date;

    const updateData: Record<string, unknown> = {
      scheduled_start: slot.start,
      scheduled_end: slot.end,
      status: "scheduled",
      due_date: newDueDate,
    };

    if (googleEventId && !task.google_event_id) {
      updateData.google_event_id = googleEventId;
    }

    const { data: updatedTask, error: updateError } = await supabase
      .from("tasks")
      .update(updateData)
      .eq("id", task.id)
      .select()
      .single();

    if (updateError) throw updateError;

    if (updatedTask) {
      await scheduleTaskReminder(updatedTask as Task);
    }

    return true;
  } catch (err) {
    console.error("[Scheduling] saveScheduledSlot error:", err);
    return false;
  }
}

/**
 * Helper: Get all 3 alternatives (for "show other times" UI)
 */
export async function getAllRecommendations(
  input: SchedulingInput,
): Promise<TimeSlot[]> {
  const result = await scheduleTask(input);
  return result.slots;
}
