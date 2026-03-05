-- Migration 008: Subscription System
-- TailoredTime Pro subscription management

-- Subscription plans reference table
CREATE TABLE subscription_plans (
  id VARCHAR(20) PRIMARY KEY,  -- 'free', 'pro_monthly', 'pro_yearly'
  name VARCHAR(50) NOT NULL,
  price_cents INTEGER NOT NULL,
  interval VARCHAR(20),  -- 'month', 'year', NULL for free
  features JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default plans
INSERT INTO subscription_plans (id, name, price_cents, interval, features) VALUES
  ('free', 'Free', 0, NULL, '{"ai_scheduling": false, "recurring_tasks": 3, "task_history_days": 30}'),
  ('pro_monthly', 'Pro Monthly', 699, 'month', '{"ai_scheduling": true, "recurring_tasks": -1, "task_history_days": -1}'),
  ('pro_yearly', 'Pro Annual', 5999, 'year', '{"ai_scheduling": true, "recurring_tasks": -1, "task_history_days": -1}');

-- User subscriptions table
CREATE TABLE user_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id VARCHAR(20) NOT NULL REFERENCES subscription_plans(id) DEFAULT 'free',
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active, cancelled, expired, trial
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  stripe_customer_id VARCHAR(100),
  stripe_subscription_id VARCHAR(100),
  revenuecat_customer_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX idx_user_subscriptions_plan ON user_subscriptions(plan_id);

-- Auto-create free subscription for new users
CREATE OR REPLACE FUNCTION create_default_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_subscriptions (user_id, plan_id, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_created_subscription
  AFTER INSERT ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION create_default_subscription();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_subscription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_subscriptions_timestamp
  BEFORE UPDATE ON user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_subscription_timestamp();

-- Row Level Security
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Everyone can read subscription plans
CREATE POLICY "Anyone can view subscription plans" ON subscription_plans
  FOR SELECT USING (true);

-- Users can only view their own subscription
CREATE POLICY "Users can view own subscription" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can manage subscriptions (for webhooks)
CREATE POLICY "Service role can manage subscriptions" ON user_subscriptions
  FOR ALL USING (auth.role() = 'service_role');

-- Helper function to check if user has Pro subscription
CREATE OR REPLACE FUNCTION is_user_pro(check_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_plan VARCHAR(20);
  user_status VARCHAR(20);
  trial_end TIMESTAMPTZ;
BEGIN
  SELECT plan_id, status, trial_ends_at
  INTO user_plan, user_status, trial_end
  FROM user_subscriptions
  WHERE user_id = check_user_id;

  -- Not found = free
  IF user_plan IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check active paid plan
  IF user_plan IN ('pro_monthly', 'pro_yearly') AND user_status = 'active' THEN
    RETURN TRUE;
  END IF;

  -- Check active trial
  IF user_status = 'trial' AND trial_end > NOW() THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
