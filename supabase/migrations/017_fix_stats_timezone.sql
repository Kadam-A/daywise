/**
 * Migration 017: Fix Stats Timezone Bugs + Add Daily Completions
 *
 * Fixes:
 * 1. Hourly/weekday charts use UTC instead of user's timezone
 * 2. Completion rate is all-time (never improves) - changed to last 30 days
 * 3. Streak calculation needs timezone awareness
 *
 * New:
 * - get_daily_completions() for completion trend chart (Pro)
 * - All functions accept p_timezone TEXT DEFAULT 'UTC'
 * - UserStats now includes tasks_completed_yesterday, best_streak, tasks_completed_last_month
 */

-- ============================================
-- Fix 1: Timezone-aware streak calculation
-- ============================================
CREATE OR REPLACE FUNCTION calculate_streak(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS INTEGER AS $$
DECLARE
  streak INTEGER := 0;
  check_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE;
  has_completion BOOLEAN;
BEGIN
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) = check_date
    ) INTO has_completion;

    IF has_completion THEN
      streak := streak + 1;
      check_date := check_date - 1;
    ELSE
      -- If no completion today but streak > 0, check if yesterday had completions
      -- This allows streak to continue if user hasn't completed anything today yet
      IF streak = 0 AND check_date = (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE THEN
        check_date := check_date - 1;
        CONTINUE;
      END IF;
      EXIT;
    END IF;

    -- Safety limit
    IF streak > 365 THEN EXIT; END IF;
  END LOOP;

  RETURN streak;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- Fix 2: Best streak calculation (all-time max)
-- ============================================
CREATE OR REPLACE FUNCTION calculate_best_streak(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS INTEGER AS $$
DECLARE
  best_streak INTEGER := 0;
  current_run INTEGER := 0;
  prev_date DATE := NULL;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) as completion_date
    FROM tasks
    WHERE user_id = p_user_id AND status = 'completed'
    ORDER BY completion_date
  LOOP
    IF prev_date IS NULL OR rec.completion_date = prev_date + 1 THEN
      current_run := current_run + 1;
    ELSE
      current_run := 1;
    END IF;

    IF current_run > best_streak THEN
      best_streak := current_run;
    END IF;

    prev_date := rec.completion_date;
  END LOOP;

  RETURN best_streak;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- Fix 3: Timezone-aware get_user_stats with new fields
-- Completion rate now uses last 30 days only
-- ============================================
CREATE OR REPLACE FUNCTION get_user_stats(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS JSON AS $$
DECLARE
  result JSON;
  local_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE;
BEGIN
  SELECT json_build_object(
    -- Daily stats (timezone-aware)
    'tasks_completed_today', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) = local_today
    ),

    -- Yesterday (for trend comparison)
    'tasks_completed_yesterday', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) = local_today - 1
    ),

    -- Weekly stats (timezone-aware)
    'tasks_completed_week', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 6
    ),

    -- Weekly total tasks (for progress bar)
    'tasks_total_week', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 6
    ),

    -- Monthly stats (timezone-aware)
    'tasks_completed_month', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 29
    ),

    -- Last month (for trend comparison)
    'tasks_completed_last_month', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 59
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) < local_today - 29
    ),

    -- All-time stats
    'total_tasks', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
    ),
    'total_completed', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
    ),

    -- Scheduling method breakdown
    'smart_scheduled_count', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND scheduling_method = 'SMART'
    ),
    'manual_scheduled_count', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND scheduling_method = 'MANUAL'
    ),

    -- Streak (timezone-aware)
    'current_streak', (
      SELECT COALESCE(calculate_streak(p_user_id, p_timezone), 0)
    ),

    -- Best streak (all-time)
    'best_streak', (
      SELECT COALESCE(calculate_best_streak(p_user_id, p_timezone), 0)
    ),

    -- Completion rate - FIXED: last 30 days only (not all-time)
    'completion_rate', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'completed') / COUNT(*),
          1
        )
      END
      FROM tasks
      WHERE user_id = p_user_id
      AND created_at >= (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE - INTERVAL '30 days'
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================
-- Fix 4: Timezone-aware productivity by hour
-- ============================================
CREATE OR REPLACE FUNCTION get_productivity_by_hour(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'hour', hour,
      'count', count
    ) ORDER BY hour
  )
  FROM (
    SELECT
      EXTRACT(HOUR FROM updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone)::INTEGER as hour,
      COUNT(*) as count
    FROM tasks
    WHERE user_id = p_user_id
    AND status = 'completed'
    AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY EXTRACT(HOUR FROM updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone)
  ) hourly
  INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================
-- Fix 5: Timezone-aware productivity by weekday
-- ============================================
CREATE OR REPLACE FUNCTION get_productivity_by_weekday(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object(
      'day', day,
      'day_name', day_name,
      'count', count
    ) ORDER BY day
  )
  FROM (
    SELECT
      EXTRACT(DOW FROM updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone)::INTEGER as day,
      TO_CHAR(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone, 'Dy') as day_name,
      COUNT(*) as count
    FROM tasks
    WHERE user_id = p_user_id
    AND status = 'completed'
    AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY
      EXTRACT(DOW FROM updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone),
      TO_CHAR(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone, 'Dy')
  ) daily
  INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================
-- New: Daily completions for trend chart (Pro)
-- ============================================
CREATE OR REPLACE FUNCTION get_daily_completions(p_user_id UUID, p_days INTEGER DEFAULT 7, p_timezone TEXT DEFAULT 'UTC')
RETURNS JSON AS $$
DECLARE
  result JSON;
  local_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE;
BEGIN
  SELECT json_agg(
    json_build_object(
      'date', completion_date,
      'count', count
    ) ORDER BY completion_date
  )
  FROM (
    SELECT
      DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) as completion_date,
      COUNT(*) as count
    FROM tasks
    WHERE user_id = p_user_id
    AND status = 'completed'
    AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - (p_days - 1)
    GROUP BY DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone)
  ) daily
  INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================
-- Grant permissions
-- ============================================
GRANT EXECUTE ON FUNCTION calculate_streak(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_best_streak(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_stats(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_productivity_by_hour(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_productivity_by_weekday(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_daily_completions(UUID, INTEGER, TEXT) TO authenticated;
