-- Migration 021: Admin Security Hardening
--
-- Fixes:
-- 1. is_admin / is_super_admin / get_user_role accepted arbitrary UUIDs,
--    allowing any user to check another user's role (info disclosure).
--    Fix: restrict to caller's own UID only.
-- 2. All admin functions from migration 014 were missing SET search_path = ''.
-- 3. create_default_user_role trigger function also missing SET search_path = ''.

-- ============================================================
-- 1. is_admin — restrict to own UID + SET search_path
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin(check_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- Prevent any user from checking another user's admin status
  IF check_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_user_id
    AND role IN ('admin', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ============================================================
-- 2. is_super_admin — restrict to own UID + SET search_path
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_super_admin(check_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF check_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_user_id
    AND role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ============================================================
-- 3. get_user_role — restrict to own UID + SET search_path
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_role(check_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- Only allow fetching own role
  IF check_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RETURN 'user';
  END IF;

  SELECT role INTO user_role FROM public.user_roles WHERE user_id = check_user_id;
  RETURN COALESCE(user_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;

-- ============================================================
-- 4. get_admin_stats — add SET search_path (missed in migration 019)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT public.is_admin((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_users', (SELECT COUNT(*) FROM public.user_profiles),
    'users_today', (
      SELECT COUNT(*) FROM public.user_profiles
      WHERE DATE(created_at) = CURRENT_DATE
    ),
    'users_this_week', (
      SELECT COUNT(*) FROM public.user_profiles
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    ),
    'total_feedback', (SELECT COUNT(*) FROM public.feedback),
    'pending_feedback', (
      SELECT COUNT(*) FROM public.feedback WHERE status = 'new'
    ),
    'total_tasks', (SELECT COUNT(*) FROM public.tasks),
    'completed_tasks', (
      SELECT COUNT(*) FROM public.tasks WHERE status = 'completed'
    ),
    'pro_users', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'active' AND plan_id IN ('pro_monthly', 'pro_yearly')
    ),
    'trial_users', (
      SELECT COUNT(*) FROM public.user_subscriptions
      WHERE status = 'trial' AND trial_ends_at > NOW()
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;

-- ============================================================
-- 5. create_default_user_role — add SET search_path
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_default_user_role()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- ============================================================
-- 6. cleanup_old_rate_limits — add SET search_path (missed in 019)
-- ============================================================

CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM public.ai_rate_limits
  WHERE created_at < now() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
