/**
 * New User State - Central source of truth for "new user" simulation.
 *
 * When adding a new first-time feature (guided tour, confetti, tooltip, etc.):
 *   1. Store its "has been seen" flag in AsyncStorage under a key
 *   2. Add that key to NEW_USER_STORAGE_KEYS below
 *   3. resetToNewUserState() will automatically reset it — no extra work needed
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";

// All AsyncStorage keys that track first-time / onboarding state.
// ADD NEW KEYS HERE when building new first-time features.
export const NEW_USER_STORAGE_KEYS = [
  "autoRescheduleIntroSeen",
  "autoRescheduleDeclineCount",
  "defaultTaskDuration",
  "review_requested",
  "tasks_completed_count",
  "happiness_check_shown",
  "guidedTourStep",
  "tourDemoTasksCreated",
];

// Default personality_data that triggers the onboarding route in app/index.tsx.
// Must stay in sync with the detection logic there (all numeric fields === 50).
// Note: auto_reschedule_* fields live in dedicated columns now, not here.
export const DEFAULT_PERSONALITY_DATA = {
  chronotype: 50,
  focus_duration: 50,
  deadline_style: 50,
  break_frequency: 50,
  task_switching: 50,
  structure_preference: 50,
  preferred_windows: [],
  additional_context: null,
};

/**
 * Resets the current user to brand-new-user state.
 * Auth session, tasks, theme, and Google Calendar tokens are preserved.
 */
export async function resetToNewUserState(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No authenticated user");

  // 1. Reset personality_data + dedicated columns → makes index.tsx route to onboarding
  await supabase
    .from("user_profiles")
    .update({
      personality_data: DEFAULT_PERSONALITY_DATA,
      auto_reschedule_enabled: true,
      auto_reschedule_morning: 540,
      auto_reschedule_evening: 1140,
      auto_reschedule_tz_offset: null,
    })
    .eq("id", user.id);

  // 2. Clear all static first-time keys
  await AsyncStorage.multiRemove(NEW_USER_STORAGE_KEYS);

  // 3. Clear dynamic autoRescheduleDate_* keys (keyed by schedule time)
  const allKeys = await AsyncStorage.getAllKeys();
  const dynamicKeys = allKeys.filter((k) => k.startsWith("autoRescheduleDate_"));
  if (dynamicKeys.length > 0) await AsyncStorage.multiRemove(dynamicKeys);

  // 4. Delete demo tasks so they're recreated fresh on next tour start
  await supabase
    .from("tasks")
    .delete()
    .eq("user_id", user.id)
    .contains("tags", ["demo"]);
}
