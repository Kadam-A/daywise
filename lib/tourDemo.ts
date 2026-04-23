/**
 * Tour Demo Tasks
 *
 * Creates 3 pre-scheduled MANUAL tasks so users see a realistic day during
 * the guided tour. Times are calculated relative to now so they're always
 * in the future — if it's too late in the day, tasks are placed tomorrow.
 * Tagged "demo" so they can be cleaned up on reset.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const DEMO_FLAG_KEY = 'tourDemoTasksCreated';

/**
 * Returns 9am tomorrow — always in the future, always a full day with
 * clear gaps for the manual and AI scheduling demos.
 */
function getBase(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

export async function createDemoTasks(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Check flag AND verify demo tasks actually exist in the DB.
    // AsyncStorage persists across account deletions, so we can't trust the flag alone.
    const already = await AsyncStorage.getItem(DEMO_FLAG_KEY);
    if (already) {
      const { count } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .contains('tags', ['demo']);
      if (count && count > 0) return;
      // Flag was set but tasks don't exist (e.g. after account deletion) — recreate
      await AsyncStorage.removeItem(DEMO_FLAG_KEY);
    }

    const base = getBase();

    // Task layout (minutes from base):
    // Task 1: base → base+60   (1h task)
    // 30 min gap
    // Task 2: base+90 → base+120  (30m task)
    // 90 min gap
    // Task 3: base+210 → base+240 (30m task)
    // Leaves clear gaps before, between, and after for manual + AI demos

    const tasks = [
      {
        user_id: user.id,
        title: 'Write project summary',
        duration_minutes: 60,
        scheduling_method: 'MANUAL',
        priority: 'high',
        status: 'scheduled',
        scheduled_start: base.toISOString(),
        scheduled_end: addMinutes(base, 60).toISOString(),
        due_date: null,
        tags: ['demo'],
      },
      {
        user_id: user.id,
        title: 'Respond to messages',
        duration_minutes: 30,
        scheduling_method: 'MANUAL',
        priority: 'medium',
        status: 'scheduled',
        scheduled_start: addMinutes(base, 90).toISOString(),
        scheduled_end: addMinutes(base, 120).toISOString(),
        due_date: null,
        tags: ['demo'],
      },
      {
        user_id: user.id,
        title: "Review tomorrow's plan",
        duration_minutes: 30,
        scheduling_method: 'MANUAL',
        priority: 'low',
        status: 'scheduled',
        scheduled_start: addMinutes(base, 210).toISOString(),
        scheduled_end: addMinutes(base, 240).toISOString(),
        due_date: null,
        tags: ['demo'],
      },
    ];

    const { error } = await supabase.from('tasks').insert(tasks);
    if (!error) {
      await AsyncStorage.setItem(DEMO_FLAG_KEY, 'true');
    }
  } catch (err) {
    console.warn('[TourDemo] Failed to create demo tasks:', err);
  }
}
