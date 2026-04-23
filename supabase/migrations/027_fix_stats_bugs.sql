-- Fix stats calculation bugs
--
-- Bug 1: tasks_total_week only counted tasks CREATED this week.
--        Tasks created in prior weeks but completed this week caused
--        "completed > total" (e.g. "6 of 1"). Now counts tasks created
--        OR completed this week.
--
-- Bug 2: completion_rate compared TIMESTAMPTZ created_at to a DATE literal
--        cast to midnight UTC, which is up to 14 hours off for non-UTC users.
--        Fixed to use a proper TIMESTAMPTZ boundary in the user's timezone.

CREATE OR REPLACE FUNCTION public.get_user_stats(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS JSON AS $$
DECLARE
  result JSON;
  local_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE;
BEGIN
  SELECT json_build_object(
    'tasks_completed_today', (
      SELECT COUNT(*) FROM public.tasks
      WHERE user_id = p_user_id AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) = local_today
    ),
    'tasks_completed_yesterday', (
      SELECT COUNT(*) FROM public.tasks
      WHERE user_id = p_user_id AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) = local_today - 1
    ),
    'tasks_completed_week', (
      SELECT COUNT(*) FROM public.tasks
      WHERE user_id = p_user_id AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 6
    ),
    -- FIX 1: count tasks created OR completed this week so completed never exceeds total
    'tasks_total_week', (
      SELECT COUNT(*) FROM public.tasks
      WHERE user_id = p_user_id
      AND (
        DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 6
        OR (
          status = 'completed'
          AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 6
        )
      )
    ),
    'tasks_completed_month', (
      SELECT COUNT(*) FROM public.tasks
      WHERE user_id = p_user_id AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 29
    ),
    'tasks_completed_last_month', (
      SELECT COUNT(*) FROM public.tasks
      WHERE user_id = p_user_id AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 59
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) < local_today - 29
    ),
    'total_tasks', (
      SELECT COUNT(*) FROM public.tasks WHERE user_id = p_user_id
    ),
    'total_completed', (
      SELECT COUNT(*) FROM public.tasks WHERE user_id = p_user_id AND status = 'completed'
    ),
    'smart_scheduled_count', (
      SELECT COUNT(*) FROM public.tasks WHERE user_id = p_user_id AND scheduling_method = 'SMART'
    ),
    'manual_scheduled_count', (
      SELECT COUNT(*) FROM public.tasks WHERE user_id = p_user_id AND scheduling_method = 'MANUAL'
    ),
    'current_streak', (
      SELECT COALESCE(public.calculate_streak(p_user_id, p_timezone), 0)
    ),
    'best_streak', (
      SELECT COALESCE(public.calculate_best_streak(p_user_id, p_timezone), 0)
    ),
    -- FIX 2: use timezone-aware TIMESTAMPTZ boundary instead of DATE cast to UTC midnight
    'completion_rate', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / COUNT(*), 1)
      END
      FROM public.tasks
      WHERE user_id = p_user_id
      AND created_at >= (
        (local_today - 29)::TIMESTAMP AT TIME ZONE p_timezone
      )
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.get_user_stats(UUID, TEXT) TO authenticated;
