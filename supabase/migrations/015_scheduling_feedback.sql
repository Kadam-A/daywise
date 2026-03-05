-- Migration 015: Scheduling Feedback & AI Usage Tracking
--
-- Adds:
-- 1. scheduling_feedback table - Track user feedback on AI-scheduled times
-- 2. ai_task_usage table - Track weekly AI task usage for freemium limit
-- 3. Helper functions for checking weekly limits

-- ============================================
-- PART 1: Scheduling Feedback Table
-- ============================================

CREATE TABLE IF NOT EXISTS scheduling_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

  -- Feedback data
  was_good_time BOOLEAN NOT NULL,  -- true = thumbs up, false = thumbs down
  feedback_reason TEXT,  -- 'earlier', 'later', 'different_day', 'other'
  feedback_text TEXT,    -- Optional free text

  -- Context (for AI learning)
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  ai_suggested BOOLEAN DEFAULT TRUE,  -- Was this an AI suggestion?

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- One feedback per task
  UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduling_feedback_user ON scheduling_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_feedback_task ON scheduling_feedback(task_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_feedback_created ON scheduling_feedback(user_id, created_at DESC);

-- RLS for scheduling_feedback
ALTER TABLE scheduling_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own feedback" ON scheduling_feedback
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can view own feedback" ON scheduling_feedback
  FOR SELECT USING ((SELECT auth.uid()) = user_id);


-- ============================================
-- PART 2: AI Task Usage Table (Weekly Limit)
-- ============================================

CREATE TABLE IF NOT EXISTS ai_task_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,  -- Monday of the week (ISO week)
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- One entry per task
  UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_task_usage_user_week ON ai_task_usage(user_id, week_start);

-- RLS for ai_task_usage
ALTER TABLE ai_task_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own usage" ON ai_task_usage
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can view own usage" ON ai_task_usage
  FOR SELECT USING ((SELECT auth.uid()) = user_id);


-- ============================================
-- PART 3: Helper Functions
-- ============================================

-- Get count of AI tasks used this week
CREATE OR REPLACE FUNCTION get_ai_tasks_this_week(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM ai_task_usage
    WHERE user_id = p_user_id
    AND week_start = DATE_TRUNC('week', CURRENT_DATE)::DATE
  );
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- Check if user can use AI scheduling (returns detailed status)
CREATE OR REPLACE FUNCTION can_use_ai_scheduling(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_is_pro BOOLEAN;
  v_used_count INTEGER;
  v_weekly_limit INTEGER := 3;
  v_week_start DATE;
  v_next_monday DATE;
BEGIN
  -- Get current week start (Monday)
  v_week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
  v_next_monday := v_week_start + INTERVAL '7 days';

  -- Pro users have unlimited access
  SELECT is_user_pro(p_user_id) INTO v_is_pro;
  IF v_is_pro THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'used', 0,
      'limit', -1,
      'is_pro', true,
      'resets_on', NULL
    );
  END IF;

  -- Free users: check weekly limit
  SELECT get_ai_tasks_this_week(p_user_id) INTO v_used_count;

  RETURN jsonb_build_object(
    'allowed', v_used_count < v_weekly_limit,
    'used', v_used_count,
    'limit', v_weekly_limit,
    'is_pro', false,
    'resets_on', v_next_monday
  );
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_ai_tasks_this_week(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_use_ai_scheduling(UUID) TO authenticated;


-- ============================================
-- PART 4: Stats Helper (for feedback analysis)
-- ============================================

-- Get scheduling feedback stats for a user
CREATE OR REPLACE FUNCTION get_scheduling_feedback_stats(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_total INTEGER;
  v_positive INTEGER;
  v_negative INTEGER;
BEGIN
  SELECT
    COUNT(*)::INTEGER,
    COUNT(*) FILTER (WHERE was_good_time = true)::INTEGER,
    COUNT(*) FILTER (WHERE was_good_time = false)::INTEGER
  INTO v_total, v_positive, v_negative
  FROM scheduling_feedback
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'total', v_total,
    'positive', v_positive,
    'negative', v_negative,
    'acceptance_rate', CASE WHEN v_total > 0 THEN ROUND((v_positive::NUMERIC / v_total) * 100) ELSE 0 END
  );
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION get_scheduling_feedback_stats(UUID) TO authenticated;
