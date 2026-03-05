/**
 * TailoredTime - Analytics Service
 *
 * Tracks user events and funnel progression for LTV analysis.
 * All events are stored in Supabase for analysis.
 */

import { supabase } from './supabase';
import { AnalyticsEventName } from './types';

/**
 * Track an analytics event
 * @param eventName - Name of the event
 * @param data - Optional event data
 */
export async function trackEvent(
  eventName: AnalyticsEventName,
  data?: Record<string, any>
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[Analytics] No user, skipping event:', eventName);
      return;
    }

    const { error } = await supabase.from('analytics_events').insert({
      user_id: user.id,
      event_name: eventName,
      event_data: data || null,
    });

    if (error) {
      console.error('[Analytics] Error tracking event:', error);
    } else {
      console.log('[Analytics] Tracked:', eventName, data);
    }
  } catch (err) {
    // Don't let analytics errors break the app
    console.error('[Analytics] Error:', err);
  }
}

/**
 * Funnel field names that can be updated
 */
type FunnelField =
  | 'onboarding_completed_at'
  | 'first_task_at'
  | 'first_schedule_at'
  | 'first_completion_at'
  | 'converted_to_paid_at';

/**
 * Update a funnel milestone (only sets if not already set)
 * @param field - The funnel field to update
 */
export async function updateFunnel(field: FunnelField): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[Analytics] No user, skipping funnel update:', field);
      return;
    }

    // First check if already set (to avoid unnecessary updates)
    const { data: existing } = await supabase
      .from('user_funnel')
      .select(field)
      .eq('user_id', user.id)
      .single();

    if (existing && existing[field]) {
      console.log('[Analytics] Funnel field already set:', field);
      return;
    }

    const { error } = await supabase
      .from('user_funnel')
      .update({ [field]: new Date().toISOString() })
      .eq('user_id', user.id);

    if (error) {
      // If no row exists, create one
      if (error.code === 'PGRST116') {
        const { error: insertError } = await supabase
          .from('user_funnel')
          .insert({
            user_id: user.id,
            installed_at: new Date().toISOString(),
            [field]: new Date().toISOString(),
          });

        if (insertError) {
          console.error('[Analytics] Error creating funnel:', insertError);
        }
      } else {
        console.error('[Analytics] Error updating funnel:', error);
      }
    } else {
      console.log('[Analytics] Updated funnel:', field);
    }
  } catch (err) {
    console.error('[Analytics] Funnel error:', err);
  }
}

/**
 * Mark user as active for retention tracking
 */
export async function markUserActive(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: funnel } = await supabase
      .from('user_funnel')
      .select('installed_at, day_7_active, day_30_active')
      .eq('user_id', user.id)
      .single();

    if (!funnel) return;

    const installDate = new Date(funnel.installed_at);
    const now = new Date();
    const daysSinceInstall = Math.floor(
      (now.getTime() - installDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const updates: Record<string, boolean> = {};

    // Mark day 7 active if user is active after 7 days
    if (daysSinceInstall >= 7 && !funnel.day_7_active) {
      updates.day_7_active = true;
    }

    // Mark day 30 active if user is active after 30 days
    if (daysSinceInstall >= 30 && !funnel.day_30_active) {
      updates.day_30_active = true;
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('user_funnel')
        .update(updates)
        .eq('user_id', user.id);

      console.log('[Analytics] Updated retention flags:', updates);
    }
  } catch (err) {
    console.error('[Analytics] Error marking active:', err);
  }
}

/**
 * Track task creation with method
 */
export function trackTaskCreated(schedulingMethod: 'SMART' | 'MANUAL'): Promise<void> {
  return trackEvent('task_created', { method: schedulingMethod });
}

/**
 * Track task scheduling
 */
export function trackTaskScheduled(schedulingMethod: 'SMART' | 'MANUAL'): Promise<void> {
  return trackEvent('task_scheduled', { method: schedulingMethod });
}

/**
 * Track task completion
 */
export async function trackTaskCompleted(): Promise<void> {
  await trackEvent('task_completed');
  await updateFunnel('first_completion_at');
}

/**
 * Track onboarding completion
 */
export async function trackOnboardingCompleted(): Promise<void> {
  await trackEvent('onboarding_completed');
  await updateFunnel('onboarding_completed_at');
}

/**
 * Track paywall view
 */
export function trackPaywallViewed(source?: string): Promise<void> {
  return trackEvent('paywall_viewed', { source });
}

/**
 * Track paywall dismissal
 */
export function trackPaywallDismissed(): Promise<void> {
  return trackEvent('paywall_dismissed');
}

/**
 * Track purchase events
 */
export function trackPurchaseStarted(plan: string): Promise<void> {
  return trackEvent('purchase_started', { plan });
}

export async function trackPurchaseCompleted(plan: string): Promise<void> {
  await trackEvent('purchase_completed', { plan });
  await updateFunnel('converted_to_paid_at');
}

export function trackPurchaseFailed(plan: string, error?: string): Promise<void> {
  return trackEvent('purchase_failed', { plan, error });
}

export function trackPurchaseRestored(plan: string): Promise<void> {
  return trackEvent('purchase_restored', { plan });
}

/**
 * Track trial started
 */
export function trackTrialStarted(reason?: string): Promise<void> {
  return trackEvent('trial_started', reason ? { reason } : undefined);
}

/**
 * Track calendar sync
 */
export function trackCalendarSynced(eventCount: number): Promise<void> {
  return trackEvent('calendar_synced', { event_count: eventCount });
}

export function trackCalendarSyncFailed(error: string): Promise<void> {
  return trackEvent('calendar_sync_failed', { error });
}

/**
 * Track review flow events
 */
export function trackHappinessCheckShown(): Promise<void> {
  return trackEvent('happiness_check_shown');
}

export function trackHappinessResponse(response: 'loving_it' | 'its_okay'): Promise<void> {
  return trackEvent('happiness_response', { response });
}

export function trackFeedbackSubmitted(category: string, triggerPoint: string): Promise<void> {
  return trackEvent('feedback_submitted', { category, trigger_point: triggerPoint });
}

export function trackFeedbackSkipped(): Promise<void> {
  return trackEvent('feedback_skipped');
}

export function trackReviewTrialGranted(reason: string): Promise<void> {
  return trackEvent('review_trial_granted', { reason });
}

/**
 * Track individual onboarding step completion
 */
export function trackOnboardingStep(step: number, question: string): Promise<void> {
  return trackEvent('onboarding_step_completed', { step, question });
}
