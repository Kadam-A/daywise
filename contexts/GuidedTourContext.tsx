/**
 * GuidedTourContext
 *
 * Provides guided tour step state throughout the app.
 * Persists tour progress via AsyncStorage.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trackTourStepViewed, trackTourSkipped, trackTourCompleted } from '@/lib/analytics';

export type TourStep =
  | 'tour_welcome'
  | 'tour_demo_tasks'
  | 'tour_priority_hint'
  | 'tour_scheduling_intro'
  | 'tour_add_task_start'
  | 'tour_task_title'
  | 'tour_task_due'
  | 'tour_task_tag'
  | 'tour_task_create_ai'
  | 'tour_scheduling_ai'
  | 'tour_ai_reward'
  | 'tour_complete_task'
  | 'tour_states'
  | 'tour_add_manual'
  | 'tour_manual_schedule'
  | 'tour_manual_done'
  | 'tour_add_ai'
  | 'tour_calendar_intro'
  | 'tour_calendar_views'
  | 'tour_calendar_drag'
  | 'tour_settings_intro'
  | 'tour_complete'
  | null;

// Migrate removed steps to their logical successors
const STEP_MIGRATIONS: Record<string, TourStep> = {
  tour_task_duration: 'tour_task_due',
  tour_task_priority: 'tour_task_due',
  tour_go_calendar: 'tour_calendar_views',
  tour_calendar_intro: 'tour_calendar_views',
  tour_go_settings: 'tour_settings_intro',
  tour_add_manual: 'tour_add_ai',
};

const STORAGE_KEY = 'guidedTourStep';

interface GuidedTourContextValue {
  tourStep: TourStep;
  isManualTour: boolean;
  setIsManualTour: (val: boolean) => void;
  advanceTour: (next: TourStep) => Promise<void>;
  skipTour: (fromStep?: TourStep) => Promise<void>;
}

const GuidedTourContext = createContext<GuidedTourContextValue>({
  tourStep: null,
  isManualTour: false,
  setIsManualTour: () => {},
  advanceTour: async () => {},
  skipTour: async () => {},
});

export function GuidedTourProvider({ children }: { children: ReactNode }) {
  const [tourStep, setTourStep] = useState<TourStep>(null);
  const [isManualTour, setIsManualTour] = useState(false);
  const tourSessionId = useRef<string | null>(null);
  const stepStartTime = useRef<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored) {
        const migrated = STEP_MIGRATIONS[stored] ?? stored as TourStep;
        if (migrated !== stored) AsyncStorage.setItem(STORAGE_KEY, migrated as string);
        setTourStep(migrated);
      }
    });
  }, []);

  const advanceTour = useCallback(async (next: TourStep) => {
    console.log("[GuidedTour] advanceTour:", next);

    // Generate session ID on first tour step
    if (!tourSessionId.current) {
      tourSessionId.current = `tour_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    const now = Date.now();
    const stepDurationMs = stepStartTime.current ? now - stepStartTime.current : undefined;
    stepStartTime.current = now;

    if (next) {
      await AsyncStorage.setItem(STORAGE_KEY, next);
      trackTourStepViewed(next, tourSessionId.current, stepDurationMs).catch(() => {});
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
      trackTourCompleted(tourSessionId.current ?? undefined, isManualTour).catch(() => {});
      tourSessionId.current = null;
      stepStartTime.current = null;
    }
    setTourStep(next);
  }, [isManualTour]);

  const skipTour = useCallback(async (fromStep?: TourStep) => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    if (fromStep) trackTourSkipped(fromStep, tourSessionId.current ?? undefined).catch(() => {});
    tourSessionId.current = null;
    stepStartTime.current = null;
    setTourStep(null);
  }, []);

  return (
    <GuidedTourContext.Provider value={{ tourStep, isManualTour, setIsManualTour, advanceTour, skipTour }}>
      {children}
    </GuidedTourContext.Provider>
  );
}

export function useGuidedTour() {
  return useContext(GuidedTourContext);
}
