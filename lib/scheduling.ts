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
import { SchedulingInput, SchedulingOutput, TimeSlot } from "./types";

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
 * Helper: Get all 3 alternatives (for "show other times" UI)
 */
export async function getAllRecommendations(
  input: SchedulingInput,
): Promise<TimeSlot[]> {
  const result = await scheduleTask(input);
  return result.slots;
}
