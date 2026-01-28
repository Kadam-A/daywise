-- =====================================================
-- TAILOREDTIME - INITIAL DATABASE SCHEMA
-- =====================================================
-- This migration creates all tables with RLS policies
-- See SECURITY.md for RLS requirements
-- See SCHEDULING_ALGORITHM_DECISIONS.md for task schema details

-- =====================================================
-- ENABLE EXTENSIONS
-- =====================================================

-- UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLE: user_profiles
-- =====================================================
-- Extends Supabase auth.users with personality data

CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Personality data (6 core dimensions + optional context)
  personality_data JSONB NOT NULL DEFAULT '{
    "chronotype": 50,
    "focus_duration": 50,
    "deadline_style": 50,
    "break_frequency": 50,
    "task_switching": 50,
    "structure_preference": 50,
    "preferred_windows": [],
    "additional_context": null
  }'::jsonb,

  -- User preferences
  preferences JSONB NOT NULL DEFAULT '{
    "theme": "system",
    "notifications_enabled": true,
    "default_task_duration": 60,
    "work_days": [1, 2, 3, 4, 5]
  }'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_personality_data CHECK (
    personality_data ? 'chronotype' AND
    personality_data ? 'focus_duration' AND
    personality_data ? 'deadline_style' AND
    personality_data ? 'break_frequency' AND
    personality_data ? 'task_switching' AND
    personality_data ? 'structure_preference'
  )
);

-- Indexes
CREATE INDEX idx_user_profiles_created_at ON user_profiles(created_at);

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- TABLE: tasks
-- =====================================================
-- Core task table with SMART/MANUAL scheduling

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Task details
  title VARCHAR(200) NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 5 AND duration_minutes <= 480),
  priority VARCHAR(10) NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  due_date TIMESTAMPTZ,

  -- Scheduling method (SMART vs MANUAL)
  scheduling_method VARCHAR(10) NOT NULL CHECK (scheduling_method IN ('SMART', 'MANUAL')),
  auto_reschedule BOOLEAN NOT NULL DEFAULT true,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'pending_schedule' CHECK (
    status IN ('pending_schedule', 'scheduled', 'completed', 'overdue', 'cancelled')
  ),

  -- AI metadata (only populated for SMART method)
  ai_score INTEGER CHECK (ai_score IS NULL OR (ai_score >= 0 AND ai_score <= 100)),
  ai_reason VARCHAR(150),

  -- Google Calendar integration
  google_event_id TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_scheduled_times CHECK (
    (scheduled_start IS NULL AND scheduled_end IS NULL) OR
    (scheduled_start IS NOT NULL AND scheduled_end IS NOT NULL AND scheduled_end > scheduled_start)
  ),
  CONSTRAINT ai_data_only_for_smart CHECK (
    (scheduling_method = 'MANUAL' AND ai_score IS NULL AND ai_reason IS NULL) OR
    (scheduling_method = 'SMART')
  )
);

-- Indexes for performance
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX idx_tasks_scheduled_start ON tasks(scheduled_start) WHERE scheduled_start IS NOT NULL;
CREATE INDEX idx_tasks_user_scheduled ON tasks(user_id, scheduled_start) WHERE status = 'scheduled';
CREATE INDEX idx_tasks_due_date ON tasks(due_date) WHERE due_date IS NOT NULL;

-- Auto-update timestamp
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- TABLE: calendar_events
-- =====================================================
-- Synced events from Google Calendar (busy times)

CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,

  -- Event details
  title TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,

  -- Sync metadata
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_event_times CHECK (end_time > start_time),
  CONSTRAINT unique_google_event UNIQUE (user_id, google_event_id)
);

-- Indexes
CREATE INDEX idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX idx_calendar_events_time_range ON calendar_events(user_id, start_time, end_time);
CREATE INDEX idx_calendar_events_google_id ON calendar_events(google_event_id);

-- =====================================================
-- TABLE: user_patterns
-- =====================================================
-- Computed analytics from user's scheduling history

CREATE TABLE user_patterns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Computed patterns (updated periodically)
  busy_days JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "0": 2.5, "1": 5.2, ... }
  preferred_hours JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "9": 12, "10": 15, ... }
  avg_weekly_hours JSONB NOT NULL DEFAULT '{"work": 0, "free": 0}'::jsonb,

  -- Metadata
  last_computed TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT one_pattern_per_user UNIQUE (user_id)
);

-- Indexes
CREATE INDEX idx_user_patterns_user_id ON user_patterns(user_id);
CREATE INDEX idx_user_patterns_last_computed ON user_patterns(last_computed);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================
-- CRITICAL: See SECURITY.md for why RLS is essential

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_patterns ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES: user_profiles
-- =====================================================

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Users can insert their own profile (during onboarding)
CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can delete their own profile
CREATE POLICY "Users can delete own profile"
  ON user_profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = id);

-- =====================================================
-- RLS POLICIES: tasks
-- =====================================================

-- Users can view their own tasks
CREATE POLICY "Users can view own tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own tasks
CREATE POLICY "Users can insert own tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own tasks
CREATE POLICY "Users can update own tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own tasks
CREATE POLICY "Users can delete own tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================
-- RLS POLICIES: calendar_events
-- =====================================================

-- Users can view their own calendar events
CREATE POLICY "Users can view own calendar events"
  ON calendar_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own calendar events
CREATE POLICY "Users can insert own calendar events"
  ON calendar_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own calendar events
CREATE POLICY "Users can update own calendar events"
  ON calendar_events FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own calendar events
CREATE POLICY "Users can delete own calendar events"
  ON calendar_events FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================
-- RLS POLICIES: user_patterns
-- =====================================================

-- Users can view their own patterns
CREATE POLICY "Users can view own patterns"
  ON user_patterns FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own patterns
CREATE POLICY "Users can insert own patterns"
  ON user_patterns FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own patterns
CREATE POLICY "Users can update own patterns"
  ON user_patterns FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own patterns
CREATE POLICY "Users can delete own patterns"
  ON user_patterns FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to create user profile automatically on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile when user signs up
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- COMMENTS (for documentation)
-- =====================================================

COMMENT ON TABLE user_profiles IS 'User personality data and preferences';
COMMENT ON TABLE tasks IS 'User tasks with SMART/MANUAL scheduling methods';
COMMENT ON TABLE calendar_events IS 'Synced Google Calendar events (busy times)';
COMMENT ON TABLE user_patterns IS 'Computed analytics from user scheduling history';

COMMENT ON COLUMN tasks.scheduling_method IS 'SMART = AI picks time, MANUAL = user picks time';
COMMENT ON COLUMN tasks.auto_reschedule IS 'If true, app auto-reschedules missed tasks';
COMMENT ON COLUMN tasks.ai_score IS 'AI confidence score (0-100) for SMART tasks only';
COMMENT ON COLUMN tasks.ai_reason IS 'AI explanation for SMART tasks only';

-- =====================================================
-- END OF MIGRATION
-- =====================================================
