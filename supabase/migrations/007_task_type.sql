-- =====================================================
-- TAILOREDTIME - ADD TASK TYPE COLUMN
-- =====================================================
-- Adds task_type for energy-based scheduling
-- Types: deep_work, admin, creative, communication, quick_task

-- Add task_type column (nullable - optional field)
ALTER TABLE tasks
ADD COLUMN task_type VARCHAR(20) CHECK (
  task_type IS NULL OR task_type IN ('deep_work', 'admin', 'creative', 'communication', 'quick_task')
);

-- Add comment for documentation
COMMENT ON COLUMN tasks.task_type IS 'Cognitive type for energy-based scheduling (deep_work, admin, creative, communication, quick_task)';

-- Create index for filtering by task type
CREATE INDEX idx_tasks_task_type ON tasks(task_type) WHERE task_type IS NOT NULL;

-- =====================================================
-- END OF MIGRATION
-- =====================================================
