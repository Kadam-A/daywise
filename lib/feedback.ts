/**
 * TailoredTime - Feedback Service
 *
 * Handles feedback submission and device info collection.
 * Feedback is stored in the feedback table with proper categorization.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { supabase } from './supabase';
import { FeedbackData, DeviceInfo, FeedbackCategory, FeedbackTriggerPoint } from './types';
import { trackEvent } from './analytics';

/**
 * Get device information for feedback metadata
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  return {
    platform: Platform.OS,
    os_version: Platform.Version?.toString() || 'unknown',
    device_model: Device.modelName || 'unknown',
    app_version: Constants.expoConfig?.version || '1.0.0',
  };
}

/**
 * Submit feedback to the database
 */
export async function submitFeedback(data: FeedbackData): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Collect device info
    const deviceInfo = await getDeviceInfo();

    // Prepare feedback record
    const feedbackRecord = {
      user_id: user.id,
      category: data.category,
      subcategory: data.subcategory || null,
      trigger_point: data.trigger_point,
      sentiment: data.sentiment || 'neutral',
      rating: data.rating || null,
      text_feedback: data.text_feedback?.trim() || null,
      user_email: data.user_email?.trim() || null,
      wants_follow_up: data.wants_follow_up || false,
      include_logs: data.include_logs || false,
      app_version: deviceInfo.app_version,
      device_info: deviceInfo,
    };

    const { error } = await supabase.from('feedback').insert(feedbackRecord);

    if (error) {
      console.error('[Feedback] Error submitting:', error);
      return { success: false, error: error.message };
    }

    // Track analytics
    await trackEvent('feedback_submitted', {
      category: data.category,
      trigger_point: data.trigger_point,
      has_text: !!data.text_feedback,
      has_email: !!data.user_email,
    });

    console.log('[Feedback] Submitted successfully');
    return { success: true };
  } catch (err) {
    console.error('[Feedback] Error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to submit feedback',
    };
  }
}

/**
 * Submit quick feedback from review flow (simplified)
 */
export async function submitQuickFeedback(
  category: FeedbackCategory,
  textFeedback?: string,
  email?: string
): Promise<{ success: boolean; error?: string }> {
  return submitFeedback({
    category,
    trigger_point: 'review_flow',
    sentiment: 'neutral',
    text_feedback: textFeedback,
    user_email: email,
  });
}

/**
 * Submit comprehensive feedback from settings
 */
export async function submitComprehensiveFeedback(
  category: FeedbackCategory,
  description: string,
  options?: {
    email?: string;
    includeLogs?: boolean;
    wantsBetaTest?: boolean;
    subcategory?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  return submitFeedback({
    category,
    subcategory: options?.subcategory,
    trigger_point: 'settings',
    sentiment: 'neutral',
    text_feedback: description,
    user_email: options?.email,
    include_logs: options?.includeLogs,
    wants_follow_up: options?.wantsBetaTest,
  });
}

/**
 * Track that user skipped feedback
 */
export async function trackFeedbackSkipped(): Promise<void> {
  await trackEvent('feedback_skipped', {
    trigger_point: 'review_flow',
  });
}

/**
 * Category labels for display
 */
export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  missing_feature: 'Missing a feature',
  bug: "Something's broken",
  hard_to_use: 'Hard to use',
  ai_issue: 'AI scheduling issue',
  calendar_issue: 'Calendar sync problem',
  pricing: 'Pricing question',
  other: 'Something else',
};

/**
 * Quick feedback categories (shown in review flow)
 */
export const QUICK_FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  'missing_feature',
  'bug',
  'hard_to_use',
  'other',
];

/**
 * Comprehensive feedback categories (shown in settings)
 */
export const COMPREHENSIVE_FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  'bug',
  'missing_feature',
  'ai_issue',
  'calendar_issue',
  'hard_to_use',
  'pricing',
  'other',
];

/**
 * Category icons for UI
 */
export const FEEDBACK_CATEGORY_ICONS: Record<FeedbackCategory, string> = {
  missing_feature: 'puzzle-outline',
  bug: 'bug-outline',
  hard_to_use: 'help-circle-outline',
  ai_issue: 'brain',
  calendar_issue: 'calendar-alert',
  pricing: 'cash-multiple',
  other: 'comment-question-outline',
};
