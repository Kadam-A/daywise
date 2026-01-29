/**
 * TailoredTime - TypeScript Type Definitions
 *
 * This file contains all TypeScript interfaces and types used throughout the app.
 * Keep this file updated as new features are added.
 */

// ===========================================
// USER & AUTHENTICATION TYPES
// ===========================================

/**
 * Personality data captured during onboarding
 * Each dimension is scored 0-100 (slider values)
 *
 * IMPROVED from 7 dimensions → 6 core dimensions:
 * - Merged deadline_tolerance + procrastination → deadline_style
 * - Removed social_energy (not actionable for personal scheduling)
 * - Added break_frequency (critical for task chunking)
 * - Added task_switching (affects task grouping strategy)
 * - Made preferred_windows optional (manual override)
 */
export interface PersonalityData {
  // 1. CHRONOTYPE (research-backed circadian rhythm preference)
  chronotype: number; // 0 = Night Owl → 100 = Early Bird

  // 2. FOCUS DURATION (task block size preference)
  focus_duration: number; // 0 = Short sprints (25min Pomodoro) → 100 = Deep focus (2-3hr blocks)

  // 3. DEADLINE STYLE (combines old deadline_tolerance + procrastination)
  deadline_style: number; // 0 = Start early with buffer → 100 = Thrive under pressure

  // 4. BREAK FREQUENCY (NEW - important for scheduling breaks)
  break_frequency: number; // 0 = Frequent breaks (every 25-30min) → 100 = Rare breaks (every 2-3hr)

  // 5. TASK SWITCHING (NEW - affects whether to batch similar tasks)
  task_switching: number; // 0 = Single-task focus → 100 = Comfortable switching tasks

  // 6. STRUCTURE FLEXIBILITY (rescheduling behavior)
  structure_preference: number; // 0 = Rigid schedule → 100 = Fluid/adaptive

  // OPTIONAL: User-defined work windows (manual override, not required in onboarding)
  preferred_windows?: Array<{
    day: number; // 0-6 (0=Sunday, 1=Monday, ..., 6=Saturday)
    start: string; // HH:MM format (e.g., "09:00")
    end: string; // HH:MM format (e.g., "17:00")
  }>;

  // OPTIONAL: Free-form context (captured in Settings, not onboarding)
  additional_context?: string; // Max 500 chars, e.g., "I have ADHD and need visual timers"
}

/**
 * User profile stored in database
 * Links to Supabase auth.users via id
 */
export interface UserProfile {
  id: string; // UUID, references auth.users(id)
  display_name: string | null; // User's display name, auto-populated from Google
  personality_data: PersonalityData;
  preferences: {
    theme?: "light" | "dark" | "system";
    notifications_enabled?: boolean;
    default_task_duration?: number; // minutes
    work_days?: number[]; // [1,2,3,4,5] for Mon-Fri
  };
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp
}

// ===========================================
// TASK TYPES
// ===========================================

/**
 * Scheduling method for tasks
 * MANUAL: User picks time manually from generated options
 * SMART: AI auto-schedules based on priority/deadline
 */
export type SchedulingMethod = "MANUAL" | "SMART";

/**
 * Task status lifecycle
 */
export type TaskStatus =
  | "pending_schedule" // Created but not scheduled yet
  | "scheduled" // Has a time slot assigned
  | "completed" // Marked as done
  | "overdue" // Missed and not rescheduled
  | "cancelled"; // User cancelled

/**
 * Task priority levels
 */
export type TaskPriority = "low" | "medium" | "high";

/**
 * Core task object
 */
export interface Task {
  id: string; // UUID
  user_id: string; // References auth.users(id)
  title: string; // Task name (max 200 chars)
  description?: string; // Optional details
  scheduling_method: SchedulingMethod;
  auto_reschedule: boolean; // If true, app auto-reschedules when missed
  due_date?: string; // ISO 8601 timestamp (deadline)
  duration_minutes: number; // How long the task takes (5-480 mins)
  scheduled_start?: string; // ISO 8601 timestamp (when task is scheduled)
  scheduled_end?: string; // ISO 8601 timestamp (calculated from start + duration)
  status: TaskStatus;
  priority: TaskPriority;
  google_event_id?: string; // ID of synced Google Calendar event
  created_at: string; // ISO 8601 timestamp
  updated_at: string; // ISO 8601 timestamp

  // Task Splitting (Subtasks)
  parent_task_id?: string; // UUID of parent task if this is a subtask
  subtask_order?: number; // Order within parent (0-indexed)
  subtasks?: Task[]; // Client-side convenience: populated when fetching parent

  // Tags
  tags?: string[]; // Array of tag strings for categorization

  // Recurring Tasks
  is_recurring?: boolean; // True if this is a recurring task template
  recurrence_rule?: RecurrenceRule; // Recurrence pattern
  recurrence_parent_id?: string; // UUID of parent recurring task (for instances)
  instance_date?: string; // ISO date string for which occurrence this represents
}

/**
 * Recurrence rule for repeating tasks (simplified)
 */
export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly";
  days?: number[]; // For weekly: 1=Mon, 2=Tue, ..., 7=Sun
  // No end date for MVP - runs forever
}

/**
 * Input type for creating a new task
 */
export type CreateTaskInput = Pick<
  Task,
  | "title"
  | "description"
  | "scheduling_method"
  | "auto_reschedule"
  | "due_date"
  | "duration_minutes"
  | "priority"
  | "parent_task_id"
  | "tags"
  | "is_recurring"
  | "recurrence_rule"
>;

/**
 * Input type for updating an existing task
 */
export type UpdateTaskInput = Partial<CreateTaskInput> & {
  id: string;
  scheduled_start?: string;
  scheduled_end?: string;
  status?: TaskStatus;
};

// ===========================================
// CALENDAR TYPES
// ===========================================

/**
 * Calendar event synced from Google Calendar
 * Represents busy times in user's schedule
 */
export interface CalendarEvent {
  id: string; // UUID (our database ID)
  user_id: string; // References auth.users(id)
  google_event_id: string; // Google's event ID (unique)
  title: string; // Event name
  start_time: string; // ISO 8601 timestamp
  end_time: string; // ISO 8601 timestamp
  all_day: boolean; // True for all-day events
  synced_at: string; // ISO 8601 timestamp (last sync time)
}

/**
 * Time slot generated by scheduling algorithm
 * Represents a possible time to schedule a task
 */
export interface TimeSlot {
  start: string; // ISO 8601 timestamp
  end: string; // ISO 8601 timestamp
  score: number; // 0-100, how well this slot matches user's personality
  reason: string; // AI-generated explanation (e.g., "This is during your peak focus time")
}

// ===========================================
// SCHEDULING ALGORITHM TYPES
// ===========================================

/**
 * Input data for scheduling algorithm
 */
export interface SchedulingInput {
  task: Task;
  userProfile: UserProfile;
  existingEvents: CalendarEvent[]; // Busy times to avoid
  existingTasks: Task[]; // Already scheduled tasks
  lookAheadDays?: number; // How many days to search (default: 14)
}

/**
 * Output from scheduling algorithm
 * Contains ranked time slot options
 */
export interface SchedulingOutput {
  slots: TimeSlot[]; // 3-5 best options, sorted by score (highest first)
  explanation: string; // Overall reasoning for these suggestions
  metadata: {
    total_slots_evaluated: number;
    search_window_days: number;
    personality_factors_used: string[]; // Which personality traits influenced the result
  };
}

// ===========================================
// USER PATTERNS & ANALYTICS
// ===========================================

/**
 * Computed patterns from user's calendar data
 * Used to improve scheduling over time
 */
export interface UserPatterns {
  id: string; // UUID
  user_id: string; // References auth.users(id)
  busy_days: {
    // Average events per day of week (0 = Sunday, 6 = Saturday)
    [key: number]: number; // e.g., { 1: 5.2, 2: 6.1, ... }
  };
  preferred_hours: {
    // Hours with most scheduled tasks (0-23)
    [key: number]: number; // e.g., { 9: 12, 10: 15, ... } (count of tasks)
  };
  avg_weekly_hours: {
    work: number; // Average hours of work/tasks per week
    free: number; // Average free hours per week
  };
  last_computed: string; // ISO 8601 timestamp (when these stats were calculated)
}

// ===========================================
// GOOGLE CALENDAR API TYPES
// ===========================================

/**
 * Google Calendar OAuth tokens
 */
export interface GoogleCalendarTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number; // Unix timestamp (milliseconds)
  token_type: string; // "Bearer"
  scope: string; // Space-separated scopes
}

/**
 * Google Calendar event from API
 * (Simplified version of Google's full event object)
 */
export interface GoogleCalendarEvent {
  id: string;
  summary: string; // Title
  description?: string;
  start: {
    dateTime?: string; // ISO 8601 for timed events
    date?: string; // YYYY-MM-DD for all-day events
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  status: "confirmed" | "tentative" | "cancelled";
}

// ===========================================
// OPENAI API TYPES
// ===========================================

/**
 * Input for AI explanation generation
 * Sent to Supabase Edge Function (NOT directly to OpenAI)
 */
export interface AIExplanationInput {
  userProfile: UserProfile;
  task: Task;
  timeSlot: TimeSlot;
}

/**
 * Response from AI explanation generation
 */
export interface AIExplanationOutput {
  explanation: string; // Personalized explanation (max 150 chars)
  confidence: number; // 0-1, how confident the AI is in this recommendation
}

// ===========================================
// UTILITY TYPES
// ===========================================

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
}

/**
 * Loading state helper
 */
export interface LoadingState {
  isLoading: boolean;
  error: string | null;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// ===========================================
// COMPONENT PROP TYPES
// ===========================================

/**
 * Props for TaskCard component
 */
export interface TaskCardProps {
  task: Task;
  onPress?: () => void;
  onComplete?: () => void;
  onReschedule?: () => void;
}

/**
 * Props for TimeSlotPicker component
 */
export interface TimeSlotPickerProps {
  slots: TimeSlot[];
  onSelectSlot: (slot: TimeSlot) => void;
  selectedSlot?: TimeSlot;
  isLoading?: boolean;
}

/**
 * Props for PersonalitySlider component
 */
export interface PersonalitySliderProps {
  label: string; // e.g., "Chronotype"
  leftLabel: string; // e.g., "Night Owl"
  rightLabel: string; // e.g., "Early Bird"
  value: number; // 0-100
  onChange: (value: number) => void;
  icon?: string; // Icon name from @expo/vector-icons
}

// ===========================================
// FORM TYPES
// ===========================================

/**
 * Form state for adding a task
 */
export interface TaskFormState {
  title: string;
  description: string;
  duration_minutes: number;
  due_date: Date | null;
  priority: TaskPriority;
  scheduling_method: SchedulingMethod;
  auto_reschedule: boolean;
}

/**
 * Validation errors for forms
 */
export interface FormErrors {
  [key: string]: string | undefined;
}

// ===========================================
// NAVIGATION TYPES (Expo Router)
// ===========================================

/**
 * Stack param list for typed navigation
 */
export type RootStackParamList = {
  "(auth)/login": undefined;
  "(auth)/onboarding": undefined;
  "(tabs)/home": undefined;
  "(tabs)/add-task": { taskId?: string }; // Optional taskId for editing
  "(tabs)/settings": undefined;
};
