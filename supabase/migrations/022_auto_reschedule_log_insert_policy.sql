-- Migration 022: Create auto_reschedule_log if not exists and add INSERT policy
-- Combines migration 018 (table) with the missing INSERT policy for client-side tracking

CREATE TABLE IF NOT EXISTS public.auto_reschedule_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  rescheduled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_reschedule_log_user_week
  ON public.auto_reschedule_log (user_id, rescheduled_at);

ALTER TABLE public.auto_reschedule_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own reschedule log" ON public.auto_reschedule_log;
CREATE POLICY "Users can view their own reschedule log"
  ON public.auto_reschedule_log
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own reschedule log" ON public.auto_reschedule_log;
CREATE POLICY "Users can insert their own reschedule log"
  ON public.auto_reschedule_log
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);
