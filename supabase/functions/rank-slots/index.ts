/**
 * TailoredTime - AI Slot Ranking Edge Function
 *
 * Takes pre-filtered time slots from the algorithm and uses AI to
 * pick the best 3 with personalized reasons.
 *
 * Architecture:
 * Mobile App → This Edge Function → OpenAI GPT-4o-mini
 *
 * Rate limit: 100 requests/hour/user
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TimeSlot {
  start: string;
  end: string;
  score: number;
  reason: string;
}

interface PersonalityData {
  chronotype: number;
  focus_duration: number;
  deadline_style: number;
  break_frequency: number;
  task_switching: number;
  structure_preference: number;
}

interface Task {
  id: string;
  title: string;
  description?: string;
  duration_minutes: number;
  priority: "low" | "medium" | "high";
  due_date?: string;
  scheduled_start?: string;
  scheduled_end?: string;
}

interface RankSlotsRequest {
  candidates: TimeSlot[];
  task: Task;
  personality: PersonalityData;
  existingTasks: Task[];
}

interface AISlotRecommendation {
  slot_index: number;
  score: number;
  reason: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting check (100 req/hour/user)
    const rateLimitOk = await checkRateLimit(supabase, user.id);
    if (!rateLimitOk) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later.", code: "RATE_LIMIT" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: RankSlotsRequest = await req.json();
    const { candidates, task, personality, existingTasks } = body;

    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ error: "No candidates provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call OpenAI to rank slots
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      console.error("OPENAI_API_KEY not configured");
      // Fallback: return top 3 candidates with generic reasons
      return new Response(
        JSON.stringify({ recommendations: generateFallbackRecommendations(candidates) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recommendations = await rankWithAI(
      openaiKey,
      candidates,
      task,
      personality,
      existingTasks
    );

    // Record rate limit usage
    await recordRateLimitUsage(supabase, user.id);

    return new Response(
      JSON.stringify({ recommendations }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in rank-slots:", error);

    // Return fallback on any error
    try {
      const body = await req.clone().json();
      if (body.candidates) {
        return new Response(
          JSON.stringify({ recommendations: generateFallbackRecommendations(body.candidates) }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } catch {
      // Ignore parse error
    }

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Call OpenAI GPT-4o-mini to rank time slots
 */
async function rankWithAI(
  apiKey: string,
  candidates: TimeSlot[],
  task: Task,
  personality: PersonalityData,
  existingTasks: Task[]
): Promise<TimeSlot[]> {
  // Build personality description
  const personalityDesc = describePersonality(personality);

  // Format candidates for prompt
  const candidateList = candidates.map((slot, i) => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    return `${i}: ${formatDateTime(start)} - ${formatTime(end)} (Algorithm score: ${slot.score})`;
  }).join("\n");

  // Format existing tasks for context
  const existingTasksDesc = existingTasks
    .filter((t) => t.scheduled_start)
    .slice(0, 5)
    .map((t) => {
      const start = new Date(t.scheduled_start!);
      return `- ${t.title} at ${formatDateTime(start)}`;
    })
    .join("\n") || "No other tasks scheduled yet.";

  const systemPrompt = `You are an AI scheduling assistant for TailoredTime. Your job is to pick the BEST 3 time slots for a task based on the user's personality and schedule.

PERSONALITY PROFILE:
${personalityDesc}

IMPORTANT: Your reasons must be personalized based on the personality profile above. Reference specific traits.`;

  const userPrompt = `TASK TO SCHEDULE:
- Title: ${task.title}
- Duration: ${task.duration_minutes} minutes
- Priority: ${task.priority}
${task.due_date ? `- Due: ${new Date(task.due_date).toLocaleDateString()}` : ""}
${task.description ? `- Description: ${task.description}` : ""}

ALREADY SCHEDULED:
${existingTasksDesc}

CANDIDATE TIME SLOTS (pick best 3):
${candidateList}

Return a JSON array with exactly 3 objects, each having:
- slot_index: number (0-indexed from the candidate list)
- score: number (0-100, your confidence this is a good time)
- reason: string (max 100 characters, personalized explanation referencing their traits)

Example format:
[
  {"slot_index": 2, "score": 95, "reason": "Peak morning focus time - perfect for your early bird rhythm"},
  {"slot_index": 5, "score": 82, "reason": "Good afternoon slot with buffer before deadline"},
  {"slot_index": 0, "score": 75, "reason": "Quiet start to the week"}
]`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("OpenAI API error:", errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error("No content in OpenAI response");
  }

  // Parse AI response
  let aiResponse: AISlotRecommendation[] | { recommendations: AISlotRecommendation[] };
  try {
    const parsed = JSON.parse(content);
    // Handle both array format and object with recommendations key
    aiResponse = Array.isArray(parsed) ? parsed : parsed.recommendations || [];
  } catch {
    console.error("Failed to parse AI response:", content);
    throw new Error("Invalid AI response format");
  }

  const recommendations = Array.isArray(aiResponse) ? aiResponse : [];

  // Map AI recommendations back to TimeSlot objects
  const rankedSlots: TimeSlot[] = recommendations
    .filter((rec) => rec.slot_index >= 0 && rec.slot_index < candidates.length)
    .slice(0, 3)
    .map((rec) => ({
      ...candidates[rec.slot_index],
      score: rec.score,
      reason: rec.reason.slice(0, 150), // Ensure max length
    }));

  // If we don't have 3 slots, fill with fallback
  if (rankedSlots.length < 3) {
    const usedIndices = new Set(recommendations.map((r) => r.slot_index));
    for (let i = 0; rankedSlots.length < 3 && i < candidates.length; i++) {
      if (!usedIndices.has(i)) {
        rankedSlots.push({
          ...candidates[i],
          reason: generateGenericReason(candidates[i], rankedSlots.length),
        });
      }
    }
  }

  return rankedSlots;
}

/**
 * Generate fallback recommendations when AI is unavailable
 */
function generateFallbackRecommendations(candidates: TimeSlot[]): TimeSlot[] {
  return candidates.slice(0, 3).map((slot, index) => ({
    ...slot,
    reason: generateGenericReason(slot, index),
  }));
}

/**
 * Generate a generic reason for a time slot
 */
function generateGenericReason(slot: TimeSlot, rank: number): string {
  const start = new Date(slot.start);
  const hour = start.getHours();
  const dayName = start.toLocaleDateString("en-US", { weekday: "long" });

  if (rank === 0) {
    return `Best available slot on ${dayName}`;
  }

  if (hour < 12) {
    return `Morning option on ${dayName}`;
  } else if (hour < 17) {
    return `Afternoon option on ${dayName}`;
  } else {
    return `Evening option on ${dayName}`;
  }
}

/**
 * Convert personality scores to human-readable descriptions
 */
function describePersonality(p: PersonalityData): string {
  const lines: string[] = [];

  // Chronotype
  if (p.chronotype >= 70) {
    lines.push("- Early bird: Most productive in the morning (6-10am)");
  } else if (p.chronotype <= 30) {
    lines.push("- Night owl: Most productive later in the day (afternoon/evening)");
  } else {
    lines.push("- Flexible schedule: Productive throughout the day");
  }

  // Focus duration
  if (p.focus_duration >= 70) {
    lines.push("- Deep focus worker: Prefers long uninterrupted work blocks (2-3 hours)");
  } else if (p.focus_duration <= 30) {
    lines.push("- Sprint worker: Prefers shorter focused sessions (25-45 min)");
  } else {
    lines.push("- Moderate focus: Works well in 1-hour blocks");
  }

  // Deadline style
  if (p.deadline_style >= 70) {
    lines.push("- Pressure performer: Works well close to deadlines");
  } else if (p.deadline_style <= 30) {
    lines.push("- Early starter: Prefers to start tasks well before deadlines");
  } else {
    lines.push("- Balanced approach to deadlines");
  }

  // Break frequency
  if (p.break_frequency >= 70) {
    lines.push("- Marathon worker: Can work long stretches without breaks");
  } else if (p.break_frequency <= 30) {
    lines.push("- Frequent breaks: Needs regular breaks to stay fresh");
  }

  // Task switching
  if (p.task_switching >= 70) {
    lines.push("- Multi-tasker: Comfortable switching between different tasks");
  } else if (p.task_switching <= 30) {
    lines.push("- Single-tasker: Prefers to focus on one thing at a time");
  }

  // Structure preference
  if (p.structure_preference >= 70) {
    lines.push("- Flexible: Adapts well to schedule changes");
  } else if (p.structure_preference <= 30) {
    lines.push("- Structured: Prefers consistent, predictable schedules");
  }

  return lines.join("\n");
}

/**
 * Format date/time for display
 */
function formatDateTime(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Check rate limit (100 requests per hour per user)
 */
async function checkRateLimit(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("ai_rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);

  if (error) {
    console.error("Rate limit check error:", error);
    // Allow on error (fail open for better UX)
    return true;
  }

  return (count || 0) < 100;
}

/**
 * Record rate limit usage
 */
async function recordRateLimitUsage(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from("ai_rate_limits")
    .insert({ user_id: userId });

  if (error) {
    console.error("Failed to record rate limit usage:", error);
  }
}
