/**
 * TailoredTime - RevenueCat Webhook Handler
 *
 * Handles subscription events from RevenueCat:
 * - INITIAL_PURCHASE
 * - RENEWAL
 * - CANCELLATION
 * - EXPIRATION
 * - BILLING_ISSUE
 * - PRODUCT_CHANGE
 *
 * Updates user_subscriptions table based on events.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// RevenueCat event types we handle
type RevenueCatEventType =
  | "INITIAL_PURCHASE"
  | "RENEWAL"
  | "CANCELLATION"
  | "UNCANCELLATION"
  | "EXPIRATION"
  | "BILLING_ISSUE"
  | "BILLING_ISSUE_RESOLVED"
  | "PRODUCT_CHANGE"
  | "TRANSFER";

interface RevenueCatEvent {
  type: RevenueCatEventType;
  app_user_id: string; // Our Supabase user ID
  product_id: string;
  entitlement_id?: string;
  period_type?: "NORMAL" | "TRIAL" | "INTRO";
  expiration_at_ms?: number;
  purchased_at_ms?: number;
  original_app_user_id?: string;
  store?: "APP_STORE" | "PLAY_STORE" | "STRIPE";
  is_trial_conversion?: boolean;
  is_family_share?: boolean;
}

interface RevenueCatWebhookPayload {
  api_version: string;
  event: RevenueCatEvent;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify webhook authorization
    const authHeader = req.headers.get("Authorization");
    const webhookSecret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");

    if (webhookSecret && authHeader !== `Bearer ${webhookSecret}`) {
      console.error("[Webhook] Invalid authorization");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse webhook payload
    const payload: RevenueCatWebhookPayload = await req.json();
    const event = payload.event;

    console.log(`[Webhook] Received event: ${event.type} for user: ${event.app_user_id}`);

    // Initialize Supabase with service role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get user ID (RevenueCat app_user_id should be our Supabase user ID)
    const userId = event.app_user_id;

    if (!userId) {
      console.error("[Webhook] No user ID in event");
      return new Response(
        JSON.stringify({ error: "Missing user ID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine plan from product ID
    const planId = getPlanIdFromProduct(event.product_id);

    // Handle event type
    switch (event.type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
        await handlePurchaseOrRenewal(supabase, userId, planId, event);
        break;

      case "CANCELLATION":
        await handleCancellation(supabase, userId);
        break;

      case "UNCANCELLATION":
        await handleUncancellation(supabase, userId);
        break;

      case "EXPIRATION":
        await handleExpiration(supabase, userId);
        break;

      case "BILLING_ISSUE":
        await handleBillingIssue(supabase, userId);
        break;

      case "BILLING_ISSUE_RESOLVED":
        await handleBillingIssueResolved(supabase, userId, planId);
        break;

      case "PRODUCT_CHANGE":
        await handleProductChange(supabase, userId, planId, event);
        break;

      case "TRANSFER":
        // User transferred between accounts - not typically needed
        console.log("[Webhook] Transfer event, no action needed");
        break;

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Map RevenueCat product ID to our plan ID
 */
function getPlanIdFromProduct(productId: string): string {
  if (productId.includes("yearly") || productId.includes("annual")) {
    return "pro_yearly";
  }
  if (productId.includes("monthly")) {
    return "pro_monthly";
  }
  return "pro_monthly"; // Default to monthly
}

/**
 * Handle initial purchase or renewal
 */
async function handlePurchaseOrRenewal(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  planId: string,
  event: RevenueCatEvent
) {
  const now = new Date();
  const expirationDate = event.expiration_at_ms
    ? new Date(event.expiration_at_ms)
    : null;
  const purchaseDate = event.purchased_at_ms
    ? new Date(event.purchased_at_ms)
    : now;

  const { error } = await supabase
    .from("user_subscriptions")
    .upsert({
      user_id: userId,
      plan_id: planId,
      status: "active",
      current_period_start: purchaseDate.toISOString(),
      current_period_end: expirationDate?.toISOString() || null,
      cancel_at_period_end: false,
      trial_ends_at: null, // Clear trial if it was a conversion
      revenuecat_customer_id: event.original_app_user_id || userId,
    }, {
      onConflict: "user_id",
    });

  if (error) {
    console.error("[Webhook] Error updating subscription:", error);
    throw error;
  }

  console.log(`[Webhook] ${event.type} processed for user ${userId}, plan: ${planId}`);
}

/**
 * Handle cancellation (will expire at period end)
 */
async function handleCancellation(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      cancel_at_period_end: true,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("[Webhook] Error updating cancellation:", error);
    throw error;
  }

  console.log(`[Webhook] Cancellation processed for user ${userId}`);
}

/**
 * Handle uncancellation (user resubscribed before period end)
 */
async function handleUncancellation(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      cancel_at_period_end: false,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("[Webhook] Error updating uncancellation:", error);
    throw error;
  }

  console.log(`[Webhook] Uncancellation processed for user ${userId}`);
}

/**
 * Handle expiration (subscription has fully expired)
 */
async function handleExpiration(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      plan_id: "free",
      status: "expired",
      cancel_at_period_end: false,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("[Webhook] Error updating expiration:", error);
    throw error;
  }

  console.log(`[Webhook] Expiration processed for user ${userId}`);
}

/**
 * Handle billing issue (payment failed)
 */
async function handleBillingIssue(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  // Keep the subscription active but mark the issue
  // RevenueCat will handle retry logic
  console.log(`[Webhook] Billing issue for user ${userId}`);
  // Could add a billing_issue_at timestamp if needed for notifications
}

/**
 * Handle billing issue resolved
 */
async function handleBillingIssueResolved(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  planId: string
) {
  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      plan_id: planId,
      status: "active",
    })
    .eq("user_id", userId);

  if (error) {
    console.error("[Webhook] Error updating billing resolved:", error);
    throw error;
  }

  console.log(`[Webhook] Billing issue resolved for user ${userId}`);
}

/**
 * Handle product change (upgrade/downgrade)
 */
async function handleProductChange(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  planId: string,
  event: RevenueCatEvent
) {
  const expirationDate = event.expiration_at_ms
    ? new Date(event.expiration_at_ms)
    : null;

  const { error } = await supabase
    .from("user_subscriptions")
    .update({
      plan_id: planId,
      status: "active",
      current_period_end: expirationDate?.toISOString() || null,
      cancel_at_period_end: false,
    })
    .eq("user_id", userId);

  if (error) {
    console.error("[Webhook] Error updating product change:", error);
    throw error;
  }

  console.log(`[Webhook] Product change processed for user ${userId}, new plan: ${planId}`);
}
