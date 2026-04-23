-- Migration 024: Security Fixes
--
-- Fixes two issues found in security audit:
-- 1. get_revenue_stats() (migration 016) was missing SET search_path = ''
--    leaving it open to search-path injection via SECURITY DEFINER.
--    All other functions were fixed in migration 021 but this one was missed.
-- 2. "Super admins can update roles" RLS policy had no WITH CHECK clause,
--    meaning a super_admin could modify their own role row server-side.
--    Client-side check in lib/admin.ts blocked this but DB had no enforcement.

-- ============================================================
-- 1. Fix get_revenue_stats — add SET search_path + public. prefixes
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

    -- Average LTV
    'avg_ltv_cents', (
      SELECT COALESCE(
        ROUND(AVG(mrr_dollars * lifetime_days / 30.0) * 100),
        0
      )
      FROM public.user_ltv
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


-- ============================================================
-- 2. Add WITH CHECK to user_roles UPDATE policy
--    Prevents a super_admin from modifying their own role row.
--    A super_admin must manage OTHER users' roles — never their own.
-- ============================================================

DROP POLICY IF EXISTS "Super admins can update roles" ON public.user_roles;

CREATE POLICY "Super admins can update roles" ON public.user_roles
  FOR UPDATE
  USING (public.is_super_admin((SELECT auth.uid())))
  WITH CHECK (
    public.is_super_admin((SELECT auth.uid()))
    AND (SELECT auth.uid()) != user_id
  );
