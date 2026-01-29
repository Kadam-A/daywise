/**
 * TailoredTime - Auto-Reschedule Edge Function
 *
 * Automatically reschedules overdue tasks that have auto_reschedule enabled.
 * Designed to be triggered by a cron job (e.g., every hour or daily).
 *
 * Logic:
 * 1. Find all tasks where scheduled_end < now AND auto_reschedule = true
 * 2. For each task, find a new available slot
 * 3. Update the task with new scheduled time
 * 4. Log the reschedule for audit
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Types
interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  priority: "high" | "medium" | "low";
  status: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  due_date: string | null;
  auto_reschedule: boolean;
}

interface UserProfile {
  id: string;
  personality_data: {
    preferred_windows?: Array<{
      day: number;
      start: string;
      end: string;
    }>;
  } | null;
}

interface CalendarEvent {
  start_time: string;
  end_time: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role key for admin access
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const now = new Date();
    console.log(`[auto-reschedule] Running at ${now.toISOString()}`);

    // Find overdue tasks with auto_reschedule enabled
    const { data: overdueTasks, error: fetchError } = await supabase
      .from("tasks")
      .select("*")
      .eq("status", "scheduled")
      .eq("auto_reschedule", true)
      .lt("scheduled_end", now.toISOString());

    if (fetchError) {
      throw new Error(`Failed to fetch overdue tasks: ${fetchError.message}`);
    }

    if (!overdueTasks || overdueTasks.length === 0) {
      console.log("[auto-reschedule] No overdue tasks to reschedule");
      return new Response(
        JSON.stringify({ message: "No overdue tasks", rescheduled: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[auto-reschedule] Found ${overdueTasks.length} overdue tasks`);

    let rescheduledCount = 0;
    const results: Array<{ taskId: string; success: boolean; newTime?: string; error?: string }> = [];

    for (const task of overdueTasks as Task[]) {
      try {
        // Get user profile for scheduling preferences
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("id, personality_data")
          .eq("id", task.user_id)
          .single();

        // Get user's other scheduled tasks (to avoid conflicts)
        const { data: existingTasks } = await supabase
          .from("tasks")
          .select("scheduled_start, scheduled_end")
          .eq("user_id", task.user_id)
          .eq("status", "scheduled")
          .neq("id", task.id)
          .gte("scheduled_end", now.toISOString());

        // Get calendar events (to avoid conflicts)
        const { data: calendarEvents } = await supabase
          .from("calendar_events")
          .select("start_time, end_time")
          .eq("user_id", task.user_id)
          .gte("end_time", now.toISOString());

        // Find next available slot
        const newSlot = findNextAvailableSlot(
          task,
          profile as UserProfile | null,
          existingTasks || [],
          calendarEvents || []
        );

        if (!newSlot) {
          console.log(`[auto-reschedule] No slot found for task ${task.id}`);
          results.push({ taskId: task.id, success: false, error: "No available slot found" });
          continue;
        }

        // Update task with new schedule
        const { error: updateError } = await supabase
          .from("tasks")
          .update({
            scheduled_start: newSlot.start,
            scheduled_end: newSlot.end,
            // Keep status as scheduled
          })
          .eq("id", task.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        console.log(`[auto-reschedule] Rescheduled task ${task.id} to ${newSlot.start}`);
        rescheduledCount++;
        results.push({ taskId: task.id, success: true, newTime: newSlot.start });
      } catch (taskError) {
        console.error(`[auto-reschedule] Error rescheduling task ${task.id}:`, taskError);
        results.push({
          taskId: task.id,
          success: false,
          error: taskError instanceof Error ? taskError.message : "Unknown error",
        });
      }
    }

    console.log(`[auto-reschedule] Completed. Rescheduled ${rescheduledCount}/${overdueTasks.length} tasks`);

    return new Response(
      JSON.stringify({
        message: "Auto-reschedule completed",
        total: overdueTasks.length,
        rescheduled: rescheduledCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[auto-reschedule] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Find the next available slot for a task
 */
function findNextAvailableSlot(
  task: Task,
  profile: UserProfile | null,
  existingTasks: Array<{ scheduled_start: string | null; scheduled_end: string | null }>,
  calendarEvents: CalendarEvent[]
): { start: string; end: string } | null {
  const now = new Date();
  const durationMs = task.duration_minutes * 60 * 1000;

  // Get preferred work hours (default 8am-8pm)
  const preferredWindows = profile?.personality_data?.preferred_windows || [
    { day: 1, start: "08:00", end: "20:00" },
    { day: 2, start: "08:00", end: "20:00" },
    { day: 3, start: "08:00", end: "20:00" },
    { day: 4, start: "08:00", end: "20:00" },
    { day: 5, start: "08:00", end: "20:00" },
  ];

  // Build list of busy times
  const busyTimes: Array<{ start: Date; end: Date }> = [];

  // Add existing tasks
  for (const t of existingTasks) {
    if (t.scheduled_start && t.scheduled_end) {
      busyTimes.push({
        start: new Date(t.scheduled_start),
        end: new Date(t.scheduled_end),
      });
    }
  }

  // Add calendar events
  for (const e of calendarEvents) {
    busyTimes.push({
      start: new Date(e.start_time),
      end: new Date(e.end_time),
    });
  }

  // Sort by start time
  busyTimes.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Try to find a slot in the next 7 days
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const checkDate = new Date(now);
    checkDate.setDate(checkDate.getDate() + dayOffset);
    const dayOfWeek = checkDate.getDay();

    // Convert Sunday = 0 to our format (Monday = 1)
    const dayNum = dayOfWeek === 0 ? 7 : dayOfWeek;

    // Find preferred window for this day
    const window = preferredWindows.find((w) => w.day === dayNum);
    if (!window) continue;

    // Parse window times
    const [startH, startM] = window.start.split(":").map(Number);
    const [endH, endM] = window.end.split(":").map(Number);

    const windowStart = new Date(checkDate);
    windowStart.setHours(startH, startM, 0, 0);

    const windowEnd = new Date(checkDate);
    windowEnd.setHours(endH, endM, 0, 0);

    // If checking today, start from now (or window start, whichever is later)
    const slotSearchStart = dayOffset === 0
      ? new Date(Math.max(now.getTime(), windowStart.getTime()))
      : windowStart;

    // Round up to nearest 15 minutes
    const minutes = slotSearchStart.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    slotSearchStart.setMinutes(roundedMinutes, 0, 0);

    // Try slots in 15-minute increments
    let candidateStart = new Date(slotSearchStart);

    while (candidateStart.getTime() + durationMs <= windowEnd.getTime()) {
      const candidateEnd = new Date(candidateStart.getTime() + durationMs);

      // Check if this slot conflicts with any busy time
      const hasConflict = busyTimes.some((busy) => {
        return candidateStart < busy.end && candidateEnd > busy.start;
      });

      if (!hasConflict) {
        return {
          start: candidateStart.toISOString(),
          end: candidateEnd.toISOString(),
        };
      }

      // Move to next 15-minute slot
      candidateStart.setMinutes(candidateStart.getMinutes() + 15);
    }
  }

  return null;
}
