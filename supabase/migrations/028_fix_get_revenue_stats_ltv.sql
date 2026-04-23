-- ============================================================
-- Fix get_revenue_stats: reference private.user_ltv
-- Migration 024 re-introduced public.user_ltv but migration 019
-- moved the view to private schema. This corrects the reference.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_revenue_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  -- Only allow super admins
  IF NOT public.is_super_admin((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized: super_admin role required';
  END IF;

  SELECT json_build_object(
    -- MRR: pro_monthly = $6.99, pro_yearly = $59.99/12 = $5.00/mo
    'mrr_cents', (
      SELECT COALESCE(
        SUM(
          CASE
            WHEN plan_id = 'pro_monthly' THEN 699
            WHEN plan_id = 'pro_yearly' THEN 500
            ELSE 0
          END
        ), 0
      )
      FROM public.user_subscriptions
      WHERE status = 'active' AND plan_id IN ('pro_monthly', 'pro_yearly')
    ),

    -- Active subscriber counts
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

    -- Conversion rate: paid / total users
    'total_users', (SELECT COUNT(*) FROM public.user_profiles),
    'paid_users', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'active' AND plan_id IN ('pro_monthly', 'pro_yearly')
    ),

    -- Trial stats
    'active_trials', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'trial' AND trial_ends_at > NOW()
    ),
    'expired_trials', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'trial' AND trial_ends_at <= NOW()
    ),

    -- Churn
    'churned_users', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status IN ('expired', 'cancelled')
    ),

    -- Average LTV (view lives in private schema per migration 019)
    'avg_ltv_cents', (
      SELECT COALESCE(
        ROUND(AVG(mrr_dollars * lifetime_days / 30.0) * 100),
        0
      )
      FROM private.user_ltv
      WHERE mrr_dollars > 0
    ),

    -- Revenue this month
    'revenue_this_month_cents', (
      SELECT COALESCE(
        SUM(
          CASE
            WHEN plan_id = 'pro_monthly' THEN 699
            WHEN plan_id = 'pro_yearly' THEN 500
            ELSE 0
          END
        ), 0
      )
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
