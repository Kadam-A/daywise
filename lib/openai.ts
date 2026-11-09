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
 * Thrown when the user hits the 25/hour Super AI rate limit.
 * Carries fallback (algorithm-only) slots so the UI can still show results
 * while displaying a friendly "come back in an hour" message.
 */
export class AIRateLimitError extends Error {
  fallbackSlots: TimeSlot[];
  constructor(fallbackSlots: TimeSlot[]) {
    super("AI_RATE_LIMIT");
    this.name = "AIRateLimitError";
    this.fallbackSlots = fallbackSlots;
  }
}

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
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, // For accurate week_start
      },
    });

    if (error) {
      let code: string | undefined;
      let statusCode: number | undefined;
      try {
        statusCode = (error as any).context?.status;
        const body = await (error as any).context?.json?.();
        code = body?.code;
        console.warn("[rankSlotsWithAI] Edge Function error:", statusCode, JSON.stringify(body));
      } catch {
        console.warn("[rankSlotsWithAI] Edge Function error (status:", statusCode, "— body unreadable)");
      }

      if (code === "RATE_LIMIT" || code === "LIMIT_EXCEEDED") {
        const fallback = buildFallback(candidates, task, userProfile);
        throw new AIRateLimitError(fallback);
      }

      throw error;
    }

    // AI returns top 3 with scores and personalized reasons
    const aiRanked: TimeSlot[] = data.recommendations;
    const devReasoning: string | undefined = data.dev_reasoning;

    console.log(`[rankSlotsWithAI] AI returned ${aiRanked.length} ranked slots`);
    if (devReasoning) {
      console.log(`[rankSlotsWithAI] === AI DEV REASONING ===`);
      console.log(devReasoning);
      console.log(`[rankSlotsWithAI] ======================`);
    }
    return aiRanked.slice(0, 3); // Ensure max 3
  } catch (error) {
    // Re-throw AIRateLimitError — the UI needs to show a popup for this
    if (error instanceof AIRateLimitError) throw error;

    console.error("[rankSlotsWithAI] AI ranking failed:", error);
    return buildFallback(candidates, task, userProfile);
  }
}

/**
 * Build algorithm-only fallback slots (diverse, personalised reasons).
 * Used both when AI fails generically and when rate limited.
 */
function buildFallback(candidates: TimeSlot[], task: Task, userProfile: UserProfile): TimeSlot[] {
  const picked: TimeSlot[] = [];
  for (const slot of candidates) {
    if (picked.length >= 3) break;
    const slotStart = new Date(slot.start);
    const isTooClose = picked.some((p) => {
      const pStart = new Date(p.start);
      const diffMs = Math.abs(slotStart.getTime() - pStart.getTime());
      const diffHours = diffMs / (1000 * 60 * 60);
      const sameDay = slotStart.toDateString() === pStart.toDateString();
      return sameDay && diffHours < 2;
    });
    if (!isTooClose) {
      picked.push({
        ...slot,
        reason: generatePersonalizedFallbackReason(slot, picked.length, task, userProfile),
      });
    }
  }
  for (const slot of candidates) {
    if (picked.length >= 3) break;
    if (picked.some((p) => p.start === slot.start)) continue;
    picked.push({
      ...slot,
      reason: generatePersonalizedFallbackReason(slot, picked.length, task, userProfile),
    });
  }
  return picked;
}

/**
 * Personalized fallback reason generator (when AI fails)
 * Uses personality data to generate contextual reasons
 */
function generatePersonalizedFallbackReason(
  slot: TimeSlot,
  rank: number,
  task: Task,
  userProfile: UserProfile
): string {
  const start = new Date(slot.start);
  const hour = start.getHours();
  const dayName = start.toLocaleDateString("en-US", { weekday: "long" });
  const personality = userProfile.personality_data;

  // Get time of day
  const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  // Map numeric personality fields (0–100) to readable traits
  const chronotype = personality?.chronotype ?? 50;       // 0=Night Owl, 100=Early Bird
  const deadlineStyle = personality?.deadline_style ?? 50; // 0=Start early, 100=Deadline pressure
  const structurePref = personality?.structure_preference ?? 50; // 0=Rigid/planner, 100=Fluid

  // Infer peak hours from chronotype (replaces the non-existent peak_hours field)
  const isPeakHour =
    (chronotype < 40 && (hour >= 20 || hour <= 2)) ||       // night owl: 8pm–2am
    (chronotype > 60 && hour >= 6 && hour <= 12) ||          // early bird: 6am–noon
    (chronotype >= 40 && chronotype <= 60 && hour >= 9 && hour <= 17); // balanced: 9am–5pm

  // Build personalized reason based on personality
  if (rank === 0) {
    // Top recommendation - make it feel smart
    if (chronotype < 40 && hour >= 14) {
      return "Matches your preference for later in the day";
    } else if (chronotype > 60 && hour < 12) {
      return "Perfect for your morning peak productivity";
    } else if (task.priority === "high" && isPeakHour) {
      return "Scheduled during your peak energy hours";
    } else if (deadlineStyle > 60 && task.due_date) {
      return "Gives you time before your deadline";
    }
    return `Best available slot matching your preferences`;
  }

  // Alternative slots - explain why they're good options
  if (rank === 1) {
    if (timeOfDay === "morning" && chronotype > 60) {
      return `Another ${timeOfDay} option for your active hours`;
    } else if (timeOfDay === "evening" && chronotype < 40) {
      return `Evening alternative when you're most alert`;
    } else if (task.priority === "low") {
      return `Flexible timing for this lower-priority task`;
    }
    return `Alternative ${timeOfDay} slot on ${dayName}`;
  }

  // Third option
  if (rank === 2) {
    if (structurePref < 40) {
      return `Backup option to keep your schedule flexible`;
    } else if (structurePref > 60) {
      return `Different time if your plans change`;
    }
    return `${dayName} ${timeOfDay} as a backup option`;
  }

  // Fallback for any other rank
  return `Available ${timeOfDay} slot on ${dayName}`;
}

/**
 * Simple fallback reason generator (legacy/backup)
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
