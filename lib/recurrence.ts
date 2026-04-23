/**
 * TailoredTime - Recurrence Utilities
 *
 * Handles generating instances of recurring tasks.
 */

import { Task, RecurrenceRule } from "./types";
import { addDays, addMonths, getDay, format, startOfDay } from "date-fns";

/**
 * Generate the next instance of a recurring task
 * Called when completing a recurring task instance
 */
export function generateNextInstance(
  parentTask: Task,
  completedInstanceDate?: string,
  instanceCount?: number
): Partial<Task> | null {
  if (!parentTask.is_recurring || !parentTask.recurrence_rule) {
    return null;
  }

  const rule = parentTask.recurrence_rule;
  const baseDate = completedInstanceDate
    ? new Date(completedInstanceDate)
    : new Date();

  let nextDate: Date | null = null;

  switch (rule.frequency) {
    case "daily":
      nextDate = addDays(startOfDay(baseDate), 1);
      break;

    case "weekly":
      nextDate = getNextWeeklyDate(baseDate, rule.days || [1]); // Default Monday
      break;

    case "monthly":
      nextDate = addMonths(startOfDay(baseDate), 1);
      break;
  }

  if (!nextDate) {
    return null;
  }

  // Stop generating if end_count reached
  if (rule.end_count !== undefined && instanceCount !== undefined) {
    if (instanceCount >= rule.end_count) {
      return null;
    }
  }

  // Preserve the due_date offset relative to the completed instance date.
  // e.g. task started Monday, due Friday (4-day window) → next instance keeps that 4-day gap.
  // Only computable when both values are known; omit otherwise to avoid false deadlines.
  // Use the formatted instance_date as UTC midnight to avoid local-timezone drift.
  let nextDueDate: string | undefined;
  if (parentTask.due_date && completedInstanceDate) {
    const offsetMs =
      new Date(parentTask.due_date).getTime() - new Date(completedInstanceDate).getTime();
    // Use local midnight (startOfDay) — avoids UTC-midnight drift for non-UTC users
    const instanceDateLocal = startOfDay(nextDate);
    nextDueDate = new Date(instanceDateLocal.getTime() + offsetMs).toISOString();
  }

  // Return the new instance data (without id, created_at, etc.)
  return {
    user_id: parentTask.user_id,
    title: parentTask.title,
    description: parentTask.description,
    duration_minutes: parentTask.duration_minutes,
    priority: parentTask.priority,
    scheduling_method: parentTask.scheduling_method,
    tags: parentTask.tags,
    due_date: nextDueDate,
    status: "pending_schedule",
    recurrence_parent_id: parentTask.id,
    instance_date: format(nextDate, "yyyy-MM-dd"),
    // Don't copy: is_recurring, recurrence_rule (only parent has these)
  };
}

/**
 * Get the next date for a weekly recurring task
 */
function getNextWeeklyDate(fromDate: Date, days: number[]): Date {
  if (days.length === 0) {
    return addDays(fromDate, 7);
  }

  const today = startOfDay(fromDate);
  // getDay returns 0=Sunday, we use 1=Monday...7=Sunday
  const currentDayOfWeek = getDay(today) === 0 ? 7 : getDay(today);

  // Sort days to find next occurrence
  const sortedDays = [...days].sort((a, b) => a - b);

  // Find next day in current week
  for (const day of sortedDays) {
    if (day > currentDayOfWeek) {
      return addDays(today, day - currentDayOfWeek);
    }
  }

  // If no day found in current week, get first day of next week
  const daysUntilNext = 7 - currentDayOfWeek + sortedDays[0];
  return addDays(today, daysUntilNext);
}

/**
 * Check if a task is a recurring instance
 */
export function isRecurringInstance(task: Task): boolean {
  return !!task.recurrence_parent_id;
}

/**
 * Check if a task is a recurring template (parent)
 */
export function isRecurringTemplate(task: Task): boolean {
  return !!task.is_recurring && !!task.recurrence_rule;
}

/**
 * Get human-readable recurrence description
 */
export function getRecurrenceDescription(rule: RecurrenceRule): string {
  let base: string;

  switch (rule.frequency) {
    case "daily":
      base = "Repeats daily";
      break;

    case "weekly":
      if (!rule.days || rule.days.length === 0) {
        base = "Repeats weekly";
      } else {
        const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        const dayList = rule.days.map((d) => dayNames[d]).join(", ");
        base = `Repeats ${dayList}`;
      }
      break;

    case "monthly":
      base = "Repeats monthly";
      break;

    default:
      base = "Repeats";
  }

  return rule.end_count ? `${base} • ${rule.end_count}×` : base;
}
