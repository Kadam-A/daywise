/**
 * TailoredTime - App Review Request Service
 *
 * Smart review request timing with happiness pre-filter.
 * Routes happy users to native review, unhappy to feedback form.
 *
 * Flow:
 * 1. Check eligibility (5+ tasks, 7+ days, not Pro, not shown before)
 * 2. Show HappinessCheckModal
 * 3. "Loving it!" → Native review + 7-day Pro trial
 * 4. "It's okay" → Feedback form + 7-day Pro trial
 */

import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { HappinessResponse } from './types';
import { startFreeTrial } from './purchases';
import {
  trackHappinessCheckShown,
  trackHappinessResponse,
  trackReviewTrialGranted,
} from './analytics';

const STORAGE_KEYS = {
  REVIEW_REQUESTED: 'review_requested',
  TASKS_COMPLETED_COUNT: 'tasks_completed_count',
  HAPPINESS_CHECK_SHOWN: 'happiness_check_shown',
};

// Configuration
const MIN_TASKS_COMPLETED = 5;
const MIN_DAYS_SINCE_INSTALL = 7;
const TRIAL_DURATION_DAYS = 7;

/**
 * Increment the completed tasks counter
 * Call this every time a task is marked complete
 */
export async function incrementCompletedTaskCount(): Promise<void> {
  try {
    const currentCount = await getCompletedTaskCount();
    await AsyncStorage.setItem(
      STORAGE_KEYS.TASKS_COMPLETED_COUNT,
      String(currentCount + 1)
    );
    console.log('[Review] Tasks completed:', currentCount + 1);
  } catch (err) {
    console.error('[Review] Error incrementing count:', err);
  }
}

/**
 * Get current completed task count
 */
async function getCompletedTaskCount(): Promise<number> {
  try {
    const count = await AsyncStorage.getItem(STORAGE_KEYS.TASKS_COMPLETED_COUNT);
    return count ? parseInt(count, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Check if review has already been requested
 */
async function hasReviewBeenRequested(): Promise<boolean> {
  try {
    const requested = await AsyncStorage.getItem(STORAGE_KEYS.REVIEW_REQUESTED);
    return requested === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark review as requested
 */
async function markReviewRequested(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.REVIEW_REQUESTED, 'true');
  } catch (err) {
    console.error('[Review] Error marking requested:', err);
  }
}

/**
 * Get days since user install
 */
async function getDaysSinceInstall(): Promise<number> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;

    const { data: funnel } = await supabase
      .from('user_funnel')
      .select('installed_at')
      .eq('user_id', user.id)
      .single();

    if (!funnel?.installed_at) return 0;

    const installDate = new Date(funnel.installed_at);
    const now = new Date();
    const diffMs = now.getTime() - installDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  } catch (err) {
    console.error('[Review] Error getting install date:', err);
    return 0;
  }
}

/**
 * Maybe request an app review
 *
 * Call this after positive moments like task completion.
 * Will only show if all conditions are met and hasn't been shown before.
 */
export async function maybeRequestReview(): Promise<boolean> {
  try {
    // Check if already requested
    const alreadyRequested = await hasReviewBeenRequested();
    if (alreadyRequested) {
      console.log('[Review] Already requested, skipping');
      return false;
    }

    // Check task count
    const taskCount = await getCompletedTaskCount();
    if (taskCount < MIN_TASKS_COMPLETED) {
      console.log('[Review] Not enough tasks:', taskCount, '/', MIN_TASKS_COMPLETED);
      return false;
    }

    // Check days since install
    const daysSinceInstall = await getDaysSinceInstall();
    if (daysSinceInstall < MIN_DAYS_SINCE_INSTALL) {
      console.log('[Review] Too soon:', daysSinceInstall, '/', MIN_DAYS_SINCE_INSTALL, 'days');
      return false;
    }

    // Check if store review is available
    const isAvailable = await StoreReview.hasAction();
    if (!isAvailable) {
      console.log('[Review] Store review not available');
      return false;
    }

    // All conditions met - request review
    console.log('[Review] Requesting review');
    await StoreReview.requestReview();
    await markReviewRequested();
    return true;
  } catch (err) {
    console.error('[Review] Error:', err);
    return false;
  }
}

/**
 * Check if review request is eligible (without showing it)
 * Useful for debugging or analytics
 */
export async function isEligibleForReview(): Promise<{
  eligible: boolean;
  alreadyRequested: boolean;
  taskCount: number;
  minTasks: number;
  daysSinceInstall: number;
  minDays: number;
}> {
  const alreadyRequested = await hasReviewBeenRequested();
  const taskCount = await getCompletedTaskCount();
  const daysSinceInstall = await getDaysSinceInstall();

  return {
    eligible:
      !alreadyRequested &&
      taskCount >= MIN_TASKS_COMPLETED &&
      daysSinceInstall >= MIN_DAYS_SINCE_INSTALL,
    alreadyRequested,
    taskCount,
    minTasks: MIN_TASKS_COMPLETED,
    daysSinceInstall,
    minDays: MIN_DAYS_SINCE_INSTALL,
  };
}

/**
 * Reset review state (for testing only)
 */
export async function resetReviewState(): Promise<void> {
  if (!__DEV__) {
    console.warn('[Review] Reset only available in dev');
    return;
  }

  await AsyncStorage.removeItem(STORAGE_KEYS.REVIEW_REQUESTED);
  await AsyncStorage.removeItem(STORAGE_KEYS.TASKS_COMPLETED_COUNT);
  await AsyncStorage.removeItem(STORAGE_KEYS.HAPPINESS_CHECK_SHOWN);
  console.log('[Review] State reset');
}

// ============================================================================
// HAPPINESS CHECK FLOW
// ============================================================================

/**
 * Check if happiness check has already been shown
 */
async function hasHappinessCheckBeenShown(): Promise<boolean> {
  try {
    const shown = await AsyncStorage.getItem(STORAGE_KEYS.HAPPINESS_CHECK_SHOWN);
    return shown === 'true';
  } catch {
    return false;
  }
}

/**
 * Mark happiness check as shown
 */
async function markHappinessCheckShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.HAPPINESS_CHECK_SHOWN, 'true');

    // Also update in database for cross-device tracking
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('user_funnel')
        .update({
          review_request_shown: true,
          review_request_shown_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
    }
  } catch (err) {
    console.error('[Review] Error marking happiness check shown:', err);
  }
}

/**
 * Check if user has an active Pro subscription or trial
 */
async function isUserPro(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select('status, trial_ends_at')
      .eq('user_id', user.id)
      .single();

    if (!subscription) return false;

    // Check if active subscription
    if (subscription.status === 'active') return true;

    // Check if in active trial
    if (subscription.status === 'trial' && subscription.trial_ends_at) {
      const trialEnd = new Date(subscription.trial_ends_at);
      return trialEnd > new Date();
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Check if user is eligible for happiness check flow
 * Returns eligibility info + the task count for display
 */
export async function checkHappinessFlowEligibility(): Promise<{
  eligible: boolean;
  tasksCompleted: number;
  reason?: string;
}> {
  try {
    // Check if already shown
    const alreadyShown = await hasHappinessCheckBeenShown();
    if (alreadyShown) {
      return { eligible: false, tasksCompleted: 0, reason: 'already_shown' };
    }

    // Check if Pro user (don't bother Pro users)
    const isPro = await isUserPro();
    if (isPro) {
      return { eligible: false, tasksCompleted: 0, reason: 'is_pro' };
    }

    // Check task count
    const taskCount = await getCompletedTaskCount();
    if (taskCount < MIN_TASKS_COMPLETED) {
      return { eligible: false, tasksCompleted: taskCount, reason: 'not_enough_tasks' };
    }

    // Check days since install
    const daysSinceInstall = await getDaysSinceInstall();
    if (daysSinceInstall < MIN_DAYS_SINCE_INSTALL) {
      return { eligible: false, tasksCompleted: taskCount, reason: 'too_soon' };
    }

    // All checks passed
    return { eligible: true, tasksCompleted: taskCount };
  } catch (err) {
    console.error('[Review] Eligibility check error:', err);
    return { eligible: false, tasksCompleted: 0, reason: 'error' };
  }
}

/**
 * Record happiness response in database
 */
async function recordHappinessResponse(response: HappinessResponse): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('user_funnel')
      .update({
        happiness_response: response,
      })
      .eq('user_id', user.id);

    await trackHappinessResponse(response);
    console.log('[Review] Recorded happiness response:', response);
  } catch (err) {
    console.error('[Review] Error recording response:', err);
  }
}

/**
 * Request native store review
 */
export async function requestNativeReview(): Promise<boolean> {
  try {
    const isAvailable = await StoreReview.hasAction();
    if (!isAvailable) {
      console.log('[Review] Native review not available');
      return false;
    }

    await StoreReview.requestReview();
    await markReviewRequested();
    console.log('[Review] Native review requested');
    return true;
  } catch (err) {
    console.error('[Review] Native review error:', err);
    return false;
  }
}

/**
 * Grant Pro trial as thank-you
 */
async function grantReviewTrial(reason: 'review_bonus' | 'feedback_bonus'): Promise<boolean> {
  try {
    const result = await startFreeTrial(TRIAL_DURATION_DAYS, reason);
    if (result.success) {
      await trackReviewTrialGranted(reason);
      console.log('[Review] Trial granted:', reason);
    }
    return result.success;
  } catch (err) {
    console.error('[Review] Trial grant error:', err);
    return false;
  }
}

/**
 * Handle the happiness check being shown
 * Call this when the modal becomes visible
 */
export async function onHappinessCheckShown(): Promise<void> {
  await markHappinessCheckShown();
  await trackHappinessCheckShown();
  console.log('[Review] Happiness check shown');
}

/**
 * Handle user's happiness response
 * Returns action to take and whether trial was granted
 */
export async function handleHappinessResponse(
  response: HappinessResponse
): Promise<{
  action: 'show_native_review' | 'show_feedback_form';
  trialGranted: boolean;
}> {
  // Record the response
  await recordHappinessResponse(response);

  if (response === 'loving_it') {
    // Happy user → Native review
    await requestNativeReview();
    const trialGranted = await grantReviewTrial('review_bonus');

    return {
      action: 'show_native_review',
      trialGranted,
    };
  } else {
    // Unhappy user → Feedback form (trial granted after form)
    return {
      action: 'show_feedback_form',
      trialGranted: false, // Will grant after feedback
    };
  }
}

/**
 * Handle feedback form completion (submit or skip)
 * Returns whether trial was granted
 */
export async function handleFeedbackFormComplete(
  submitted: boolean
): Promise<{ trialGranted: boolean }> {
  // Grant trial regardless of submission
  const reason = submitted ? 'feedback_bonus' : 'feedback_bonus';
  const trialGranted = await grantReviewTrial(reason);

  return { trialGranted };
}
