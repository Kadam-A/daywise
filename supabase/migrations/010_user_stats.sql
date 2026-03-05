/**
 * TailoredTime - User Stats Functions
 *
 * Provides efficient functions for calculating user analytics
 * including task completion stats and streak tracking.
 */

-- Streak calculation helper function
-- Calculates consecutive days with at least one completed task
CREATE OR REPLACE FUNCTION calculate_streak(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  streak INTEGER := 0;
  check_date DATE := CURRENT_DATE;
  has_completion BOOLEAN;
BEGIN
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND DATE(updated_at) = check_date
    ) INTO has_completion;

    IF has_completion THEN
      streak := streak + 1;
      check_date := check_date - 1;
    ELSE
      -- If no completion today but streak > 0, check if yesterday had completions
      -- This allows streak to continue if user hasn't completed anything today yet
      IF streak = 0 AND check_date = CURRENT_DATE THEN
        check_date := check_date - 1;
        CONTINUE;
      END IF;
      EXIT;
    END IF;

    -- Safety limit to prevent infinite loops
    IF streak > 365 THEN EXIT; END IF;
  END LOOP;

  RETURN streak;
END;
$$ LANGUAGE plpgsql STABLE;

-- Main user stats function
-- Returns comprehensive stats as JSON for efficient single-query fetch
CREATE OR REPLACE FUNCTION get_user_stats(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    -- Daily stats
    'tasks_completed_today', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND DATE(updated_at) = CURRENT_DATE
    ),

    -- Weekly stats
    'tasks_completed_week', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND updated_at >= CURRENT_DATE - INTERVAL '7 days'
    ),

    -- Monthly stats
    'tasks_completed_month', (
      SELECT COUNT(*) FROM tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
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

    -- Streak
    'current_streak', (
      SELECT COALESCE(calculate_streak(p_user_id), 0)
    ),

    -- Completion rate (avoid division by zero)
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
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Pro-only: Productivity by hour of day
-- Returns task completions grouped by hour (0-23)
CREATE OR REPLACE FUNCTION get_productivity_by_hour(p_user_id UUID)
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
      EXTRACT(HOUR FROM updated_at)::INTEGER as hour,
      COUNT(*) as count
    FROM tasks
    WHERE user_id = p_user_id
    AND status = 'completed'
    AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY EXTRACT(HOUR FROM updated_at)
  ) hourly
  INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Pro-only: Productivity by day of week
-- Returns task completions grouped by weekday (0=Sunday, 6=Saturday)
CREATE OR REPLACE FUNCTION get_productivity_by_weekday(p_user_id UUID)
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
      EXTRACT(DOW FROM updated_at)::INTEGER as day,
      TO_CHAR(updated_at, 'Dy') as day_name,
      COUNT(*) as count
    FROM tasks
    WHERE user_id = p_user_id
    AND status = 'completed'
    AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY EXTRACT(DOW FROM updated_at), TO_CHAR(updated_at, 'Dy')
  ) daily
  INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_streak(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_productivity_by_hour(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_productivity_by_weekday(UUID) TO authenticated;
