/**
 * PostHog — product analytics
 *
 * Singleton client used throughout the app.
 * Events are captured here AND in Supabase (via lib/analytics.ts) in parallel.
 *
 * Configuration is loaded from app.config.js extras via expo-constants,
 * which reads EXPO_PUBLIC_POSTHOG_API_KEY / EXPO_PUBLIC_POSTHOG_HOST at build time.
 *
 * Usage:
 *   import { capture, identifyUser, resetUser } from '@/lib/posthog';
 *   capture('task_created', { method: 'SMART' });
 */

import PostHog from 'posthog-react-native';
import type { PostHogEventProperties } from '@posthog/core';
import Constants from 'expo-constants';

// Configuration loaded from app.config.js extras via expo-constants
// Environment variables are read at build time in app.config.js
const apiKey = Constants.expoConfig?.extra?.posthogApiKey as string | undefined;
const host = (Constants.expoConfig?.extra?.posthogHost as string) || 'https://us.i.posthog.com';
const isPostHogConfigured = !!apiKey && apiKey !== 'phc_your_key_here';

if (__DEV__) {
  console.log('[PostHog] config:', {
    apiKey: apiKey ? 'SET' : 'NOT SET',
    host,
    isConfigured: isPostHogConfigured,
  });
}

if (!isPostHogConfigured) {
  console.warn(
    '[PostHog] API key not configured. Analytics will be disabled. ' +
      'Set EXPO_PUBLIC_POSTHOG_API_KEY in your .env file to enable analytics.'
  );
}

/**
 * PostHog client instance for Expo.
 *
 * Required peer dependencies: expo-file-system, expo-application,
 * expo-device, expo-localization
 *
 * @see https://posthog.com/docs/libraries/react-native
 */
export const posthog = new PostHog(apiKey || 'placeholder_key', {
  host,

  // Disable PostHog when API key is not configured
  disabled: !isPostHogConfigured,

  // Capture app lifecycle events (Installed, Updated, Opened, Backgrounded)
  captureAppLifecycleEvents: true,

  // Batching: queue events and flush periodically to optimise battery usage
  flushAt: 20,
  flushInterval: 10000,
  maxBatchSize: 100,
  maxQueueSize: 1000,

  // Feature flags
  preloadFeatureFlags: true,
  sendFeatureFlagEvent: true,
  featureFlagsRequestTimeoutMs: 10000,

  // Network settings
  requestTimeout: 10000,
  fetchRetryCount: 3,
  fetchRetryDelay: 3000,
});

/** Called from app/_layout.tsx — kept for backwards compatibility */
export function initPostHog(): void {
  // No-op: posthog client is initialised above as a module-level singleton.
  // initPostHog() is retained so existing callers don't break.
}

/** Identify a signed-in user so events are attributed correctly */
export function identifyUser(id: string, email?: string, extraProps?: PostHogEventProperties): void {
  const setProps: PostHogEventProperties = { ...(email ? { email } : {}), ...extraProps };
  posthog.identify(id, {
    $set: setProps,
    $set_once: { first_seen_at: new Date().toISOString() },
  });
}

/** Call on sign-out — resets distinct_id to anonymous */
export function resetUser(): void {
  posthog.reset();
}

/** Track an event with optional properties */
export function capture(event: string, properties?: PostHogEventProperties): void {
  posthog.capture(event, properties);
}

/** Returns the PostHog client (e.g. for feature flags) */
export function getPostHogClient(): PostHog {
  return posthog;
}
