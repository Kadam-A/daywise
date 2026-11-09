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

  // OPTIONAL: Peak energy windows (replaces chronotype slider in UI; max 2 entries)
  peak_windows?: Array<{
    start: number; // hour 0-23 (inclusive start)
    end: number;   // hour 0-23 (exclusive end, e.g. {start:9,end:12} = 9am–12pm)
  }>;

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
  id: string;
  display_name: string | null;
  personality_data: PersonalityData;
  // Dedicated auto-reschedule columns (not in personality_data JSONB)
  auto_reschedule_enabled: boolean;
  auto_reschedule_morning: number;    // minutes from midnight, default 540
  auto_reschedule_evening: number;    // minutes from midnight, default 1140
  auto_reschedule_tz_name: string | null;   // IANA e.g. "America/New_York" (DST-aware)
  auto_reschedule_tz_offset: number | null; // fallback numeric offset (hours)
  preferences: {
    theme?: "light" | "dark" | "system";
    notifications_enabled?: boolean;
    default_task_duration?: number;
    work_days?: number[];
  };
  created_at: string;
  updated_at: string;
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
 * Task type - cognitive demands for energy-based scheduling
 * Used to match tasks with appropriate times based on energy levels
 */
export type TaskType =
  | "deep_work"      // High cognitive load, needs peak energy (coding, writing, analysis)
  | "admin"          // Low cognitive load, routine tasks (emails, filing, data entry)
  | "creative"       // Creative work, needs mental freshness (brainstorming, design)
  | "communication"  // Meetings, calls, collaborative work
  | "quick_task";    // 5-15 min tasks, can be done anytime

/**
 * Core task object
 */
export interface Task {
  id: string; // UUID
  user_id: string; // References auth.users(id)
  title: string; // Task name (max 200 chars)
  description?: string; // Optional details
  scheduling_method: SchedulingMethod;
  due_date?: string; // ISO 8601 timestamp (deadline)
  duration_minutes: number; // How long the task takes (5-480 mins)
  scheduled_start?: string; // ISO 8601 timestamp (when task is scheduled)
  scheduled_end?: string; // ISO 8601 timestamp (calculated from start + duration)
  status: TaskStatus;
  priority: TaskPriority;
  task_type?: TaskType; // Cognitive type for energy-based scheduling
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
  auto_reschedule?: boolean; // If false, never auto-reschedule this task
}

/**
 * Recurrence rule for repeating tasks (simplified)
 */
export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly";
  days?: number[]; // For weekly: 1=Mon, 2=Tue, ..., 7=Sun
  end_count?: number; // If set, stop generating after this many total instances
}

/**
 * Input type for creating a new task
 */
export type CreateTaskInput = Pick<
  Task,
  | "title"
  | "description"
  | "scheduling_method"
  | "due_date"
  | "duration_minutes"
  | "priority"
  | "task_type"
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
  factors?: SchedulingFactor[]; // Breakdown of factors that influenced the score
}

/**
 * Individual factor that influenced a slot's score
 */
export interface SchedulingFactor {
  name: string; // Factor name (e.g., "chronotype", "deadline_style")
  impact: number; // Score impact (-40 to +15)
  description: string; // Human-readable explanation
  icon?: string; // Optional icon name
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

// ===========================================
// SUBSCRIPTION TYPES
// ===========================================

/**
 * Available subscription plan IDs
 */
export type PlanId = 'free' | 'pro_monthly' | 'pro_yearly';

/**
 * Subscription status
 */
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'trial';

/**
 * User subscription record
 */
export interface UserSubscription {
  id: string;
  user_id: string;
  plan_id: PlanId;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  revenuecat_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Features available for each plan
 */
export interface PlanFeatures {
  ai_scheduling: boolean;
  recurring_tasks: number;       // -1 = unlimited
  task_history_days: number;     // -1 = unlimited
  auto_reschedule_per_week: number; // -1 = unlimited, 0 = not available (free)
}

/**
 * Subscription plan details
 */
export interface SubscriptionPlan {
  id: PlanId;
  name: string;
  price_cents: number;
  interval: 'month' | 'year' | null;
  features: PlanFeatures;
}

// ===========================================
// ANALYTICS TYPES
// ===========================================

/**
 * Analytics event names
 */
export type AnalyticsEventName =
  | 'task_created'
  | 'task_completed'
  | 'task_scheduled'
  | 'task_deleted'
  | 'scheduling_method_selected'
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'paywall_viewed'
  | 'paywall_dismissed'
  | 'purchase_started'
  | 'purchase_completed'
  | 'purchase_failed'
  | 'purchase_restored'
  | 'trial_started'
  | 'trial_ended'
  | 'calendar_synced'
  | 'calendar_sync_failed'
  | 'app_opened'
  | 'app_backgrounded'
  // Review & Feedback events
  | 'happiness_check_shown'
  | 'happiness_response'
  | 'review_submitted'
  | 'feedback_submitted'
  | 'feedback_skipped'
  | 'review_trial_granted'
  // Onboarding & guided tour events
  | 'onboarding_step_completed'
  | 'onboarding_screen_viewed'
  | 'guided_tour_started'
  | 'guided_tour_completed'
  | 'tour_step_viewed'
  | 'tour_skipped'
  | 'tour_completed'
  | 'onboarding_abandoned'
  | 'guided_tour_ai_scheduled'
  // User events
  | 'user_signed_in'
  | 'user_signed_out'
  // Settings events
  | 'settings_updated'
  // Task events
  | 'task_rescheduled'
  // Post-onboarding flow events
  | 'first_task_screen_viewed'
  | 'first_task_scheduled'
  | 'post_onboarding_tooltip_1_seen'
  | 'post_onboarding_tooltip_2_seen'
  | 'post_onboarding_tooltip_3_seen'
  | 'post_onboarding_tooltips_completed'
  | 'trial_skipped';

/**
 * User funnel tracking record
 */
export interface UserFunnel {
  user_id: string;
  installed_at: string;
  onboarding_completed_at: string | null;
  first_task_at: string | null;
  first_schedule_at: string | null;
  first_completion_at: string | null;
  converted_to_paid_at: string | null;
  day_7_active: boolean;
  day_30_active: boolean;
}

/**
 * Analytics event record
 */
export interface AnalyticsEvent {
  id: string;
  user_id: string;
  event_name: AnalyticsEventName;
  event_data: Record<string, any> | null;
  created_at: string;
}

// ===========================================
// USER STATS TYPES
// ===========================================

/**
 * User stats returned by get_user_stats() function
 */
export interface UserStats {
  tasks_completed_today: number;
  tasks_completed_yesterday: number;
  tasks_completed_week: number;
  tasks_total_week: number;
  tasks_completed_month: number;
  tasks_completed_last_month: number;
  total_tasks: number;
  total_completed: number;
  smart_scheduled_count: number;
  manual_scheduled_count: number;
  current_streak: number;
  best_streak: number;
  completion_rate: number; // 0-100 percentage (last 30 days)
}

/**
 * Daily completion data for trend chart (Pro)
 */
export interface DailyCompletion {
  date: string; // YYYY-MM-DD
  count: number;
}

/**
 * Hourly productivity data (Pro only)
 */
export interface HourlyProductivity {
  hour: number; // 0-23
  count: number;
}

/**
 * Weekday productivity data (Pro only)
 */
export interface WeekdayProductivity {
  day: number; // 0-6 (Sunday-Saturday)
  day_name: string; // "Sun", "Mon", etc.
  count: number;
}

// ===========================================
// FEEDBACK TYPES
// ===========================================

/**
 * Feedback category options
 */
export type FeedbackCategory =
  | 'missing_feature'
  | 'bug'
  | 'hard_to_use'
  | 'ai_issue'
  | 'calendar_issue'
  | 'pricing'
  | 'other';

/**
 * Trigger point for feedback submission
 */
export type FeedbackTriggerPoint = 'review_flow' | 'settings';

/**
 * Sentiment classification
 */
export type FeedbackSentiment = 'positive' | 'neutral' | 'negative';

/**
 * Feedback submission data
 */
export interface FeedbackData {
  category: FeedbackCategory;
  subcategory?: string;
  trigger_point: FeedbackTriggerPoint;
  sentiment?: FeedbackSentiment;
  rating?: number; // 1-5
  text_feedback?: string;
  user_email?: string;
  wants_follow_up?: boolean;
  include_logs?: boolean;
}

/**
 * Device info for feedback metadata
 */
export interface DeviceInfo {
  platform: string; // 'ios' | 'android'
  os_version: string;
  device_model: string;
  app_version: string;
}

/**
 * Happiness check response options
 */
export type HappinessResponse = 'loving_it' | 'its_okay';

/**
 * Extended user funnel with review tracking
 */
export interface UserFunnelWithReview extends UserFunnel {
  review_request_shown: boolean;
  review_request_shown_at: string | null;
  review_submitted: boolean;
  review_submitted_at: string | null;
  happiness_response: HappinessResponse | null;
}
