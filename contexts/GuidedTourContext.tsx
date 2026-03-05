/**
 * GuidedTourContext
 *
 * Provides guided tour step state throughout the app.
 * Persists tour progress via AsyncStorage.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TourStep =
  | 'tour_welcome'
  | 'tour_add_task_start'
  | 'tour_task_title'
  | 'tour_task_duration'
  | 'tour_task_priority'
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
  | 'tour_go_calendar'
  | 'tour_calendar_intro'
  | 'tour_calendar_views'
  | 'tour_calendar_drag'
  | 'tour_go_settings'
  | 'tour_settings_intro'
  | 'tour_complete'
  | null;

const STORAGE_KEY = 'guidedTourStep';

interface GuidedTourContextValue {
  tourStep: TourStep;
  advanceTour: (next: TourStep) => Promise<void>;
  skipTour: () => Promise<void>;
}

const GuidedTourContext = createContext<GuidedTourContextValue>({
  tourStep: null,
  advanceTour: async () => {},
  skipTour: async () => {},
});

export function GuidedTourProvider({ children }: { children: ReactNode }) {
  const [tourStep, setTourStep] = useState<TourStep>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored) {
        setTourStep(stored as TourStep);
      }
    });
  }, []);

  const advanceTour = useCallback(async (next: TourStep) => {
    if (next) {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
    setTourStep(next);
  }, []);

  const skipTour = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setTourStep(null);
  }, []);

  return (
    <GuidedTourContext.Provider value={{ tourStep, advanceTour, skipTour }}>
      {children}
    </GuidedTourContext.Provider>
  );
}

export function useGuidedTour() {
  return useContext(GuidedTourContext);
}
