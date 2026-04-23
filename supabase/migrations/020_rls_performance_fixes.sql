-- Migration 020: RLS Performance Fixes
--
-- WARN auth_rls_initplan:
--   analytics_events, user_daily_metrics, user_funnel service policies
--   re-evaluate auth functions per row. Fix: use (select auth.uid()).
--
-- WARN multiple_permissive_policies:
--   "Service role can manage X" policies apply to all roles, overlapping
--   with user policies. Fix: scope to TO service_role only.

-- ============================================================
-- analytics_events
-- ============================================================

DROP POLICY IF EXISTS "Service role can manage analytics" ON public.analytics_events;
DROP POLICY IF EXISTS "Users can insert own events" ON public.analytics_events;
DROP POLICY IF EXISTS "Users can view own events" ON public.analytics_events;

-- Scoped to service_role — no longer overlaps with user policies
CREATE POLICY "Service role can manage analytics"
  ON public.analytics_events
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can insert own events"
  ON public.analytics_events
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can view own events"
  ON public.analytics_events
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- user_daily_metrics
-- ============================================================

DROP POLICY IF EXISTS "Service role can manage metrics" ON public.user_daily_metrics;
DROP POLICY IF EXISTS "Users can view own metrics" ON public.user_daily_metrics;

CREATE POLICY "Service role can manage metrics"
  ON public.user_daily_metrics
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view own metrics"
  ON public.user_daily_metrics
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- user_funnel
-- ============================================================

DROP POLICY IF EXISTS "Service role can manage funnel" ON public.user_funnel;
DROP POLICY IF EXISTS "Users can view own funnel" ON public.user_funnel;
DROP POLICY IF EXISTS "Users can update own funnel" ON public.user_funnel;

CREATE POLICY "Service role can manage funnel"
  ON public.user_funnel
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view own funnel"
  ON public.user_funnel
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can update own funnel"
  ON public.user_funnel
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
