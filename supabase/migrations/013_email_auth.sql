-- Migration 013: Email Authentication Support
-- Adds tracking for signup method and email verification

-- Add signup method tracking to user_funnel
ALTER TABLE user_funnel
  ADD COLUMN IF NOT EXISTS signup_method TEXT DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Add comments for documentation
COMMENT ON COLUMN user_funnel.signup_method IS 'Authentication method used: google, email';
COMMENT ON COLUMN user_funnel.email_verified_at IS 'Timestamp when email was verified (for email signups)';

-- Create index for signup method analytics
CREATE INDEX IF NOT EXISTS idx_user_funnel_signup_method ON user_funnel(signup_method);
