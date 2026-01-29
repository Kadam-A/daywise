-- Migration: Task Splitting (Subtasks)
-- Allows tasks to have parent-child relationships for breaking down large tasks

-- Add parent task reference for subtasks
ALTER TABLE tasks ADD COLUMN parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;

-- Add ordering for subtasks within a parent
ALTER TABLE tasks ADD COLUMN subtask_order INTEGER DEFAULT 0;

-- Index for efficient subtask queries
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- Update RLS policies to allow users to manage subtasks
-- (Existing policies already check user_id, so subtasks inherit parent's user_id)

COMMENT ON COLUMN tasks.parent_task_id IS 'Reference to parent task if this is a subtask';
COMMENT ON COLUMN tasks.subtask_order IS 'Order of subtask within parent (0-indexed)';
