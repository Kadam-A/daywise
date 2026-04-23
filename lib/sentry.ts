/**
 * Sentry — crash reporting & error monitoring
 *
 * Usage:
 *   import { Sentry, setSentryUser, clearSentryUser } from '@/lib/sentry';
 *   Sentry.captureException(err);
 */

import * as Sentry from '@sentry/react-native';

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry] No DSN configured — skipping init');
    return;
  }

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    debug: false,
    // Capture 20% of transactions for performance monitoring
    tracesSampleRate: __DEV__ ? 0 : 0.2,
    // Include IP, user context etc.
    sendDefaultPii: true,
    // Session Replay: record 10% of sessions, 100% of sessions with errors
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    integrations: [
      Sentry.mobileReplayIntegration(),
    ],
  });
}

export function setSentryUser(id: string, email?: string): void {
  Sentry.setUser({ id, email });
}

export function clearSentryUser(): void {
  Sentry.setUser(null);
}

// Re-export for one-stop-shop usage in the app
export { Sentry };
