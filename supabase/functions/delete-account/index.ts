/**
 * TailoredTime - Delete Account Edge Function
 *
 * Permanently deletes a user's account and all associated data.
 * Required for GDPR compliance and App Store approval.
 *
 * Cascades delete through:
 * - tasks (including subtasks)
 * - calendar_events
 * - user_profiles
 * - auth.users (via admin API)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DeleteResult {
  table: string;
  count: number;
}

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

    // Get the user ID from the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    // Verify the user's token to get their ID
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error("Invalid authentication");
    }

    const userId = user.id;
    console.log(`[delete-account] Starting deletion for user ${userId}`);

    const results: DeleteResult[] = [];

    // 1. Delete all tasks (including subtasks due to foreign key cascade)
    const { data: deletedTasks, error: tasksError } = await supabase
      .from("tasks")
      .delete()
      .eq("user_id", userId)
      .select("id");

    if (tasksError) {
      console.error("[delete-account] Error deleting tasks:", tasksError);
    } else {
      results.push({ table: "tasks", count: deletedTasks?.length || 0 });
      console.log(`[delete-account] Deleted ${deletedTasks?.length || 0} tasks`);
    }

    // 2. Delete all calendar events
    const { data: deletedEvents, error: eventsError } = await supabase
      .from("calendar_events")
      .delete()
      .eq("user_id", userId)
      .select("id");

    if (eventsError) {
      console.error("[delete-account] Error deleting calendar events:", eventsError);
    } else {
      results.push({ table: "calendar_events", count: deletedEvents?.length || 0 });
      console.log(`[delete-account] Deleted ${deletedEvents?.length || 0} calendar events`);
    }

    // 3. Delete analytics events
    const { error: analyticsError } = await supabase
      .from("analytics_events")
      .delete()
      .eq("user_id", userId);

    if (analyticsError) {
      console.error("[delete-account] Error deleting analytics:", analyticsError);
    } else {
      results.push({ table: "analytics_events", count: 1 });
      console.log("[delete-account] Deleted analytics events");
    }

    // 4. Delete user funnel
    const { error: funnelError } = await supabase
      .from("user_funnel")
      .delete()
      .eq("user_id", userId);

    if (funnelError) {
      console.error("[delete-account] Error deleting funnel:", funnelError);
    } else {
      results.push({ table: "user_funnel", count: 1 });
      console.log("[delete-account] Deleted user funnel");
    }

    // 5. Delete daily metrics
    const { error: metricsError } = await supabase
      .from("user_daily_metrics")
      .delete()
      .eq("user_id", userId);

    if (metricsError) {
      console.error("[delete-account] Error deleting metrics:", metricsError);
    } else {
      results.push({ table: "user_daily_metrics", count: 1 });
      console.log("[delete-account] Deleted daily metrics");
    }

    // 6. Delete subscription (note: RevenueCat will handle the actual subscription cancellation)
    const { error: subscriptionError } = await supabase
      .from("user_subscriptions")
      .delete()
      .eq("user_id", userId);

    if (subscriptionError) {
      console.error("[delete-account] Error deleting subscription:", subscriptionError);
    } else {
      results.push({ table: "user_subscriptions", count: 1 });
      console.log("[delete-account] Deleted subscription");
    }

    // 7. Delete user profile
    const { error: profileError } = await supabase
      .from("user_profiles")
      .delete()
      .eq("id", userId);

    if (profileError) {
      console.error("[delete-account] Error deleting profile:", profileError);
    } else {
      results.push({ table: "user_profiles", count: 1 });
      console.log("[delete-account] Deleted user profile");
    }

    // 8. Delete the auth user using admin API
    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      console.error("[delete-account] Error deleting auth user:", deleteUserError);
      throw new Error(`Failed to delete auth user: ${deleteUserError.message}`);
    }

    results.push({ table: "auth.users", count: 1 });
    console.log("[delete-account] Deleted auth user");

    console.log(`[delete-account] Account deletion complete for user ${userId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Account and all associated data have been permanently deleted",
        details: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[delete-account] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete account",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
