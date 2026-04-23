-- Migration 023: Add missing index on user_roles.granted_by foreign key
-- Prevents full table scan when looking up who granted a role

CREATE INDEX IF NOT EXISTS idx_user_roles_granted_by
  ON public.user_roles (granted_by);
