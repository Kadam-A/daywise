-- Track auto-reschedule runs to enforce free-tier weekly limit (1/week)
CREATE TABLE IF NOT EXISTS auto_reschedule_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  rescheduled_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast weekly-count queries per user
CREATE INDEX IF NOT EXISTS idx_auto_reschedule_log_user_week
  ON auto_reschedule_log (user_id, rescheduled_at);

ALTER TABLE auto_reschedule_log ENABLE ROW LEVEL SECURITY;

-- Users can only read their own log
CREATE POLICY "Users can view their own reschedule log"
  ON auto_reschedule_log FOR SELECT
  USING (auth.uid() = user_id);
