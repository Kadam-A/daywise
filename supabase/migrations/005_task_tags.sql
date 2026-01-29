-- Migration: Task Tags
-- Simple array-based tags for task categorization

-- Add tags column to tasks table
ALTER TABLE tasks ADD COLUMN tags TEXT[] DEFAULT '{}';

-- Create GIN index for efficient tag filtering
CREATE INDEX idx_tasks_tags ON tasks USING GIN(tags);

COMMENT ON COLUMN tasks.tags IS 'Array of tag strings for categorizing tasks';
