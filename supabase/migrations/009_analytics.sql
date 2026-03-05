-- Migration 009: Analytics & LTV Tracking
-- TailoredTime analytics infrastructure for measuring user engagement and lifetime value

-- Core event tracking table
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name VARCHAR(100) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_analytics_user_time ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at DESC);

-- Aggregated daily metrics (can be computed via cron job)
CREATE TABLE IF NOT EXISTS user_daily_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  tasks_created INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  smart_schedules INTEGER DEFAULT 0,
  manual_schedules INTEGER DEFAULT 0,
  session_count INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_user_date ON user_daily_metrics(user_id, date DESC);

-- Conversion funnel tracking
CREATE TABLE IF NOT EXISTS user_funnel (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  onboarding_completed_at TIMESTAMPTZ,
  first_task_at TIMESTAMPTZ,
  first_schedule_at TIMESTAMPTZ,
  first_completion_at TIMESTAMPTZ,
  converted_to_paid_at TIMESTAMPTZ,
  day_7_active BOOLEAN DEFAULT FALSE,
  day_30_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to create funnel row on user signup
CREATE OR REPLACE FUNCTION create_user_funnel()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_funnel (user_id, installed_at)
  VALUES (NEW.id, NOW())
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_created_funnel ON user_profiles;
CREATE TRIGGER on_user_created_funnel
  AFTER INSERT ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION create_user_funnel();

-- Auto-update funnel timestamp
CREATE OR REPLACE FUNCTION update_funnel_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_funnel_timestamp ON user_funnel;
CREATE TRIGGER update_user_funnel_timestamp
  BEFORE UPDATE ON user_funnel
  FOR EACH ROW EXECUTE FUNCTION update_funnel_timestamp();

-- Row Level Security
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_funnel ENABLE ROW LEVEL SECURITY;

-- Users can insert their own events
DO $$ BEGIN
  CREATE POLICY "Users can insert own events" ON analytics_events
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can view their own events
DO $$ BEGIN
  CREATE POLICY "Users can view own events" ON analytics_events
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role can manage all analytics
DO $$ BEGIN
  CREATE POLICY "Service role can manage analytics" ON analytics_events
    FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can view their own daily metrics
DO $$ BEGIN
  CREATE POLICY "Users can view own metrics" ON user_daily_metrics
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role can manage metrics
DO $$ BEGIN
  CREATE POLICY "Service role can manage metrics" ON user_daily_metrics
    FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can view own funnel data
DO $$ BEGIN
  CREATE POLICY "Users can view own funnel" ON user_funnel
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Users can update own funnel data
DO $$ BEGIN
  CREATE POLICY "Users can update own funnel" ON user_funnel
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role can manage funnel
DO $$ BEGIN
  CREATE POLICY "Service role can manage funnel" ON user_funnel
    FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- LTV calculation view (admin dashboard use)
CREATE OR REPLACE VIEW user_ltv AS
SELECT
  u.id as user_id,
  u.email,
  up.created_at as signup_date,

  -- Subscription info
  COALESCE(s.plan_id, 'free') as plan,
  s.status as subscription_status,
  s.current_period_start,
  s.current_period_end,

  -- Revenue calculation (used by get_revenue_stats as mrr_dollars)
  CASE
    WHEN s.plan_id = 'pro_monthly' THEN 6.99
    WHEN s.plan_id = 'pro_yearly' THEN 59.99
    ELSE 0
  END as mrr_dollars,

  -- Lifetime in days
  EXTRACT(DAY FROM NOW() - up.created_at) as lifetime_days,

  -- Task engagement
  (SELECT COUNT(*) FROM tasks WHERE user_id = u.id) as total_tasks,
  (SELECT COUNT(*) FROM tasks WHERE user_id = u.id AND status = 'completed') as completed_tasks,
  (SELECT COUNT(*) FROM tasks WHERE user_id = u.id AND scheduling_method = 'SMART') as smart_scheduled_tasks,

  -- Funnel progress
  f.onboarding_completed_at IS NOT NULL as completed_onboarding,
  f.first_task_at IS NOT NULL as created_first_task,
  f.first_schedule_at IS NOT NULL as scheduled_first_task,
  f.first_completion_at IS NOT NULL as completed_first_task,
  f.converted_to_paid_at IS NOT NULL as is_paying,
  f.day_7_active,
  f.day_30_active

FROM auth.users u
LEFT JOIN user_profiles up ON up.id = u.id
LEFT JOIN user_subscriptions s ON s.user_id = u.id
LEFT JOIN user_funnel f ON f.user_id = u.id;

-- Monthly cohort analysis view
CREATE OR REPLACE VIEW monthly_cohorts AS
SELECT
  DATE_TRUNC('month', up.created_at) as cohort_month,
  COUNT(DISTINCT u.id) as total_users,
  COUNT(DISTINCT CASE WHEN f.first_task_at IS NOT NULL THEN u.id END) as created_task,
  COUNT(DISTINCT CASE WHEN f.first_completion_at IS NOT NULL THEN u.id END) as completed_task,
  COUNT(DISTINCT CASE WHEN s.plan_id != 'free' THEN u.id END) as paid_users,
  COUNT(DISTINCT CASE WHEN f.day_7_active THEN u.id END) as retained_day_7,
  COUNT(DISTINCT CASE WHEN f.day_30_active THEN u.id END) as retained_day_30,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN s.plan_id != 'free' THEN u.id END) / NULLIF(COUNT(DISTINCT u.id), 0), 2) as conversion_rate
FROM auth.users u
LEFT JOIN user_profiles up ON up.id = u.id
LEFT JOIN user_subscriptions s ON s.user_id = u.id
LEFT JOIN user_funnel f ON f.user_id = u.id
WHERE up.created_at IS NOT NULL
GROUP BY DATE_TRUNC('month', up.created_at)
ORDER BY cohort_month DESC;

-- Event counts by type (for dashboard)
CREATE OR REPLACE VIEW event_summary AS
SELECT
  event_name,
  COUNT(*) as total_count,
  COUNT(DISTINCT user_id) as unique_users,
  DATE_TRUNC('day', created_at) as event_date
FROM analytics_events
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY event_name, DATE_TRUNC('day', created_at)
ORDER BY event_date DESC, total_count DESC;
