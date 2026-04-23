-- Migration 019: Security Fixes
--
-- Fixes the following Supabase linter errors:
--
-- ERROR auth_users_exposed:
--   user_ltv and monthly_cohorts expose auth.users to anon/authenticated via PostgREST.
--   Fix: move both views to a private schema not exposed to PostgREST.
--
-- ERROR security_definer_view:
--   user_ltv, monthly_cohorts, event_summary created with implicit SECURITY DEFINER.
--   Fix: recreate user_ltv + monthly_cohorts in private schema (no SECURITY DEFINER needed).
--   event_summary: recreate in public without SECURITY DEFINER, revoke anon access.
--
-- WARN function_search_path_mutable:
--   9 functions missing SET search_path = ''.
--   Fix: recreate all with SET search_path = '' and fully-qualified table names.
--
-- NOTE auth_leaked_password_protection:
--   Cannot be fixed via migration. Enable in:
--   Supabase Dashboard → Authentication → Providers → Email → "Prevent use of leaked passwords"

-- ============================================================
-- PART 1: Create private schema for admin-only views
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;

-- Revoke default public access on private schema
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO service_role;

-- ============================================================
-- PART 2: Drop public admin views and recreate in private schema
-- ============================================================

DROP VIEW IF EXISTS public.user_ltv;
DROP VIEW IF EXISTS public.monthly_cohorts;
DROP VIEW IF EXISTS private.user_ltv;
DROP VIEW IF EXISTS private.monthly_cohorts;

-- user_ltv: admin LTV dashboard (references auth.users — must live in private)
CREATE VIEW private.user_ltv AS
SELECT
  u.id AS user_id,
  u.email,
  up.created_at AS signup_date,
  COALESCE(s.plan_id, 'free') AS plan,
  s.status AS subscription_status,
  s.current_period_start,
  s.current_period_end,
  CASE
    WHEN s.plan_id = 'pro_monthly' THEN 6.99
    WHEN s.plan_id = 'pro_yearly' THEN 59.99
    ELSE 0
  END AS mrr_dollars,
  EXTRACT(DAY FROM NOW() - up.created_at) AS lifetime_days,
  (SELECT COUNT(*) FROM public.tasks WHERE user_id = u.id) AS total_tasks,
  (SELECT COUNT(*) FROM public.tasks WHERE user_id = u.id AND status = 'completed') AS completed_tasks,
  (SELECT COUNT(*) FROM public.tasks WHERE user_id = u.id AND scheduling_method = 'SMART') AS smart_scheduled_tasks,
  f.onboarding_completed_at IS NOT NULL AS completed_onboarding,
  f.first_task_at IS NOT NULL AS created_first_task,
  f.first_schedule_at IS NOT NULL AS scheduled_first_task,
  f.first_completion_at IS NOT NULL AS completed_first_task,
  f.converted_to_paid_at IS NOT NULL AS is_paying,
  f.day_7_active,
  f.day_30_active
FROM auth.users u
LEFT JOIN public.user_profiles up ON up.id = u.id
LEFT JOIN public.user_subscriptions s ON s.user_id = u.id
LEFT JOIN public.user_funnel f ON f.user_id = u.id;

GRANT SELECT ON private.user_ltv TO service_role;

-- monthly_cohorts: cohort analysis (references auth.users — must live in private)
CREATE VIEW private.monthly_cohorts AS
SELECT
  DATE_TRUNC('month', up.created_at) AS cohort_month,
  COUNT(DISTINCT u.id) AS total_users,
  COUNT(DISTINCT CASE WHEN f.first_task_at IS NOT NULL THEN u.id END) AS created_task,
  COUNT(DISTINCT CASE WHEN f.first_completion_at IS NOT NULL THEN u.id END) AS completed_task,
  COUNT(DISTINCT CASE WHEN s.plan_id != 'free' THEN u.id END) AS paid_users,
  COUNT(DISTINCT CASE WHEN f.day_7_active THEN u.id END) AS retained_day_7,
  COUNT(DISTINCT CASE WHEN f.day_30_active THEN u.id END) AS retained_day_30,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN s.plan_id != 'free' THEN u.id END)
    / NULLIF(COUNT(DISTINCT u.id), 0),
    2
  ) AS conversion_rate
FROM auth.users u
LEFT JOIN public.user_profiles up ON up.id = u.id
LEFT JOIN public.user_subscriptions s ON s.user_id = u.id
LEFT JOIN public.user_funnel f ON f.user_id = u.id
WHERE up.created_at IS NOT NULL
GROUP BY DATE_TRUNC('month', up.created_at)
ORDER BY cohort_month DESC;

GRANT SELECT ON private.monthly_cohorts TO service_role;

-- ============================================================
-- PART 3: Fix event_summary — recreate without SECURITY DEFINER,
-- revoke anon access (admin-only view)
-- ============================================================

DROP VIEW IF EXISTS public.event_summary;

CREATE OR REPLACE VIEW public.event_summary AS
SELECT
  event_name,
  COUNT(*) AS total_count,
  COUNT(DISTINCT user_id) AS unique_users,
  DATE_TRUNC('day', created_at) AS event_date
FROM public.analytics_events
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY event_name, DATE_TRUNC('day', created_at)
ORDER BY event_date DESC, total_count DESC;

-- Revoke from anon and authenticated — only service_role should access this
REVOKE SELECT ON public.event_summary FROM anon, authenticated;
GRANT SELECT ON public.event_summary TO service_role;

-- ============================================================
-- PART 4: Fix function_search_path_mutable
-- Recreate all flagged functions with SET search_path = ''
-- and fully-qualified table/schema references
-- ============================================================

-- 4a. update_funnel_timestamp (trigger, no table refs)
CREATE OR REPLACE FUNCTION public.update_funnel_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 4b. create_user_funnel (trigger, inserts into public.user_funnel)
CREATE OR REPLACE FUNCTION public.create_user_funnel()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_funnel (user_id, installed_at)
  VALUES (NEW.id, NOW())
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- 4c. calculate_streak
CREATE OR REPLACE FUNCTION public.calculate_streak(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS INTEGER AS $$
DECLARE
  streak INTEGER := 0;
  check_date DATE := (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE;
  has_completion BOOLEAN;
BEGIN
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM public.tasks
      WHERE user_id = p_user_id
      AND status = 'completed'
      AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) = check_date
    ) INTO has_completion;

    IF has_completion THEN
      streak := streak + 1;
      check_date := check_date - 1;
    ELSE
      IF streak = 0 AND check_date = (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE THEN
        check_date := check_date - 1;
        CONTINUE;
      END IF;
      EXIT;
    END IF;

    IF streak > 365 THEN EXIT; END IF;
  END LOOP;

  RETURN streak;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = '';

GRANT EXECUTE ON FUNCTION public.calculate_streak(UUID, TEXT) TO authenticated;

-- 4d. calculate_best_streak
CREATE OR REPLACE FUNCTION public.calculate_best_streak(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS INTEGER AS $$
DECLARE
  best_streak INTEGER := 0;
  current_run INTEGER := 0;
  prev_date DATE := NULL;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) AS completion_date
    FROM public.tasks
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
$$ LANGUAGE plpgsql STABLE SET search_path = '';

GRANT EXECUTE ON FUNCTION public.calculate_best_streak(UUID, TEXT) TO authenticated;

-- 4e. get_user_stats
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
    'tasks_total_week', (
      SELECT COUNT(*) FROM public.tasks
      WHERE user_id = p_user_id
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - 6
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
    'completion_rate', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completed') / COUNT(*), 1)
      END
      FROM public.tasks
      WHERE user_id = p_user_id
      AND created_at >= (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE - INTERVAL '30 days'
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.get_user_stats(UUID, TEXT) TO authenticated;

-- 4f. get_productivity_by_hour
CREATE OR REPLACE FUNCTION public.get_productivity_by_hour(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object('hour', hour, 'count', count)
    ORDER BY hour
  )
  FROM (
    SELECT
      EXTRACT(HOUR FROM updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone)::INTEGER AS hour,
      COUNT(*) AS count
    FROM public.tasks
    WHERE user_id = p_user_id
    AND status = 'completed'
    AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY EXTRACT(HOUR FROM updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone)
  ) hourly
  INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.get_productivity_by_hour(UUID, TEXT) TO authenticated;

-- 4g. get_productivity_by_weekday
CREATE OR REPLACE FUNCTION public.get_productivity_by_weekday(p_user_id UUID, p_timezone TEXT DEFAULT 'UTC')
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_agg(
    json_build_object('day', day, 'day_name', day_name, 'count', count)
    ORDER BY day
  )
  FROM (
    SELECT
      EXTRACT(DOW FROM updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone)::INTEGER AS day,
      TO_CHAR(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone, 'Dy') AS day_name,
      COUNT(*) AS count
    FROM public.tasks
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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.get_productivity_by_weekday(UUID, TEXT) TO authenticated;

-- 4h. get_daily_completions
CREATE OR REPLACE FUNCTION public.get_daily_completions(
  p_user_id UUID,
  p_days INTEGER DEFAULT 7,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS JSON AS $$
DECLARE
  result JSON;
  local_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE p_timezone)::DATE;
BEGIN
  SELECT json_agg(
    json_build_object('date', completion_date, 'count', count)
    ORDER BY completion_date
  )
  FROM (
    SELECT
      DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) AS completion_date,
      COUNT(*) AS count
    FROM public.tasks
    WHERE user_id = p_user_id
    AND status = 'completed'
    AND DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone) >= local_today - (p_days - 1)
    GROUP BY DATE(updated_at AT TIME ZONE 'UTC' AT TIME ZONE p_timezone)
  ) daily
  INTO result;

  RETURN COALESCE(result, '[]'::JSON);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.get_daily_completions(UUID, INTEGER, TEXT) TO authenticated;

-- 4i. get_revenue_stats — update to reference private.user_ltv
CREATE OR REPLACE FUNCTION public.get_revenue_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized: super_admin role required';
  END IF;

  SELECT json_build_object(
    'mrr_cents', (
      SELECT COALESCE(SUM(
        CASE
          WHEN plan_id = 'pro_monthly' THEN 699
          WHEN plan_id = 'pro_yearly' THEN 500
          ELSE 0
        END
      ), 0)
      FROM public.user_subscriptions
      WHERE status = 'active' AND plan_id IN ('pro_monthly', 'pro_yearly')
    ),
    'active_subscribers', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'active' AND plan_id IN ('pro_monthly', 'pro_yearly')
    ),
    'monthly_subscribers', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'active' AND plan_id = 'pro_monthly'
    ),
    'yearly_subscribers', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'active' AND plan_id = 'pro_yearly'
    ),
    'total_users', (SELECT COUNT(*) FROM public.user_profiles),
    'paid_users', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'active' AND plan_id IN ('pro_monthly', 'pro_yearly')
    ),
    'active_trials', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'trial' AND trial_ends_at > NOW()
    ),
    'expired_trials', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'trial' AND trial_ends_at <= NOW()
    ),
    'churned_users', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status IN ('expired', 'cancelled')
    ),
    'avg_ltv_cents', (
      SELECT COALESCE(ROUND(AVG(mrr_dollars * lifetime_days / 30.0) * 100), 0)
      FROM private.user_ltv
      WHERE mrr_dollars > 0
    ),
    'revenue_this_month_cents', (
      SELECT COALESCE(SUM(
        CASE
          WHEN plan_id = 'pro_monthly' THEN 699
          WHEN plan_id = 'pro_yearly' THEN 500
          ELSE 0
        END
      ), 0)
      FROM public.user_subscriptions
      WHERE status = 'active'
        AND plan_id IN ('pro_monthly', 'pro_yearly')
        AND current_period_start <= NOW()
        AND (current_period_end IS NULL OR current_period_end >= NOW())
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.get_revenue_stats() TO authenticated;
