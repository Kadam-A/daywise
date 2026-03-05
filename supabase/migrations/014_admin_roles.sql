-- Migration 014: Admin Role System
-- Implements role-based access control with user, admin, and super_admin roles

-- =====================================================
-- PART 1: User Roles Table
-- =====================================================

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

-- Add comments for documentation
COMMENT ON TABLE user_roles IS 'User role assignments for RBAC';
COMMENT ON COLUMN user_roles.role IS 'user = regular user, admin = can view all data, super_admin = can manage roles';
COMMENT ON COLUMN user_roles.granted_by IS 'UUID of admin who granted this role';


-- =====================================================
-- PART 2: Auto-create User Role Trigger
-- =====================================================

-- Auto-create 'user' role for new users when profile is created
CREATE OR REPLACE FUNCTION create_default_user_role()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists, then create
DROP TRIGGER IF EXISTS on_user_created_role ON user_profiles;
CREATE TRIGGER on_user_created_role
  AFTER INSERT ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION create_default_user_role();


-- =====================================================
-- PART 3: Helper Functions
-- =====================================================

-- Check if user is admin (admin or super_admin)
CREATE OR REPLACE FUNCTION is_admin(check_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM user_roles
    WHERE user_id = check_user_id
    AND role IN ('admin', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user is super_admin
CREATE OR REPLACE FUNCTION is_super_admin(check_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM user_roles
    WHERE user_id = check_user_id
    AND role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get user's role
CREATE OR REPLACE FUNCTION get_user_role(check_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role FROM user_roles WHERE user_id = check_user_id;
  RETURN COALESCE(user_role, 'user');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION is_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_super_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_role(UUID) TO authenticated;


-- =====================================================
-- PART 4: Row Level Security
-- =====================================================

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can view their own role
CREATE POLICY "Users can view own role" ON user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- Super admins can view all roles
CREATE POLICY "Super admins can view all roles" ON user_roles
  FOR SELECT USING (is_super_admin(auth.uid()));

-- Only super_admins can insert/update/delete roles
CREATE POLICY "Super admins can insert roles" ON user_roles
  FOR INSERT WITH CHECK (is_super_admin(auth.uid()));

CREATE POLICY "Super admins can update roles" ON user_roles
  FOR UPDATE USING (is_super_admin(auth.uid()));

CREATE POLICY "Super admins can delete roles" ON user_roles
  FOR DELETE USING (is_super_admin(auth.uid()));

-- Service role can manage roles (for triggers and admin operations)
CREATE POLICY "Service role can manage roles" ON user_roles
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');


-- =====================================================
-- PART 5: Admin Policies for Existing Tables
-- =====================================================

-- Drop existing feedback policies that might conflict
DROP POLICY IF EXISTS "Users can view own feedback" ON feedback;
DROP POLICY IF EXISTS "Admins can view all feedback" ON feedback;
DROP POLICY IF EXISTS "Admins can update feedback" ON feedback;

-- Recreate feedback policies with admin access
CREATE POLICY "Users and admins can view feedback" ON feedback
  FOR SELECT USING (
    auth.uid() = user_id OR is_admin(auth.uid())
  );

CREATE POLICY "Admins can update feedback" ON feedback
  FOR UPDATE USING (is_admin(auth.uid()));

-- Admins can view all user profiles (for admin dashboard)
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
CREATE POLICY "Admins can view all profiles" ON user_profiles
  FOR SELECT USING (
    auth.uid() = id OR is_admin(auth.uid())
  );

-- Admins can view all user_funnel data (for analytics)
DROP POLICY IF EXISTS "Admins can view all funnel data" ON user_funnel;
CREATE POLICY "Admins can view all funnel data" ON user_funnel
  FOR SELECT USING (
    auth.uid() = user_id OR is_admin(auth.uid())
  );


-- =====================================================
-- PART 6: Auto-update timestamp trigger
-- =====================================================

-- Reuse existing function or create it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS update_user_roles_updated_at ON user_roles;
CREATE TRIGGER update_user_roles_updated_at
  BEFORE UPDATE ON user_roles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- =====================================================
-- PART 7: Admin Statistics Functions
-- =====================================================

-- Get admin dashboard stats
CREATE OR REPLACE FUNCTION get_admin_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  -- Only allow admins to call this
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'total_users', (SELECT COUNT(*) FROM user_profiles),
    'users_today', (
      SELECT COUNT(*) FROM user_profiles
      WHERE DATE(created_at) = CURRENT_DATE
    ),
    'users_this_week', (
      SELECT COUNT(*) FROM user_profiles
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    ),
    'total_feedback', (SELECT COUNT(*) FROM feedback),
    'pending_feedback', (
      SELECT COUNT(*) FROM feedback WHERE status = 'new'
    ),
    'total_tasks', (SELECT COUNT(*) FROM tasks),
    'completed_tasks', (
      SELECT COUNT(*) FROM tasks WHERE status = 'completed'
    ),
    'pro_users', (
      SELECT COUNT(*) FROM user_subscriptions
      WHERE status = 'active' AND plan_id IN ('pro_monthly', 'pro_yearly')
    ),
    'trial_users', (
      SELECT COUNT(*) FROM user_subscriptions
      WHERE status = 'trial' AND trial_ends_at > NOW()
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;
