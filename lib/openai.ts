/**
 * TailoredTime - OpenAI Integration (Stage 2: AI Ranking)
 *
 * Handles AI-powered slot ranking and explanation generation.
 *
 * SECURITY CRITICAL:
 * - NEVER call OpenAI API directly from mobile app
 * - Always use Supabase Edge Function as proxy
 * - See SECURITY.md "CRITICAL #2: API Key Exposure"
 *
 * Architecture:
 * Mobile App → Supabase Edge Function → OpenAI API
 *            (anon key)              (service-side key)
 *
 * TODO: Implement Edge Function calls for AI features
 */

import { supabase } from "./supabase";
import { TimeSlot, Task, UserProfile } from "./types";

/**
 * STAGE 2: AI Ranking
 *
 * Takes 15-20 pre-filtered candidates and asks AI to pick the best 3
 * with personalized reasons.
 *
 * This is the CRITICAL AI integration that was missing!
 *
 * @param candidates - Pre-filtered time slots from algorithm
 * @param task - Task to schedule
 * @param userProfile - User's personality and preferences
 * @returns Top 3 slots ranked by AI with personalized reasons
 *
 * TODO: Implement after creating Supabase Edge Function
 */
export async function rankSlotsWithAI(
  candidates: TimeSlot[],
  task: Task,
  userProfile: UserProfile,
  existingTasks: Task[],
): Promise<TimeSlot[]> {
  try {
    console.log(`[rankSlotsWithAI] Sending ${candidates.length} candidates to AI`);

    // ✅ CORRECT: Call Edge Function (NOT OpenAI directly)
    const { data, error } = await supabase.functions.invoke("rank-slots", {
      body: {
        candidates,
        task,
        personality: userProfile.personality_data,
        existingTasks, // For context
      },
    });

    if (error) throw error;

    // AI returns top 3 with scores and personalized reasons
    const aiRanked: TimeSlot[] = data.recommendations;

    console.log(`[rankSlotsWithAI] AI returned ${aiRanked.length} ranked slots`);
    return aiRanked.slice(0, 3); // Ensure max 3
  } catch (error) {
    console.error("[rankSlotsWithAI] AI ranking failed:", error);

    // FALLBACK: Use top 3 from algorithm with generic reasons
    return candidates.slice(0, 3).map((slot, index) => ({
      ...slot,
      reason: generateFallbackReason(slot, index),
    }));
  }
}

/**
 * Fallback reason generator (when AI fails)
 */
function generateFallbackReason(slot: TimeSlot, rank: number): string {
  const start = new Date(slot.start);
  const hour = start.getHours();
  const dayName = start.toLocaleDateString("en-US", { weekday: "long" });

  if (rank === 0) {
    return `Best match based on your schedule`;
  }

  if (hour < 12) {
    return `Morning slot on ${dayName}`;
  } else if (hour < 17) {
    return `Afternoon slot on ${dayName}`;
  } else {
    return `Evening slot on ${dayName}`;
  }
}

/**
 * Helper: Format time slot for display
 */
function formatTimeSlot(timeSlot: { start: string; end: string }): string {
  const start = new Date(timeSlot.start);
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  };
  return start.toLocaleString("en-US", options);
}

// ❌ NEVER do this in mobile app:
// import OpenAI from "openai";
// const openai = new OpenAI({ apiKey: process.env.EXPO_PUBLIC_OPENAI_KEY });
//
// This exposes your API key in the app bundle!
// Anyone can decompile your APK and extract it.
// See SECURITY.md for details.

// TODO: Create Supabase Edge Function:
// - supabase/functions/rank-slots/index.ts
//   * Takes candidates array
//   * Builds AI prompt with personality context
//   * Calls OpenAI GPT-4o-mini with JSON schema
//   * Returns top 3 with scores + reasons
//
// TODO: Test Edge Function locally:
// supabase functions serve rank-slots
//
// TODO: Deploy Edge Function:
// supabase functions deploy rank-slots
