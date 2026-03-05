/**
 * Scheduling Feedback Service
 *
 * Handles submitting and retrieving feedback about AI-scheduled times.
 * Used to improve AI suggestions based on user preferences.
 */

import { supabase } from "./supabase";

export type FeedbackReason = "earlier" | "later" | "different_day" | "other";

export interface SchedulingFeedbackData {
  taskId: string;
  wasGoodTime: boolean;
  scheduledStart: string;
  scheduledEnd: string;
  feedbackReason?: FeedbackReason;
  feedbackText?: string;
}

export interface SchedulingFeedbackResult {
  success: boolean;
  error?: string;
}

export interface FeedbackStats {
  total: number;
  positive: number;
  negative: number;
  acceptanceRate: number;
}

/**
 * Submit feedback about whether a scheduled time worked well
 */
export async function submitSchedulingFeedback(
  data: SchedulingFeedbackData
): Promise<SchedulingFeedbackResult> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    const { error } = await supabase.from("scheduling_feedback").insert({
      user_id: user.id,
      task_id: data.taskId,
      was_good_time: data.wasGoodTime,
      scheduled_start: data.scheduledStart,
      scheduled_end: data.scheduledEnd,
      feedback_reason: data.feedbackReason || null,
      feedback_text: data.feedbackText || null,
      ai_suggested: true,
    });

    if (error) {
      // Ignore unique constraint violations (already submitted for this task)
      if (error.code === "23505") {
        return { success: true };
      }
      console.error("[SchedulingFeedback] Submit error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("[SchedulingFeedback] Unexpected error:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Get feedback statistics for the current user
 */
export async function getSchedulingFeedbackStats(): Promise<FeedbackStats | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const { data, error } = await supabase.rpc("get_scheduling_feedback_stats", {
      p_user_id: user.id,
    });

    if (error) {
      console.error("[SchedulingFeedback] Stats error:", error);
      return null;
    }

    return {
      total: data.total || 0,
      positive: data.positive || 0,
      negative: data.negative || 0,
      acceptanceRate: data.acceptance_rate || 0,
    };
  } catch (err) {
    console.error("[SchedulingFeedback] Unexpected stats error:", err);
    return null;
  }
}

/**
 * Check if user has already submitted feedback for a task
 */
export async function hasFeedbackForTask(taskId: string): Promise<boolean> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return false;
    }

    const { data, error } = await supabase
      .from("scheduling_feedback")
      .select("id")
      .eq("task_id", taskId)
      .eq("user_id", user.id)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found
      console.error("[SchedulingFeedback] Check error:", error);
    }

    return !!data;
  } catch (err) {
    console.error("[SchedulingFeedback] Unexpected check error:", err);
    return false;
  }
}
