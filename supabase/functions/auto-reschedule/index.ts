/**
 * TailoredTime - Auto-Reschedule Edge Function
 *
 * Automatically reschedules overdue tasks using PERSONALITY-AWARE algorithm.
 * Designed to be triggered by a cron job (e.g., every hour or daily).
 *
 * Logic:
 * 1. Find all tasks where scheduled_end < now AND auto_reschedule = true
 * 2. For each task, find the BEST slot using personality scoring
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

interface PersonalityData {
  chronotype: number;
  focus_duration: number;
  deadline_style: number;
  break_frequency: number;
  task_switching: number;
  structure_preference: number;
  peak_windows?: Array<{
    start: number;
    end: number;
  }>;
  preferred_windows?: Array<{
    day: number;
    start: string;
    end: string;
  }>;
}

interface UserProfile {
  id: string;
  personality_data: PersonalityData | null;
  auto_reschedule_enabled: boolean;
  auto_reschedule_morning: number;
  auto_reschedule_evening: number;
  auto_reschedule_tz_name: string | null;
  auto_reschedule_tz_offset: number | null;
}

interface CalendarEvent {
  start_time: string;
  end_time: string;
}

interface ScoredSlot {
  start: string;
  end: string;
  score: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Timezone-aware date helpers ──────────────────────────────────────────────
// Deno runs in UTC. All helper functions below accept a tzOffsetMs so that
// slot generation respects the USER's local calendar (day-of-week, work hours).

/** UTC midnight for the given date, expressed in the user's local calendar day */
function localDayStart(utcDate: Date, tzOffsetMs: number): Date {
  const local = new Date(utcDate.getTime() + tzOffsetMs);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - tzOffsetMs);
}

/** Day-of-week (0=Sun … 6=Sat) in the user's local timezone */
function localDayOfWeek(utcDate: Date, tzOffsetMs: number): number {
  return new Date(utcDate.getTime() + tzOffsetMs).getUTCDay();
}

/** Hour (0-23) in the user's local timezone */
function localHour(utcDate: Date, tzOffsetMs: number): number {
  return new Date(utcDate.getTime() + tzOffsetMs).getUTCHours();
}

/** Return a Date representing `baseDate` at the given local hours:minutes */
function setLocalHours(baseDate: Date, hours: number, minutes: number, tzOffsetMs: number): Date {
  const local = new Date(baseDate.getTime() + tzOffsetMs);
  local.setUTCHours(hours, minutes, 0, 0);
  return new Date(local.getTime() - tzOffsetMs);
}

// Default personality values
const DEFAULT_PERSONALITY: PersonalityData = {
  chronotype: 50,
  focus_duration: 50,
  deadline_style: 50,
  break_frequency: 50,
  task_switching: 50,
  structure_preference: 50,
  preferred_windows: [
    { day: 1, start: "08:00", end: "20:00" },
    { day: 2, start: "08:00", end: "20:00" },
    { day: 3, start: "08:00", end: "20:00" },
    { day: 4, start: "08:00", end: "20:00" },
    { day: 5, start: "08:00", end: "20:00" },
  ],
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify cron secret — prevents unauthenticated callers from triggering reschedules
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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
    const results: Array<{ taskId: string; success: boolean; newTime?: string; score?: number; error?: string }> = [];

    // Cache per-user eligibility to avoid repeat DB calls within this run
    const userEligibilityCache = new Map<string, boolean>();

    for (const task of overdueTasks as Task[]) {
      try {
        // Check if this user is eligible (respects free-tier 1/week limit)
        let isEligible = userEligibilityCache.get(task.user_id);
        if (isEligible === undefined) {
          isEligible = await checkUserRescheduleEligibility(supabase, task.user_id);
          userEligibilityCache.set(task.user_id, isEligible);
        }

        if (!isEligible) {
          console.log(`[auto-reschedule] Skipping task ${task.id}: user ${task.user_id} has reached weekly free limit`);
          results.push({ taskId: task.id, success: false, error: "Weekly free-tier limit reached" });
          continue;
        }

        // Get user profile for scheduling preferences
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("id, personality_data, auto_reschedule_enabled, auto_reschedule_morning, auto_reschedule_evening, auto_reschedule_tz_name, auto_reschedule_tz_offset")
          .eq("id", task.user_id)
          .single();

        // Check if auto-reschedule is enabled for this user
        if (profile?.auto_reschedule_enabled === false) {
          console.log(`[auto-reschedule] Skipping task ${task.id}: auto-reschedule disabled by user`);
          results.push({ taskId: task.id, success: false, error: "Auto-reschedule disabled" });
          continue;
        }

        // Convert UTC to user's local minutes-from-midnight.
        // Prefer IANA timezone name (DST-aware). Fall back to numeric offset.
        const tzName = profile?.auto_reschedule_tz_name;
        let userLocalMinutes: number;
        if (tzName) {
          try {
            const parts = new Intl.DateTimeFormat("en-US", {
              timeZone: tzName,
              hour: "numeric",
              minute: "numeric",
              hour12: false,
            }).formatToParts(now);
            const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
            const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
            userLocalMinutes = (h === 24 ? 0 : h) * 60 + m;
          } catch {
            const offset = profile?.auto_reschedule_tz_offset ?? 0;
            const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
            userLocalMinutes = ((utcMin + offset * 60) % (24 * 60) + 24 * 60) % (24 * 60);
          }
        } else {
          const offset = profile?.auto_reschedule_tz_offset ?? 0;
          const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
          userLocalMinutes = ((utcMin + offset * 60) % (24 * 60) + 24 * 60) % (24 * 60);
        }

        const morningMinutes = profile?.auto_reschedule_morning ?? 540;
        const eveningMinutes = profile?.auto_reschedule_evening ?? 1140;

        // Allow a 59-minute window around each configured time (cron runs hourly)
        const nearMorning = userLocalMinutes >= morningMinutes && userLocalMinutes < morningMinutes + 60;
        const nearEvening = userLocalMinutes >= eveningMinutes && userLocalMinutes < eveningMinutes + 60;
        if (!nearMorning && !nearEvening) {
          console.log(`[auto-reschedule] Skipping task ${task.id}: user local minutes ${userLocalMinutes} not near morning(${morningMinutes}) or evening(${eveningMinutes})`);
          results.push({ taskId: task.id, success: false, error: "Outside preferred reschedule window" });
          continue;
        }

        // Get user's other scheduled tasks (to avoid conflicts)
        const { data: existingTasks } = await supabase
          .from("tasks")
          .select("id, scheduled_start, scheduled_end, priority")
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

        // Derive tzOffsetMs from already-computed userLocalMinutes (DST-aware)
        const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
        let diffMin = userLocalMinutes - utcMinutes;
        if (diffMin > 840) diffMin -= 1440;   // handle UTC+14 edge
        if (diffMin < -720) diffMin += 1440;  // handle UTC-12 edge
        const tzOffsetMs = diffMin * 60 * 1000;

        // Find BEST available slot using personality-aware algorithm
        const bestSlot = findBestAvailableSlot(
          task,
          profile as UserProfile | null,
          existingTasks || [],
          calendarEvents || [],
          tzOffsetMs
        );

        if (!bestSlot) {
          console.log(`[auto-reschedule] No slot found for task ${task.id}`);
          results.push({ taskId: task.id, success: false, error: "No available slot found" });
          continue;
        }

        // Update task with new schedule
        const { error: updateError } = await supabase
          .from("tasks")
          .update({
            scheduled_start: bestSlot.start,
            scheduled_end: bestSlot.end,
          })
          .eq("id", task.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        // Log the reschedule for free-tier tracking
        await supabase.from("auto_reschedule_log").insert({
          user_id: task.user_id,
          task_id: task.id,
        });

        // Mark user as ineligible for further reschedules this run (free limit = 1/week per task)
        userEligibilityCache.set(task.user_id, false);

        console.log(`[auto-reschedule] Rescheduled task ${task.id} to ${bestSlot.start} (score: ${bestSlot.score})`);
        rescheduledCount++;
        results.push({ taskId: task.id, success: true, newTime: bestSlot.start, score: bestSlot.score });
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
 * Check if a user is eligible for auto-reschedule this week.
 * Pro users: always eligible.
 * Free users: eligible only if they have had 0 reschedules this ISO week.
 */
async function checkUserRescheduleEligibility(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string
): Promise<boolean> {
  // Check subscription status
  const { data: sub } = await supabase
    .from("user_subscriptions")
    .select("plan_id, status, trial_ends_at")
    .eq("user_id", userId)
    .single();

  if (sub) {
    const { plan_id, status, trial_ends_at } = sub;
    if ((plan_id === "pro_monthly" || plan_id === "pro_yearly") && status === "active") return true;
    if (status === "trial" && trial_ends_at && new Date(trial_ends_at) > new Date()) return true;
  }

  // Free user: check weekly log count (week starts Monday)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - daysFromMonday);
  weekStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("auto_reschedule_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("rescheduled_at", weekStart.toISOString());

  return (count ?? 0) < 1;
}

/**
 * Find the BEST available slot using personality-aware scoring
 * This mirrors the algorithm in lib/scheduling-algorithm.ts
 */
function findBestAvailableSlot(
  task: Task,
  profile: UserProfile | null,
  existingTasks: Array<{ id: string; scheduled_start: string | null; scheduled_end: string | null; priority: string }>,
  calendarEvents: CalendarEvent[],
  tzOffsetMs: number = 0
): ScoredSlot | null {
  const now = new Date();
  const personality = profile?.personality_data || DEFAULT_PERSONALITY;
  const durationMs = task.duration_minutes * 60 * 1000;

  // Build list of busy times
  const busyTimes: Array<{ start: Date; end: Date }> = [];

  for (const t of existingTasks) {
    if (t.scheduled_start && t.scheduled_end) {
      busyTimes.push({
        start: new Date(t.scheduled_start),
        end: new Date(t.scheduled_end),
      });
    }
  }

  for (const e of calendarEvents) {
    busyTimes.push({
      start: new Date(e.start_time),
      end: new Date(e.end_time),
    });
  }

  busyTimes.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Generate and score all candidate slots
  const candidates: ScoredSlot[] = [];
  const preferredWindows = personality.preferred_windows || DEFAULT_PERSONALITY.preferred_windows!;

  // Look 7 days ahead (or until deadline if sooner)
  let lookAheadDays = 7;
  if (task.due_date) {
    const daysUntilDeadline = Math.ceil((new Date(task.due_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilDeadline > 0) {
      lookAheadDays = Math.min(7, daysUntilDeadline + 1);
    }
  }

  for (let dayOffset = 0; dayOffset < lookAheadDays; dayOffset++) {
    // localDayStart gives us UTC midnight aligned to the USER's local calendar day
    const checkDate = localDayStart(new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000), tzOffsetMs);
    const dayOfWeek = localDayOfWeek(checkDate, tzOffsetMs);

    // Convert Sunday = 0 to our format (Monday = 1)
    const dayNum = dayOfWeek === 0 ? 7 : dayOfWeek;

    // Find preferred window for this day
    const window = preferredWindows.find((w) => w.day === dayNum);
    if (!window) continue;

    // Parse window times (stored as local hours — convert to UTC using tzOffsetMs)
    const [startH, startM] = window.start.split(":").map(Number);
    const [endH, endM] = window.end.split(":").map(Number);

    const windowStart = setLocalHours(checkDate, startH, startM, tzOffsetMs);
    const windowEnd = setLocalHours(checkDate, endH, endM, tzOffsetMs);

    // If checking today, start from now (or window start, whichever is later)
    const slotSearchStart = dayOffset === 0
      ? new Date(Math.max(now.getTime(), windowStart.getTime()))
      : windowStart;

    // Round up to nearest 30 minutes
    const minutes = slotSearchStart.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 30) * 30;
    slotSearchStart.setMinutes(roundedMinutes, 0, 0);

    // Generate slots at 30-minute increments
    let candidateStart = new Date(slotSearchStart);

    while (candidateStart.getTime() + durationMs <= windowEnd.getTime()) {
      const candidateEnd = new Date(candidateStart.getTime() + durationMs);

      // Skip if extends past deadline
      if (task.due_date && candidateEnd > new Date(task.due_date)) {
        candidateStart.setMinutes(candidateStart.getMinutes() + 30);
        continue;
      }

      // Check if this slot conflicts with any busy time
      const hasConflict = busyTimes.some((busy) => {
        return candidateStart < busy.end && candidateEnd > busy.start;
      });

      if (!hasConflict) {
        const score = calculateSlotScore(
          candidateStart,
          task,
          personality,
          existingTasks,
          tzOffsetMs
        );

        candidates.push({
          start: candidateStart.toISOString(),
          end: candidateEnd.toISOString(),
          score,
        });
      }

      // Move to next 30-minute slot
      candidateStart = new Date(candidateStart.getTime() + 30 * 60 * 1000);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Sort by score and return the best one
  candidates.sort((a, b) => b.score - a.score);

  console.log(`[auto-reschedule] Generated ${candidates.length} candidates, best score: ${candidates[0].score}`);

  return candidates[0];
}

/**
 * Calculate personality-aware score for a slot
 * Mirrors the 8 filters from lib/scheduling-algorithm.ts
 */
function calculateSlotScore(
  slotStart: Date,
  task: Task,
  personality: PersonalityData,
  existingTasks: Array<{ id: string; scheduled_start: string | null; scheduled_end: string | null; priority: string }>,
  tzOffsetMs: number = 0
): number {
  let score = 100;
  const hour = localHour(slotStart, tzOffsetMs);
  const dayOfWeek = localDayOfWeek(slotStart, tzOffsetMs);

  // 1. Chronotype filter
  score += applyChronotypeFilter(personality, hour);

  // 2. Focus duration filter
  score += applyFocusDurationFilter(personality.focus_duration, task.duration_minutes);

  // 3. Deadline style filter
  if (task.due_date) {
    score += applyDeadlineStyleFilter(personality.deadline_style, slotStart, task.due_date);
  }

  // 4. Back-to-back filter
  score += applyBackToBackFilter(slotStart, existingTasks);

  // 5. Break frequency filter
  score += applyBreakFrequencyFilter(personality.break_frequency, slotStart, existingTasks);

  // 6. Task switching filter
  score += applyTaskSwitchingFilter(personality.task_switching, slotStart, existingTasks);

  // 7. Universal bad times
  score += applyUniversalBadTimes(hour, dayOfWeek);

  // 8. High priority boost
  if (task.priority === "high" && task.due_date) {
    score += applyHighPriorityBoost(slotStart, task.due_date);
  }

  return Math.max(0, Math.min(100, score));
}

// FILTER IMPLEMENTATIONS (matching lib/scheduling-algorithm.ts)

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
  // Fallback: legacy chronotype logic
  const chronotype = personality.chronotype;
  if (chronotype < 30) {
    if (hour >= 6 && hour < 9) return -40;
    if (hour >= 9 && hour < 12) return -20;
    if (hour >= 14 && hour <= 22) return +10;
  } else if (chronotype > 70) {
    if (hour >= 18 && hour <= 22) return -40;
    if (hour >= 15 && hour < 18) return -20;
    if (hour >= 6 && hour <= 14) return +10;
  } else {
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
  slotStart: Date,
  dueDate: string
): number {
  const daysUntilDeadline = (new Date(dueDate).getTime() - slotStart.getTime()) / (1000 * 60 * 60 * 24);

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

function applyBackToBackFilter(
  slotStart: Date,
  existingTasks: Array<{ scheduled_end: string | null }>
): number {
  const hasBackToBack = existingTasks.some((task) => {
    if (!task.scheduled_end) return false;
    const taskEnd = new Date(task.scheduled_end);
    const minutesDiff = (slotStart.getTime() - taskEnd.getTime()) / (1000 * 60);
    return minutesDiff >= 0 && minutesDiff < 15;
  });
  return hasBackToBack ? -30 : 0;
}

function applyBreakFrequencyFilter(
  breakFrequency: number,
  slotStart: Date,
  existingTasks: Array<{ scheduled_end: string | null }>
): number {
  const previousTasks = existingTasks
    .filter((t) => t.scheduled_end && new Date(t.scheduled_end) < slotStart)
    .sort((a, b) => new Date(b.scheduled_end!).getTime() - new Date(a.scheduled_end!).getTime());

  if (previousTasks.length > 0) {
    const gapMinutes = (slotStart.getTime() - new Date(previousTasks[0].scheduled_end!).getTime()) / (1000 * 60);
    if (breakFrequency < 30 && gapMinutes > 90) return -15;
    if (breakFrequency > 70 && gapMinutes < 30) return -15;
  }
  return 0;
}

function applyTaskSwitchingFilter(
  taskSwitching: number,
  slotStart: Date,
  existingTasks: Array<{ scheduled_start: string | null }>
): number {
  const slotDate = new Date(slotStart);
  slotDate.setHours(0, 0, 0, 0);

  const tasksOnSameDay = existingTasks.filter((task) => {
    if (!task.scheduled_start) return false;
    const taskDate = new Date(task.scheduled_start);
    taskDate.setHours(0, 0, 0, 0);
    return taskDate.getTime() === slotDate.getTime();
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

function applyHighPriorityBoost(slotStart: Date, dueDate: string): number {
  const hoursUntilDeadline = (new Date(dueDate).getTime() - slotStart.getTime()) / (1000 * 60 * 60);
  return hoursUntilDeadline <= 48 && hoursUntilDeadline > 0 ? +10 : 0;
}
