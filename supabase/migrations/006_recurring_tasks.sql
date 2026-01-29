-- Migration: Recurring Tasks (Simplified)
-- Allows tasks to repeat on a schedule (daily, weekly, monthly)

-- Add recurring task columns
ALTER TABLE tasks ADD COLUMN is_recurring BOOLEAN DEFAULT false;

-- Recurrence rule as JSONB
-- Example: {"frequency": "weekly", "days": [1, 3, 5]} for Mon/Wed/Fri
-- Example: {"frequency": "daily"} for every day
-- Example: {"frequency": "monthly"} for same day each month
ALTER TABLE tasks ADD COLUMN recurrence_rule JSONB;

-- Reference to the parent recurring task (for instances)
ALTER TABLE tasks ADD COLUMN recurrence_parent_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

-- The specific date this instance represents
ALTER TABLE tasks ADD COLUMN instance_date DATE;

-- Index for efficient recurring task queries
CREATE INDEX idx_tasks_recurring_parent ON tasks(recurrence_parent_id) WHERE recurrence_parent_id IS NOT NULL;
CREATE INDEX idx_tasks_is_recurring ON tasks(is_recurring) WHERE is_recurring = true;

COMMENT ON COLUMN tasks.is_recurring IS 'True if this is a recurring task template';
COMMENT ON COLUMN tasks.recurrence_rule IS 'JSONB defining recurrence pattern (frequency, days)';
COMMENT ON COLUMN tasks.recurrence_parent_id IS 'Reference to parent recurring task for instances';
COMMENT ON COLUMN tasks.instance_date IS 'The specific date this recurring instance represents';
