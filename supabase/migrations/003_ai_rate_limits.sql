-- AI Rate Limiting Table
-- Tracks API calls per user to enforce 100 requests/hour limit

CREATE TABLE IF NOT EXISTS ai_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient rate limit queries
CREATE INDEX idx_ai_rate_limits_user_time
  ON ai_rate_limits(user_id, created_at DESC);

-- RLS: Users can only see their own rate limit records
ALTER TABLE ai_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rate limits"
  ON ai_rate_limits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own rate limits"
  ON ai_rate_limits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Auto-cleanup: Delete records older than 24 hours (run via cron)
-- This keeps the table small while maintaining hourly rate limit accuracy
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM ai_rate_limits
  WHERE created_at < now() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
