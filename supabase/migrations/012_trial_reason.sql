-- Migration 012: Add trial reason tracking
-- Track why a user was granted a free trial

-- Add trial_reason column to user_subscriptions
ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS trial_reason TEXT;

-- Comment for documentation
COMMENT ON COLUMN user_subscriptions.trial_reason IS
'Reason for trial grant: standard, review_bonus, feedback_bonus';
