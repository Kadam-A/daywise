/**
 * TailoredTime - User Stats Service
 *
 * Functions for fetching user analytics and productivity stats.
 * Uses database functions for efficient computation.
 * All functions pass the user's timezone for correct local-time analytics.
 */

import { supabase } from './supabase';
import { UserStats, HourlyProductivity, WeekdayProductivity, DailyCompletion } from './types';

/**
 * Get user's IANA timezone string (e.g. "America/New_York")
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Fetch basic user stats (available to all users)
 * Uses the get_user_stats() database function for efficiency
 */
export async function getUserStats(): Promise<UserStats | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[UserStats] No user found');
      return null;
    }

    const { data, error } = await supabase.rpc('get_user_stats', {
      p_user_id: user.id,
      p_timezone: getUserTimezone(),
    });

    if (error) {
      console.error('[UserStats] Error fetching stats:', error);
      return null;
    }

    return data as UserStats;
  } catch (err) {
    console.error('[UserStats] Error:', err);
    return null;
  }
}

/**
 * Fetch productivity by hour of day (Pro only)
 * Returns task completions grouped by hour (0-23) for last 30 days
 */
export async function getProductivityByHour(): Promise<HourlyProductivity[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[UserStats] No user found');
      return [];
    }

    const { data, error } = await supabase.rpc('get_productivity_by_hour', {
      p_user_id: user.id,
      p_timezone: getUserTimezone(),
    });

    if (error) {
      console.error('[UserStats] Error fetching hourly productivity:', error);
      return [];
    }

    // Fill in missing hours with 0 count
    const hourlyData: HourlyProductivity[] = [];
    const dataMap = new Map((data || []).map((d: HourlyProductivity) => [d.hour, d.count]));

    for (let hour = 0; hour < 24; hour++) {
      hourlyData.push({
        hour,
        count: dataMap.get(hour) || 0,
      });
    }

    return hourlyData;
  } catch (err) {
    console.error('[UserStats] Error:', err);
    return [];
  }
}

/**
 * Fetch productivity by day of week (Pro only)
 * Returns task completions grouped by weekday for last 30 days
 */
export async function getProductivityByWeekday(): Promise<WeekdayProductivity[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[UserStats] No user found');
      return [];
    }

    const { data, error } = await supabase.rpc('get_productivity_by_weekday', {
      p_user_id: user.id,
      p_timezone: getUserTimezone(),
    });

    if (error) {
      console.error('[UserStats] Error fetching weekday productivity:', error);
      return [];
    }

    // Fill in missing days with 0 count
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekdayData: WeekdayProductivity[] = [];
    const dataMap = new Map((data || []).map((d: WeekdayProductivity) => [d.day, d]));

    for (let day = 0; day < 7; day++) {
      const existing = dataMap.get(day);
      weekdayData.push({
        day,
        day_name: existing?.day_name || dayNames[day],
        count: existing?.count || 0,
      });
    }

    return weekdayData;
  } catch (err) {
    console.error('[UserStats] Error:', err);
    return [];
  }
}

/**
 * Fetch daily completion counts for trend chart (Pro only)
 * Returns data for last N days
 */
export async function getDailyCompletions(days: number = 7): Promise<DailyCompletion[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log('[UserStats] No user found');
      return [];
    }

    const tz = getUserTimezone();
    const { data, error } = await supabase.rpc('get_daily_completions', {
      p_user_id: user.id,
      p_days: days,
      p_timezone: tz,
    });

    if (error) {
      console.error('[UserStats] Error fetching daily completions:', error);
      return [];
    }

    // Fill in missing dates with 0 count
    const dataMap = new Map((data || []).map((d: DailyCompletion) => [d.date, d.count]));
    const result: DailyCompletion[] = [];
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      result.push({
        date: dateStr,
        count: dataMap.get(dateStr) || 0,
      });
    }

    return result;
  } catch (err) {
    console.error('[UserStats] Error:', err);
    return [];
  }
}

/**
 * Get the most productive hour (Pro insight)
 */
export function getMostProductiveHour(hourlyData: HourlyProductivity[]): {
  hour: number;
  count: number;
  formatted: string;
} | null {
  if (!hourlyData.length) return null;

  const maxHour = hourlyData.reduce((max, h) =>
    h.count > max.count ? h : max
  );

  if (maxHour.count === 0) return null;

  return {
    hour: maxHour.hour,
    count: maxHour.count,
    formatted: formatHour(maxHour.hour),
  };
}

/**
 * Get the most productive day (Pro insight)
 */
export function getMostProductiveDay(weekdayData: WeekdayProductivity[]): {
  day: number;
  day_name: string;
  count: number;
} | null {
  if (!weekdayData.length) return null;

  const maxDay = weekdayData.reduce((max, d) =>
    d.count > max.count ? d : max
  );

  if (maxDay.count === 0) return null;

  return maxDay;
}

/**
 * Get SMART vs MANUAL scheduling ratio
 */
export function getSchedulingRatio(stats: UserStats): {
  smartPercent: number;
  manualPercent: number;
  totalScheduled: number;
} {
  const total = stats.smart_scheduled_count + stats.manual_scheduled_count;
  if (total === 0) {
    return { smartPercent: 0, manualPercent: 0, totalScheduled: 0 };
  }

  return {
    smartPercent: Math.round((stats.smart_scheduled_count / total) * 100),
    manualPercent: Math.round((stats.manual_scheduled_count / total) * 100),
    totalScheduled: total,
  };
}

/**
 * Format hour for display (e.g., "10 AM", "2 PM")
 */
function formatHour(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * Generate productivity insight text (Pro only)
 */
export function generateProductivityInsight(
  hourlyData: HourlyProductivity[],
  weekdayData: WeekdayProductivity[],
  stats: UserStats
): string[] {
  const insights: string[] = [];

  // Most productive hour
  const bestHour = getMostProductiveHour(hourlyData);
  if (bestHour && bestHour.count >= 3) {
    insights.push(`You're most productive around ${bestHour.formatted}`);
  }

  // Most productive day
  const bestDay = getMostProductiveDay(weekdayData);
  if (bestDay && bestDay.count >= 3) {
    insights.push(`${bestDay.day_name}s are your strongest day`);
  }

  // Completion rate insight
  if (stats.completion_rate >= 80) {
    insights.push("Great job! You're completing most of your tasks");
  } else if (stats.completion_rate >= 50) {
    insights.push('Consider breaking large tasks into smaller ones');
  } else if (stats.completion_rate > 0) {
    insights.push('Try scheduling fewer tasks to build momentum');
  }

  // Scheduling method insight
  const { smartPercent } = getSchedulingRatio(stats);
  if (smartPercent > 70) {
    insights.push('AI scheduling is helping optimize your day');
  } else if (smartPercent > 0 && smartPercent < 30) {
    insights.push('Try SMART scheduling for better time optimization');
  }

  // Streak insight
  if (stats.current_streak >= 7) {
    insights.push(`Amazing ${stats.current_streak}-day streak! Keep it up`);
  } else if (stats.current_streak >= 3) {
    insights.push(`${stats.current_streak}-day streak going strong`);
  }

  return insights.slice(0, 3); // Return max 3 insights
}
