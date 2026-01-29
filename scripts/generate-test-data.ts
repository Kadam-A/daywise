/**
 * TailoredTime - Test Data Generator
 *
 * Generates test tasks in various states for testing:
 * - Overdue tasks (for auto-reschedule testing)
 * - Scheduled tasks (upcoming)
 * - Pending tasks (needs scheduling)
 * - Tasks with different priorities and durations
 *
 * Usage:
 *   npx ts-node scripts/generate-test-data.ts
 *
 * Or add to Supabase SQL editor for direct insertion.
 */

import { addDays, addHours, subDays, subHours, setHours, setMinutes, format } from "date-fns";

// Configuration
const TEST_USER_ID = "YOUR_USER_ID_HERE"; // Replace with actual user ID

interface TestTask {
  user_id: string;
  title: string;
  description: string;
  duration_minutes: number;
  priority: "low" | "medium" | "high";
  scheduling_method: "SMART" | "MANUAL";
  auto_reschedule: boolean;
  status: string;
  due_date?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  tags?: string[];
}

function generateTestTasks(userId: string): TestTask[] {
  const now = new Date();
  const tasks: TestTask[] = [];

  // ============================================
  // 1. OVERDUE TASKS (for auto-reschedule testing)
  // ============================================

  // Overdue - scheduled 2 hours ago, auto_reschedule ON
  tasks.push({
    user_id: userId,
    title: "Overdue: Should Auto-Reschedule",
    description: "This task was scheduled 2 hours ago and should be auto-rescheduled",
    duration_minutes: 60,
    priority: "high",
    scheduling_method: "SMART",
    auto_reschedule: true,
    status: "scheduled",
    scheduled_start: subHours(now, 3).toISOString(),
    scheduled_end: subHours(now, 2).toISOString(),
    tags: ["test", "overdue"],
  });

  // Overdue - scheduled yesterday, auto_reschedule OFF
  tasks.push({
    user_id: userId,
    title: "Overdue: Manual Reschedule Needed",
    description: "This task was scheduled yesterday and needs manual intervention",
    duration_minutes: 45,
    priority: "medium",
    scheduling_method: "MANUAL",
    auto_reschedule: false,
    status: "scheduled",
    scheduled_start: subDays(now, 1).toISOString(),
    scheduled_end: addHours(subDays(now, 1), 1).toISOString(),
    tags: ["test", "overdue"],
  });

  // Overdue - due date passed
  tasks.push({
    user_id: userId,
    title: "Overdue: Past Due Date",
    description: "This task has a due date that passed 2 days ago",
    duration_minutes: 30,
    priority: "high",
    scheduling_method: "SMART",
    auto_reschedule: true,
    status: "pending_schedule",
    due_date: subDays(now, 2).toISOString(),
    tags: ["test", "overdue"],
  });

  // ============================================
  // 2. SCHEDULED TASKS (upcoming)
  // ============================================

  // Scheduled for today
  const todayAt2pm = setMinutes(setHours(now, 14), 0);
  if (todayAt2pm > now) {
    tasks.push({
      user_id: userId,
      title: "Today: Afternoon Meeting Prep",
      description: "Prepare slides for the team meeting",
      duration_minutes: 60,
      priority: "high",
      scheduling_method: "SMART",
      auto_reschedule: true,
      status: "scheduled",
      scheduled_start: todayAt2pm.toISOString(),
      scheduled_end: addHours(todayAt2pm, 1).toISOString(),
      tags: ["test", "work"],
    });
  }

  // Scheduled for tomorrow morning
  const tomorrowAt9am = setMinutes(setHours(addDays(now, 1), 9), 0);
  tasks.push({
    user_id: userId,
    title: "Tomorrow: Morning Exercise",
    description: "30-minute workout routine",
    duration_minutes: 30,
    priority: "medium",
    scheduling_method: "MANUAL",
    auto_reschedule: false,
    status: "scheduled",
    scheduled_start: tomorrowAt9am.toISOString(),
    scheduled_end: addHours(tomorrowAt9am, 0.5).toISOString(),
    tags: ["test", "health"],
  });

  // Scheduled for next week
  const nextWeek = setMinutes(setHours(addDays(now, 7), 10), 0);
  tasks.push({
    user_id: userId,
    title: "Next Week: Project Review",
    description: "Review Q1 project deliverables",
    duration_minutes: 120,
    priority: "medium",
    scheduling_method: "SMART",
    auto_reschedule: true,
    status: "scheduled",
    scheduled_start: nextWeek.toISOString(),
    scheduled_end: addHours(nextWeek, 2).toISOString(),
    tags: ["test", "work"],
  });

  // ============================================
  // 3. PENDING TASKS (needs scheduling)
  // ============================================

  // High priority with deadline soon
  tasks.push({
    user_id: userId,
    title: "Pending: Urgent Report",
    description: "Complete the quarterly report - due in 2 days",
    duration_minutes: 90,
    priority: "high",
    scheduling_method: "SMART",
    auto_reschedule: true,
    status: "pending_schedule",
    due_date: addDays(now, 2).toISOString(),
    tags: ["test", "work", "urgent"],
  });

  // Medium priority, no deadline
  tasks.push({
    user_id: userId,
    title: "Pending: Read Industry Article",
    description: "Read and summarize the latest industry trends article",
    duration_minutes: 45,
    priority: "medium",
    scheduling_method: "SMART",
    auto_reschedule: false,
    status: "pending_schedule",
    tags: ["test", "learning"],
  });

  // Low priority, flexible
  tasks.push({
    user_id: userId,
    title: "Pending: Organize Files",
    description: "Clean up and organize project files",
    duration_minutes: 60,
    priority: "low",
    scheduling_method: "MANUAL",
    auto_reschedule: false,
    status: "pending_schedule",
    tags: ["test", "admin"],
  });

  // ============================================
  // 4. VARIOUS DURATIONS
  // ============================================

  // Short task (15 min)
  tasks.push({
    user_id: userId,
    title: "Quick: Reply to Emails",
    description: "Quick email check and responses",
    duration_minutes: 15,
    priority: "medium",
    scheduling_method: "SMART",
    auto_reschedule: true,
    status: "pending_schedule",
    tags: ["test", "quick"],
  });

  // Long task (3 hours)
  tasks.push({
    user_id: userId,
    title: "Deep Work: Research Paper",
    description: "Deep focus session for research paper writing",
    duration_minutes: 180,
    priority: "high",
    scheduling_method: "SMART",
    auto_reschedule: true,
    status: "pending_schedule",
    due_date: addDays(now, 5).toISOString(),
    tags: ["test", "deep-work"],
  });

  return tasks;
}

// Generate SQL INSERT statements
function generateSQL(tasks: TestTask[]): string {
  const values = tasks.map((t) => {
    const tags = t.tags ? `ARRAY[${t.tags.map((tag) => `'${tag}'`).join(", ")}]` : "'{}'";
    const dueDate = t.due_date ? `'${t.due_date}'` : "NULL";
    const scheduledStart = t.scheduled_start ? `'${t.scheduled_start}'` : "NULL";
    const scheduledEnd = t.scheduled_end ? `'${t.scheduled_end}'` : "NULL";

    return `(
    '${t.user_id}',
    '${t.title.replace(/'/g, "''")}',
    '${t.description.replace(/'/g, "''")}',
    ${t.duration_minutes},
    '${t.priority}',
    '${t.scheduling_method}',
    ${t.auto_reschedule},
    '${t.status}',
    ${dueDate},
    ${scheduledStart},
    ${scheduledEnd},
    ${tags}
  )`;
  });

  return `
-- TailoredTime Test Data
-- Generated: ${new Date().toISOString()}
--
-- IMPORTANT: Replace 'YOUR_USER_ID_HERE' with your actual user ID
-- You can find your user ID in the Supabase Auth dashboard
--
-- To use:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Replace YOUR_USER_ID_HERE with your user ID
-- 3. Run this query

INSERT INTO tasks (
  user_id,
  title,
  description,
  duration_minutes,
  priority,
  scheduling_method,
  auto_reschedule,
  status,
  due_date,
  scheduled_start,
  scheduled_end,
  tags
) VALUES
${values.join(",\n")};

-- Verify insertion
SELECT id, title, status, scheduled_start, auto_reschedule
FROM tasks
WHERE user_id = '${TEST_USER_ID}'
ORDER BY created_at DESC
LIMIT 15;
`;
}

// Main
const tasks = generateTestTasks(TEST_USER_ID);

console.log("=".repeat(60));
console.log("TailoredTime Test Data Generator");
console.log("=".repeat(60));
console.log(`\nGenerated ${tasks.length} test tasks:\n`);

tasks.forEach((t, i) => {
  const status = t.scheduled_start
    ? `Scheduled: ${format(new Date(t.scheduled_start), "MMM d, h:mm a")}`
    : t.due_date
      ? `Due: ${format(new Date(t.due_date), "MMM d")}`
      : "No date";
  console.log(`${i + 1}. [${t.priority.toUpperCase()}] ${t.title}`);
  console.log(`   Status: ${t.status} | ${status}`);
  console.log(`   Auto-reschedule: ${t.auto_reschedule ? "ON" : "OFF"}`);
  console.log("");
});

console.log("=".repeat(60));
console.log("SQL INSERT Statement (copy to Supabase SQL Editor):");
console.log("=".repeat(60));
console.log(generateSQL(tasks));
