/**
 * TailoredTime - RevenueCat Purchases Service
 *
 * Handles in-app purchases and subscription management via RevenueCat.
 * RevenueCat handles the complexity of App Store/Play Store subscriptions.
 */

import Purchases, {
  PurchasesPackage,
  CustomerInfo,
  PurchasesError,
  LOG_LEVEL,
} from 'react-native-purchases';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import {
  trackPurchaseStarted,
  trackPurchaseCompleted,
  trackPurchaseFailed,
  trackPurchaseRestored,
  trackTrialStarted,
} from './analytics';

// RevenueCat API keys (set in environment)
const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || '';
const REVENUECAT_ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '';

// Product identifiers
export const PRODUCT_IDS = {
  PRO_MONTHLY: 'daywise_pro_monthly',
  PRO_YEARLY: 'daywise_pro_yearly',
} as const;

// Entitlement identifier — must match RevenueCat dashboard exactly
export const ENTITLEMENT_ID = 'DayWise Pro';

let isInitialized = false;

/**
 * Initialize RevenueCat
 * Should be called once on app startup after auth is ready
 */
export async function initializePurchases(): Promise<void> {
  if (isInitialized) {
    console.log('[Purchases] Already initialized');
    return;
  }

  try {
    const apiKey = Platform.OS === 'ios' ? REVENUECAT_IOS_KEY : REVENUECAT_ANDROID_KEY;

    if (!apiKey) {
      console.warn('[Purchases] No API key configured for platform:', Platform.OS);
      return;
    }

    // Enable debug logs in development
    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }

    await Purchases.configure({ apiKey });
    isInitialized = true;

    // Identify user with Supabase user ID
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await Purchases.logIn(user.id);
      console.log('[Purchases] Identified user:', user.id);
    }

    console.log('[Purchases] Initialized successfully');
  } catch (err) {
    console.error('[Purchases] Initialization error:', err);
  }
}

/**
 * Identify user with RevenueCat (call after login)
 */
export async function identifyUser(userId: string): Promise<void> {
  if (!isInitialized) {
    console.warn('[Purchases] Not initialized');
    return;
  }

  try {
    await Purchases.logIn(userId);
    console.log('[Purchases] User identified:', userId);
  } catch (err) {
    console.error('[Purchases] Error identifying user:', err);
  }
}

/**
 * Log out user from RevenueCat (call on sign out)
 */
export async function logoutPurchases(): Promise<void> {
  if (!isInitialized) return;

  try {
    await Purchases.logOut();
    console.log('[Purchases] User logged out');
  } catch (err) {
    console.error('[Purchases] Error logging out:', err);
  }
}

/**
 * Get available packages (subscription options)
 */
export async function getPackages(): Promise<PurchasesPackage[]> {
  if (!isInitialized) {
    console.warn('[Purchases] Not initialized');
    return [];
  }

  try {
    const offerings = await Purchases.getOfferings();

    if (!offerings.current) {
      console.warn('[Purchases] No current offering');
      return [];
    }

    return offerings.current.availablePackages;
  } catch (err) {
    console.error('[Purchases] Error getting packages:', err);
    return [];
  }
}

/**
 * Purchase a package
 */
export async function purchasePackage(
  pkg: PurchasesPackage
): Promise<{ success: boolean; customerInfo?: CustomerInfo; error?: string }> {
  if (!isInitialized) {
    return { success: false, error: 'Purchases not initialized' };
  }

  try {
    const planName = pkg.identifier;
    await trackPurchaseStarted(planName);

    const { customerInfo } = await Purchases.purchasePackage(pkg);

    // Check if purchase was successful
    if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
      await trackPurchaseCompleted(planName);
      await syncSubscriptionFromCustomerInfo(customerInfo);
      console.log('[Purchases] Purchase successful');
      return { success: true, customerInfo };
    }

    return { success: false, error: 'Purchase did not activate entitlement' };
  } catch (err) {
    const error = err as PurchasesError;

    // User cancelled
    if (error.userCancelled) {
      console.log('[Purchases] User cancelled');
      return { success: false, error: 'cancelled' };
    }

    await trackPurchaseFailed(pkg.identifier, error.message);
    console.error('[Purchases] Purchase error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Trial reason for tracking
 */
export type TrialReason = 'standard' | 'review_bonus' | 'feedback_bonus';

/**
 * Start free trial (no payment required)
 * @param durationDays - Number of days for the trial (default 7)
 * @param reason - Reason for the trial grant (for analytics)
 */
export async function startFreeTrial(
  durationDays: number = 7,
  reason: TrialReason = 'standard'
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Calculate trial end date
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + durationDays);

    // Use UPDATE (not upsert) — the trigger always creates the row on signup,
    // and Supabase upsert can silently skip the update path under RLS.
    const { error, count } = await supabase
      .from('user_subscriptions')
      .update({
        status: 'trial',
        trial_ends_at: trialEndsAt.toISOString(),
        trial_reason: reason,
      })
      .eq('user_id', user.id)
      .select('user_id', { count: 'exact', head: true });

    console.log('[Purchases] Trial update result — error:', error, 'rows updated:', count);

    if (error) {
      console.error('[Purchases] Error starting trial:', error);
      return { success: false, error: error.message };
    }

    if (count === 0) {
      // Row didn't exist yet (edge case: trigger hasn't run). Fall back to insert.
      const { error: insertError } = await supabase
        .from('user_subscriptions')
        .insert({ user_id: user.id, status: 'trial', trial_ends_at: trialEndsAt.toISOString(), trial_reason: reason });
      if (insertError) {
        console.error('[Purchases] Trial insert fallback error:', insertError);
        return { success: false, error: insertError.message };
      }
    }

    await trackTrialStarted(reason);
    console.log('[Purchases] Trial started, reason:', reason, 'ends:', trialEndsAt);
    return { success: true };
  } catch (err) {
    console.error('[Purchases] Trial error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Restore purchases (for device transfers)
 */
export async function restorePurchases(): Promise<{
  success: boolean;
  customerInfo?: CustomerInfo;
  error?: string;
}> {
  if (!isInitialized) {
    return { success: false, error: 'Purchases not initialized' };
  }

  try {
    const customerInfo = await Purchases.restorePurchases();

    if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
      const planId = getPlanIdFromCustomerInfo(customerInfo);
      await trackPurchaseRestored(planId);
      await syncSubscriptionFromCustomerInfo(customerInfo);
      console.log('[Purchases] Purchases restored');
      return { success: true, customerInfo };
    }

    return { success: false, error: 'No active subscriptions found' };
  } catch (err) {
    console.error('[Purchases] Restore error:', err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Get current customer info
 */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isInitialized) return null;

  try {
    return await Purchases.getCustomerInfo();
  } catch (err) {
    console.error('[Purchases] Error getting customer info:', err);
    return null;
  }
}

/**
 * Check if user has active Pro subscription
 */
export async function hasActiveSubscription(): Promise<boolean> {
  const customerInfo = await getCustomerInfo();
  return !!customerInfo?.entitlements.active[ENTITLEMENT_ID];
}

/**
 * Immediately sync subscription to DB from RevenueCat customer info.
 * Called after purchase/restore so the UI updates before the webhook fires.
 */
async function syncSubscriptionFromCustomerInfo(customerInfo: CustomerInfo): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
    if (!entitlement) return;

    const planId = getPlanIdFromCustomerInfo(customerInfo);
    const expirationDate = entitlement.expirationDate ? new Date(entitlement.expirationDate) : null;

    const { error } = await supabase
      .from('user_subscriptions')
      .upsert({
        user_id: user.id,
        plan_id: planId,
        status: 'active',
        current_period_end: expirationDate?.toISOString() || null,
        cancel_at_period_end: false,
        trial_ends_at: null,
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('[Purchases] Error syncing subscription to DB:', error);
    } else {
      console.log('[Purchases] Subscription synced to DB immediately');
    }
  } catch (err) {
    console.error('[Purchases] syncSubscriptionFromCustomerInfo error:', err);
  }
}

/**
 * Helper to get plan ID from customer info
 */
function getPlanIdFromCustomerInfo(customerInfo: CustomerInfo): string {
  const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
  if (!entitlement) return 'free';

  const productId = entitlement.productIdentifier;
  if (productId.includes('yearly') || productId.includes('annual')) {
    return 'pro_yearly';
  }
  return 'pro_monthly';
}

/**
 * Format price for display
 */
export function formatPrice(pkg: PurchasesPackage): string {
  return pkg.product.priceString;
}

/**
 * Get savings percentage for yearly plan
 */
export function getYearlySavings(monthlyPkg: PurchasesPackage, yearlyPkg: PurchasesPackage): number {
  const monthlyPrice = monthlyPkg.product.price;
  const yearlyPrice = yearlyPkg.product.price;
  const yearlyIfMonthly = monthlyPrice * 12;
  const savings = ((yearlyIfMonthly - yearlyPrice) / yearlyIfMonthly) * 100;
  return Math.round(savings);
}
