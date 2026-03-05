/**
 * TailoredTime - Feedback & Review System
 *
 * Adds:
 * 1. Review tracking fields to user_funnel table
 * 2. Feedback table for collecting user feedback
 */

-- =====================================================
-- PART 1: Review Tracking Fields in user_funnel
-- =====================================================

-- Add review tracking columns to existing user_funnel table
ALTER TABLE user_funnel
  ADD COLUMN IF NOT EXISTS review_request_shown BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_request_shown_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_submitted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS happiness_response TEXT; -- 'loving_it', 'its_okay'

-- Add comment for documentation
COMMENT ON COLUMN user_funnel.review_request_shown IS 'Whether the happiness check modal has been shown';
COMMENT ON COLUMN user_funnel.happiness_response IS 'User response: loving_it or its_okay';


-- =====================================================
-- PART 2: Feedback Table
-- =====================================================

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Categorization
  category TEXT NOT NULL,
  -- Categories: 'missing_feature', 'bug', 'hard_to_use', 'ai_issue', 'calendar_issue', 'pricing', 'other'
  subcategory TEXT,
  trigger_point TEXT NOT NULL DEFAULT 'settings',
  -- Trigger points: 'review_flow', 'settings'
  sentiment TEXT,
  -- Sentiment: 'positive', 'neutral', 'negative'

  -- Content
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  text_feedback TEXT CHECK (char_length(text_feedback) <= 2000),

  -- Metadata
  app_version TEXT,
  device_info JSONB,
  user_email TEXT,
  wants_follow_up BOOLEAN DEFAULT FALSE,
  include_logs BOOLEAN DEFAULT FALSE,

  -- Processing (for internal use)
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'resolved', 'archived')),
  priority TEXT CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'critical')),
  internal_notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_trigger ON feedback(trigger_point);

-- Add comments for documentation
COMMENT ON TABLE feedback IS 'User feedback collected from review flow and settings';
COMMENT ON COLUMN feedback.category IS 'missing_feature, bug, hard_to_use, ai_issue, calendar_issue, pricing, other';
COMMENT ON COLUMN feedback.trigger_point IS 'Where feedback was submitted: review_flow or settings';
COMMENT ON COLUMN feedback.status IS 'Processing status: new, reviewed, resolved, archived';


-- =====================================================
-- PART 3: Row Level Security
-- =====================================================

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Users can insert their own feedback
CREATE POLICY "Users can insert own feedback" ON feedback
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can view their own feedback history
CREATE POLICY "Users can view own feedback" ON feedback
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role has full access (for admin/support)
CREATE POLICY "Service role full access" ON feedback
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');


-- =====================================================
-- PART 4: Auto-update trigger for updated_at
-- =====================================================

-- Reuse the existing update_updated_at_column function if it exists
-- Otherwise create it
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

-- Create trigger for feedback table
DROP TRIGGER IF EXISTS update_feedback_updated_at ON feedback;
CREATE TRIGGER update_feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- =====================================================
-- PART 5: Helper function to mark review as shown
-- =====================================================

CREATE OR REPLACE FUNCTION mark_review_shown(
  p_user_id UUID,
  p_happiness_response TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE user_funnel
  SET
    review_request_shown = TRUE,
    review_request_shown_at = NOW(),
    happiness_response = COALESCE(p_happiness_response, happiness_response)
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to mark review as submitted
CREATE OR REPLACE FUNCTION mark_review_submitted(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE user_funnel
  SET
    review_submitted = TRUE,
    review_submitted_at = NOW()
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION mark_review_shown(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_review_submitted(UUID) TO authenticated;
