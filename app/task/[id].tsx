/**
 * Task Detail Screen - "Fluid Intelligence" Design
 *
 * Shows task details with actions:
 * - Edit task
 * - Mark Complete
 * - Reschedule
 * - Delete
 */

import { View, StyleSheet, ScrollView, Alert, Pressable, Animated, KeyboardAvoidingView, Platform, Keyboard } from "react-native";
import {
  Text,
  Button,
  Surface,
  Chip,
  ProgressBar,
  IconButton,
  Divider,
  ActivityIndicator,
  Checkbox,
  TextInput,
  useTheme,
} from "react-native-paper";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState, useEffect, useCallback, useRef } from "react";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { format, addDays, endOfDay, isAfter, startOfDay } from "date-fns";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "@/lib/supabase";
import { Task, TimeSlot, UserProfile, CalendarEvent } from "@/lib/types";
import SchedulingModal from "@/components/SchedulingModal";
import { scheduleTask } from "@/lib/scheduling";
import {
  safeCreateCalendarEvent,
  safeUpdateCalendarEvent,
  safeDeleteCalendarEvent,
} from "@/lib/google-calendar";
import { scheduleTaskReminder, cancelTaskReminder } from "@/lib/notifications";
import {
  generateNextInstance,
  isRecurringInstance,
  getRecurrenceDescription,
} from "@/lib/recurrence";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAppColors } from "@/contexts/ThemeContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { queueOperation } from "@/lib/offline";
import { trackTaskCompleted, trackTaskDeleted, trackTaskRescheduled } from "@/lib/analytics";
import { trackFeedbackSkipped } from "@/lib/feedback";
import {
  incrementCompletedTaskCount,
  checkHappinessFlowEligibility,
  onHappinessCheckShown,
  handleHappinessResponse,
  handleFeedbackFormComplete,
} from "@/lib/review";
import HappinessCheckModal from "@/components/HappinessCheckModal";
import FeedbackFormModal from "@/components/FeedbackFormModal";
import SchedulingFeedbackModal from "@/components/SchedulingFeedbackModal";
import Toast from "react-native-toast-message";
import { HappinessResponse } from "@/lib/types";

// Static colors for StyleSheet (can't use useTheme in StyleSheet.create)
const COLORS = {
  primary: "#4A90E2",
  secondary: "#7C6FBF",
  background: "#F8F9FB",
  surface: "#FFFFFF",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  success: "#5FBF73",
  warning: "#F5A962",
  error: "#E25555",
  border: "#E5E7EB",
  priorityHigh: "#E25555",
  priorityMedium: "#F5A962",
  priorityLow: "#5FBF73",
  aiPurple: "#7C6FBF",
  aiPurpleLight: "#F3F0FF",
};

const DURATION_PRESETS = [
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
  { value: "120", label: "2h" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low", icon: "flag-outline" },
  { value: "medium", label: "Medium", icon: "flag" },
  { value: "high", label: "High", icon: "flag-variant" },
];

export default function TaskDetailScreen() {
  const { colors } = useTheme();
  const appColors = useAppColors();
  const insets = useSafeAreaInsets();
  const { id, reschedule } = useLocalSearchParams<{ id: string; reschedule?: string }>();
  const { isConnected } = useNetwork();
  const { isPro } = useSubscription();

  // Navigate back to home
  const goBack = () => {
    router.replace("/(tabs)/home");
  };
  const [task, setTask] = useState<Task | null>(null);
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editPriority, setEditPriority] = useState<"low" | "medium" | "high">("medium");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState("");
  const [editDueDate, setEditDueDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [editSchedulingMethod, setEditSchedulingMethod] = useState<"SMART" | "MANUAL">("SMART");
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [expandedEditField, setExpandedEditField] = useState<string | null>(null);
  const toggleEditField = (field: string) => {
    if (expandedEditField === field) Keyboard.dismiss();
    setExpandedEditField(prev => prev === field ? null : field);
  };
  const scrollViewRef = useRef<ScrollView>(null);

  // Subtask state
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);

  // Reschedule modal state
  const [rescheduleMethod, setRescheduleMethod] = useState<"SMART" | "MANUAL" | null>(null);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleSlots, setRescheduleSlots] = useState<TimeSlot[]>([]);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [busySlots, setBusySlots] = useState<
    { start: string; end: string; title: string }[]
  >([]);

  // Happiness check / review flow state
  const [showHappinessCheck, setShowHappinessCheck] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [happinessTasksCompleted, setHappinessTasksCompleted] = useState(5);

  // Scheduling feedback modal state (shown for AI-scheduled tasks)
  const [showSchedulingFeedback, setShowSchedulingFeedback] = useState(false);

  // Track whether reschedule modal has already been opened via ?reschedule=true
  const rescheduleModalOpened = useRef(false);

  // Load task on focus
  useFocusEffect(
    useCallback(() => {
      loadTask();
    }, [id])
  );

  // Auto-trigger reschedule if navigated with ?reschedule=true (once only)
  useEffect(() => {
    if (reschedule === "true" && task && !loading && !rescheduleModalOpened.current) {
      rescheduleModalOpened.current = true;
      setRescheduleMethod(null);
      setRescheduleSlots([]);
      setRescheduleError(null);
      setShowRescheduleModal(true);
    }
  }, [reschedule, task?.id, loading]);

  const loadTask = async () => {
    if (!id) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      setTask(data as Task);

      // If this is a parent task, load subtasks
      if (!data.parent_task_id) {
        const { data: subtaskData } = await supabase
          .from("tasks")
          .select("*")
          .eq("parent_task_id", id)
          .order("subtask_order", { ascending: true });

        setSubtasks((subtaskData || []) as Task[]);
      }
    } catch (err) {
      console.error("[TaskDetail] Load error:", err);
      Alert.alert("Error", "Failed to load task");
      goBack();
    } finally {
      setLoading(false);
    }
  };

  // Load existing tags for autocomplete
  const loadExistingTags = async () => {
    try {
      const { data: tasks } = await supabase
        .from("tasks")
        .select("tags")
        .not("tags", "eq", "{}");

      if (tasks) {
        const allTags = new Set<string>();
        tasks.forEach((t) => {
          if (t.tags) {
            t.tags.forEach((tag: string) => allTags.add(tag));
          }
        });
        setExistingTags(Array.from(allTags).sort());
      }
    } catch (err) {
      console.error("[TaskDetail] Error loading tags:", err);
    }
  };

  const startEditing = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDescription(task.description || "");
    setEditDuration(task.duration_minutes.toString());
    setEditPriority(task.priority);
    setEditTags(task.tags || []);
    setEditDueDate(task.due_date ? new Date(task.due_date) : null);
    setEditSchedulingMethod(task.scheduling_method as "SMART" | "MANUAL");
    setEditTagInput("");
    loadExistingTags();
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setShowDatePicker(false);
  };

  const addEditTag = (tag: string) => {
    const trimmedTag = tag.trim().toLowerCase();
    if (trimmedTag && !editTags.includes(trimmedTag)) {
      setEditTags([...editTags, trimmedTag]);
    }
    setEditTagInput("");
  };

  const removeEditTag = (tagToRemove: string) => {
    setEditTags(editTags.filter((t) => t !== tagToRemove));
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === "ios");
    if (selectedDate) {
      setEditDueDate(endOfDay(selectedDate));
    }
  };

  const saveEdits = async () => {
    if (!task || !editTitle.trim()) return;

    const durationNum = parseInt(editDuration);
    if (isNaN(durationNum) || durationNum < 5 || durationNum > 480) {
      Alert.alert("Invalid Duration", "Duration must be between 5 and 480 minutes");
      return;
    }

    try {
      setSaveLoading(true);

      // Recalculate scheduled_end if task is already scheduled so the time block
      // matches the new duration immediately without needing a reschedule
      const newScheduledEnd = task.scheduled_start
        ? new Date(new Date(task.scheduled_start).getTime() + durationNum * 60 * 1000).toISOString()
        : undefined;

      const { error } = await supabase
        .from("tasks")
        .update({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          duration_minutes: durationNum,
          priority: editPriority,
          tags: editTags.length > 0 ? editTags : [],
          ...(editDueDate ? { due_date: editDueDate.toISOString() } : {}),
          scheduling_method: editSchedulingMethod,
          ...(newScheduledEnd ? { scheduled_end: newScheduledEnd } : {}),
        })
        .eq("id", task.id);

      if (error) throw error;

      setIsEditing(false);
      await loadTask(); // Re-fetch so UI always reflects DB truth
    } catch (err) {
      console.error("[TaskDetail] Save error:", err);
      Alert.alert("Error", "Failed to save changes");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!task) return;

    try {
      setActionLoading(true);

      // Cancel any scheduled notification
      await cancelTaskReminder(task.id);

      // Optimistic update
      setTask({ ...task, status: "completed" });

      if (!isConnected) {
        // Queue operation for when back online
        await queueOperation("complete_task", { taskId: task.id });
        console.log("[TaskDetail] Queued complete_task for offline sync");
        goBack();
        return;
      }

      const { error } = await supabase
        .from("tasks")
        .update({ status: "completed" })
        .eq("id", task.id);

      if (error) throw error;

      // If this is a recurring task instance, generate the next instance
      if (isRecurringInstance(task)) {
        // Fetch the parent recurring task
        const { data: parentTask } = await supabase
          .from("tasks")
          .select("*")
          .eq("id", task.recurrence_parent_id)
          .single();

        if (parentTask) {
          // Count existing instances to enforce end_count
          const { count } = await supabase
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .eq("recurrence_parent_id", task.recurrence_parent_id);

          const nextInstance = generateNextInstance(
            parentTask as Task,
            task.instance_date,
            (count ?? 0) + 1
          );

          if (nextInstance) {
            await supabase.from("tasks").insert(nextInstance);
            console.log("[TaskDetail] Generated next recurring instance");
          } else {
            console.log("[TaskDetail] Recurring end_count reached — no new instance");
          }
        }
      }

      // Track analytics
      await trackTaskCompleted();
      await incrementCompletedTaskCount();

      // Show scheduling feedback modal for AI-scheduled tasks
      if (task.scheduling_method === "SMART" && task.scheduled_start) {
        setShowSchedulingFeedback(true);
        // Don't proceed yet - wait for feedback modal
        return;
      }

      // Check if eligible for happiness check flow
      const eligibility = await checkHappinessFlowEligibility();
      if (eligibility.eligible) {
        // Show happiness check modal instead of going back immediately
        setHappinessTasksCompleted(eligibility.tasksCompleted);
        setShowHappinessCheck(true);
        // Don't go back yet - wait for modal response
        return;
      }

      // Go back after completing
      goBack();
    } catch (err) {
      console.error("[TaskDetail] Complete error:", err);
      // Revert optimistic update
      setTask({ ...task, status: task.status });
      Alert.alert("Error", "Failed to complete task");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Task",
      "Are you sure you want to delete this task? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: confirmDelete,
        },
      ]
    );
  };

  const confirmDelete = async () => {
    if (!task) return;

    try {
      setActionLoading(true);

      // Cancel any scheduled notification
      await cancelTaskReminder(task.id);

      if (!isConnected) {
        // Queue operation for when back online
        await queueOperation("delete_task", { taskId: task.id });
        console.log("[TaskDetail] Queued delete_task for offline sync");
        goBack();
        return;
      }

      // Delete Google Calendar event if exists using safe function
      if (task.google_event_id) {
        const result = await safeDeleteCalendarEvent(task.google_event_id);
        if (!result.success && result.needsRetry) {
          console.log("[TaskDetail] Calendar delete pending, will retry later");
        }
      }

      const { error } = await supabase.from("tasks").delete().eq("id", task.id);

      if (error) throw error;

      trackTaskDeleted(); // fire-and-forget
      goBack();
    } catch (err) {
      console.error("[TaskDetail] Delete error:", err);
      Alert.alert("Error", "Failed to delete task");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteAllRecurrences = () => {
    Alert.alert(
      "Complete All",
      "Mark all remaining instances of this recurring task as complete?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Complete All", onPress: confirmCompleteAll },
      ]
    );
  };

  const confirmCompleteAll = async () => {
    if (!task?.recurrence_parent_id) return;
    try {
      setActionLoading(true);
      await supabase.from("tasks")
        .update({ status: "completed" })
        .eq("recurrence_parent_id", task.recurrence_parent_id)
        .in("status", ["pending_schedule", "scheduled", "in_progress"]);
      await supabase.from("tasks")
        .delete()
        .eq("id", task.recurrence_parent_id);
      goBack();
    } catch (err) {
      console.error("[TaskDetail] Complete all recurrences error:", err);
      Alert.alert("Error", "Failed to complete all recurrences");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAllRecurrences = () => {
    Alert.alert(
      "Delete All",
      "Delete this task and all its recurring instances? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete All", style: "destructive", onPress: confirmDeleteAll },
      ]
    );
  };

  const confirmDeleteAll = async () => {
    if (!task?.recurrence_parent_id) return;
    try {
      setActionLoading(true);
      await supabase.from("tasks")
        .delete()
        .eq("recurrence_parent_id", task.recurrence_parent_id);
      await supabase.from("tasks")
        .delete()
        .eq("id", task.recurrence_parent_id);
      goBack();
    } catch (err) {
      console.error("[TaskDetail] Delete all recurrences error:", err);
      Alert.alert("Error", "Failed to delete all recurrences");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReschedule = () => {
    if (!task) return;
    setRescheduleMethod(null);
    setRescheduleSlots([]);
    setRescheduleError(null);
    setShowRescheduleModal(true);
  };

  const handleMethodChoice = async (method: "SMART" | "MANUAL") => {
    if (!task) return;
    setRescheduleMethod(method);

    if (method === "SMART") {
      await runSmartReschedule();
    } else {
      await loadBusySlots();
    }
  };

  // Subtask functions
  const handleAddSubtask = async () => {
    if (!task || !newSubtaskTitle.trim()) return;

    try {
      setAddingSubtask(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const newSubtask = {
        user_id: user.id,
        title: newSubtaskTitle.trim(),
        parent_task_id: task.id,
        subtask_order: subtasks.length,
        duration_minutes: 15, // Default 15 min for subtasks
        priority: task.priority,
        scheduling_method: "MANUAL",
        status: "pending_schedule",
      };

      const { data, error } = await supabase
        .from("tasks")
        .insert(newSubtask)
        .select()
        .single();

      if (error) throw error;

      setSubtasks([...subtasks, data as Task]);
      setNewSubtaskTitle("");
      setShowAddSubtask(false);
    } catch (err) {
      console.error("[TaskDetail] Add subtask error:", err);
      Alert.alert("Error", "Failed to add subtask");
    } finally {
      setAddingSubtask(false);
    }
  };

  const handleToggleSubtask = async (subtask: Task) => {
    try {
      const newStatus = subtask.status === "completed" ? "pending_schedule" : "completed";

      const { error } = await supabase
        .from("tasks")
        .update({ status: newStatus })
        .eq("id", subtask.id);

      if (error) throw error;

      // Update local state
      const updatedSubtasks = subtasks.map((s) =>
        s.id === subtask.id ? { ...s, status: newStatus as Task["status"] } : s
      );
      setSubtasks(updatedSubtasks);

      // Check if all subtasks are complete
      const allComplete = updatedSubtasks.every((s) => s.status === "completed");
      if (allComplete && updatedSubtasks.length > 0 && task?.status !== "completed") {
        // Auto-complete parent
        await supabase
          .from("tasks")
          .update({ status: "completed" })
          .eq("id", task!.id);

        setTask({ ...task!, status: "completed" });
        trackTaskCompleted(); // fire-and-forget
      }
    } catch (err) {
      console.error("[TaskDetail] Toggle subtask error:", err);
      Alert.alert("Error", "Failed to update subtask");
    }
  };

  const getSubtaskProgress = () => {
    if (subtasks.length === 0) return 0;
    const completed = subtasks.filter((s) => s.status === "completed").length;
    return completed / subtasks.length;
  };

  // Happiness check flow handlers
  const onHappinessResponse = async (response: HappinessResponse) => {
    // Mark as shown and track
    await onHappinessCheckShown();

    // Handle the response
    const result = await handleHappinessResponse(response);

    if (result.action === "show_native_review") {
      // Happy user - native review already triggered, show thank you
      setShowHappinessCheck(false);
      if (result.trialGranted) {
        Toast.show({
          type: "success",
          text1: "Thanks for your support!",
          text2: "Enjoy 7 days of Pro features",
          position: "bottom",
          visibilityTime: 3000,
        });
      }
      // Go back after a short delay to let user see the toast
      setTimeout(() => goBack(), 500);
    } else {
      // Unhappy user - show feedback form
      setShowHappinessCheck(false);
      setShowFeedbackForm(true);
    }
  };

  const onFeedbackSubmit = async () => {
    // User submitted feedback
    const result = await handleFeedbackFormComplete(true);
    setShowFeedbackForm(false);

    if (result.trialGranted) {
      Toast.show({
        type: "success",
        text1: "Thanks for your feedback!",
        text2: "Enjoy 7 days of Pro features",
        position: "bottom",
        visibilityTime: 3000,
      });
    }

    setTimeout(() => goBack(), 500);
  };

  const onFeedbackSkip = async () => {
    // User skipped feedback but still gets trial
    await trackFeedbackSkipped();
    const result = await handleFeedbackFormComplete(false);
    setShowFeedbackForm(false);

    if (result.trialGranted) {
      Toast.show({
        type: "success",
        text1: "Thanks anyway!",
        text2: "Enjoy 7 days of Pro features",
        position: "bottom",
        visibilityTime: 3000,
      });
    }

    setTimeout(() => goBack(), 500);
  };

  // Handler for when scheduling feedback modal is complete
  const onSchedulingFeedbackComplete = async () => {
    setShowSchedulingFeedback(false);

    // Now check if eligible for happiness check flow
    const eligibility = await checkHappinessFlowEligibility();
    if (eligibility.eligible) {
      setHappinessTasksCompleted(eligibility.tasksCompleted);
      setShowHappinessCheck(true);
      return;
    }

    // Otherwise go back
    goBack();
  };

  const getSubtaskProgressText = () => {
    const completed = subtasks.filter((s) => s.status === "completed").length;
    return `${completed}/${subtasks.length} complete`;
  };

  const runSmartReschedule = async () => {
    if (!task) return;

    try {
      setRescheduleLoading(true);
      setRescheduleError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Fetch user profile
      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileError) throw profileError;

      // Fetch existing tasks (exclude current task)
      const { data: existingTasks, error: tasksError } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["scheduled", "pending_schedule"])
        .neq("id", task.id);

      if (tasksError) throw tasksError;

      // Fetch calendar events
      const { data: calendarEvents } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", user.id)
        .gte("end_time", new Date().toISOString());

      // Run scheduling algorithm + AI
      const daysUntilDue = task.due_date
        ? Math.max(1, Math.ceil((new Date(task.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 14;

      const result = await scheduleTask({
        task,
        userProfile: profile as UserProfile,
        existingEvents: (calendarEvents || []) as CalendarEvent[],
        existingTasks: (existingTasks || []) as Task[],
        lookAheadDays: Math.min(daysUntilDue, 14),
      });

      setRescheduleSlots(result.slots);
    } catch (err) {
      console.error("[TaskDetail] Reschedule error:", err);
      setRescheduleError(
        err instanceof Error ? err.message : "Failed to find available times"
      );
    } finally {
      setRescheduleLoading(false);
    }
  };

  const loadBusySlots = async () => {
    try {
      setRescheduleLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Get scheduled tasks (exclude current)
      const { data: tasks } = await supabase
        .from("tasks")
        .select("title, scheduled_start, scheduled_end")
        .eq("user_id", user.id)
        .eq("status", "scheduled")
        .neq("id", task?.id || "")
        .not("scheduled_start", "is", null);

      // Get calendar events
      const { data: events } = await supabase
        .from("calendar_events")
        .select("title, start_time, end_time")
        .eq("user_id", user.id)
        .gte("end_time", new Date().toISOString());

      const busy: { start: string; end: string; title: string }[] = [];

      tasks?.forEach((t) => {
        if (t.scheduled_start && t.scheduled_end) {
          busy.push({
            start: t.scheduled_start,
            end: t.scheduled_end,
            title: t.title,
          });
        }
      });

      events?.forEach((e) => {
        busy.push({
          start: e.start_time,
          end: e.end_time,
          title: e.title,
        });
      });

      setBusySlots(busy);
    } catch (err) {
      console.error("[TaskDetail] Load busy slots error:", err);
    } finally {
      setRescheduleLoading(false);
    }
  };

  const handleSelectSlot = async (slot: TimeSlot) => {
    if (!task) return;

    try {
      setRescheduleLoading(true);

      let googleEventId = task.google_event_id;

      // Update or create Google Calendar event using safe functions
      if (googleEventId) {
        // Update existing event
        const result = await safeUpdateCalendarEvent(
          googleEventId,
          task.title,
          task.description,
          slot.start,
          slot.end
        );
        if (!result.success && result.needsRetry) {
          console.log("[TaskDetail] Calendar update pending, will retry later");
        }
      } else {
        // Create new event
        const result = await safeCreateCalendarEvent(
          task.title,
          task.description,
          slot.start,
          slot.end
        );
        if (result.success && result.eventId) {
          googleEventId = result.eventId;
        } else if (result.needsRetry) {
          console.log("[TaskDetail] Calendar create pending, will retry later");
        }
      }

      // Update due_date: set to slot day if due_date is today/past or slot is after due_date,
      // otherwise preserve the original deadline.
      const slotDay = startOfDay(new Date(slot.start));
      const today = startOfDay(new Date());
      const currentDueDay = task.due_date ? startOfDay(new Date(task.due_date)) : null;
      const newDueDate =
        !currentDueDay ||
        !isAfter(currentDueDay, today) ||
        isAfter(slotDay, currentDueDay)
          ? format(slotDay, "yyyy-MM-dd")
          : task.due_date;

      // Update task with scheduled time
      const updateData: Record<string, unknown> = {
        scheduled_start: slot.start,
        scheduled_end: slot.end,
        status: "scheduled",
        due_date: newDueDate,
      };

      if (googleEventId && !task.google_event_id) {
        updateData.google_event_id = googleEventId;
      }

      const { data: updatedTask, error } = await supabase
        .from("tasks")
        .update(updateData)
        .eq("id", task.id)
        .select()
        .single();

      if (error) throw error;

      // Schedule notification reminder for new time
      if (updatedTask) {
        await scheduleTaskReminder(updatedTask as Task);
      }

      trackTaskRescheduled('modal'); // fire-and-forget
      setShowRescheduleModal(false);

      // If navigated here with ?reschedule=true, go back to home after success
      if (reschedule === "true") {
        goBack();
        return;
      }

      loadTask(); // Reload task with new time
    } catch (err) {
      console.error("[TaskDetail] Reschedule update error:", err);
      setRescheduleError(
        err instanceof Error ? err.message : "Failed to reschedule task"
      );
    } finally {
      setRescheduleLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatTimeRange = (start: string, end: string) => {
    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return appColors.priorityHigh;
      case "medium":
        return appColors.priorityMedium;
      case "low":
        return appColors.priorityLow;
      default:
        return appColors.textTertiary;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return appColors.primary;
      case "completed":
        return appColors.success;
      case "overdue":
        return appColors.error;
      case "pending_schedule":
        return appColors.warning;
      default:
        return appColors.textTertiary;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "scheduled":
        return "Scheduled";
      case "completed":
        return "Completed";
      case "overdue":
        return "Overdue";
      case "pending_schedule":
        return "Needs Scheduling";
      default:
        return status;
    }
  };

  const getPriorityConfig = (priority: string) => {
    switch (priority) {
      case "high": return { color: appColors.priorityHigh, label: "High", icon: "flag-variant" };
      case "medium": return { color: appColors.priorityMedium, label: "Medium", icon: "flag" };
      case "low": return { color: appColors.priorityLow, label: "Low", icon: "flag-outline" };
      default: return { color: appColors.textTertiary, label: priority, icon: "flag-outline" };
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={appColors.primary} />
          <Text style={[styles.loadingText, { color: appColors.textSecondary }]}>Loading task...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!task) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
        <View style={styles.loadingContainer}>
          <Text style={[styles.notFoundText, { color: appColors.textSecondary }]}>Task not found</Text>
          <Pressable style={[styles.goBackButton, { backgroundColor: appColors.primary }]} onPress={() => goBack()}>
            <Text style={styles.goBackText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const priorityConfig = getPriorityConfig(task.priority);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={[styles.header, { backgroundColor: isEditing ? appColors.background : appColors.surface, borderBottomColor: isEditing ? "transparent" : appColors.border }]}>
          <Pressable onPress={() => goBack()} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={appColors.textPrimary} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: appColors.textPrimary }]}>
            {isEditing ? "Edit Task" : "Task Details"}
          </Text>
          {isEditing ? (
            <Pressable onPress={cancelEditing} style={styles.headerAction}>
              <Text style={[styles.cancelText, { color: appColors.textSecondary }]}>Cancel</Text>
            </Pressable>
          ) : (
            <Pressable onPress={startEditing} style={styles.headerAction}>
              <MaterialCommunityIcons name="pencil" size={22} color={appColors.primary} />
            </Pressable>
          )}
        </View>

        <ScrollView ref={scrollViewRef} style={isEditing ? styles.scrollView : styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {isEditing ? (
            <>
              {/* ── Title ── */}
              <View style={styles.titleArea}>
                <TextInput
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="Task title"
                  style={[styles.titleInput, { color: appColors.textPrimary, backgroundColor: "transparent" }]}
                  mode="flat"
                  underlineColor="transparent"
                  activeUnderlineColor="transparent"
                  placeholderTextColor={appColors.textTertiary}
                  cursorColor={appColors.primary}
                  selectionColor={`${appColors.primary}40`}
                  multiline
                  theme={{ colors: { primary: appColors.primary, onSurfaceVariant: appColors.textTertiary } }}
                />
              </View>

              <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

              {/* ── Schedule row ── */}
              <View style={styles.attrRow}>
                <View style={styles.attrRowLeft}>
                  <MaterialCommunityIcons
                    name={editSchedulingMethod === "SMART" ? "star-four-points" : "clock-outline"}
                    size={17}
                    color={editSchedulingMethod === "SMART" ? (appColors.aiPurple ?? appColors.secondary) : appColors.primary}
                  />
                  <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Schedule</Text>
                </View>
                <View style={styles.schedulePills}>
                  <Pressable
                    style={[styles.schedulePill, { backgroundColor: editSchedulingMethod === "MANUAL" ? appColors.primaryLight : appColors.inputBg }]}
                    onPress={() => setEditSchedulingMethod("MANUAL")}
                  >
                    <Text style={[styles.schedulePillText, { color: editSchedulingMethod === "MANUAL" ? appColors.primary : appColors.textTertiary, fontWeight: editSchedulingMethod === "MANUAL" ? "700" : "500" }]}>
                      Pick time
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.schedulePill, { backgroundColor: editSchedulingMethod === "SMART" && isPro ? (appColors.aiPurpleLight ?? appColors.secondaryLight) : appColors.inputBg, opacity: !isPro ? 0.6 : 1 }]}
                    onPress={() => {
                      if (isPro) {
                        setEditSchedulingMethod("SMART");
                        if (!editDueDate) setEditDueDate(endOfDay(addDays(new Date(), 1)));
                      } else {
                        router.push({ pathname: "/paywall", params: { source: "smart_scheduling" } });
                      }
                    }}
                  >
                    <MaterialCommunityIcons
                      name="star-four-points"
                      size={12}
                      color={editSchedulingMethod === "SMART" && isPro ? (appColors.aiPurple ?? appColors.secondary) : appColors.textTertiary}
                    />
                    <Text style={[styles.schedulePillText, { color: editSchedulingMethod === "SMART" && isPro ? (appColors.aiPurple ?? appColors.secondary) : appColors.textTertiary, fontWeight: editSchedulingMethod === "SMART" && isPro ? "700" : "500" }]}>
                      AI
                    </Text>
                    {!isPro && <MaterialCommunityIcons name="lock" size={10} color={appColors.textTertiary} />}
                  </Pressable>
                </View>
              </View>

              <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

              {/* ── Deadline row (SMART only) ── */}
              {editSchedulingMethod === "SMART" && (
                <>
                  <Pressable style={styles.attrRow} onPress={() => toggleEditField("deadline")}>
                    <View style={styles.attrRowLeft}>
                      <MaterialCommunityIcons
                        name="calendar-clock"
                        size={17}
                        color={editDueDate ? appColors.primary : appColors.textTertiary}
                      />
                      <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Deadline</Text>
                    </View>
                    <View style={styles.attrRowRight}>
                      <Text style={[styles.attrRowValue, { color: editDueDate ? appColors.primary : appColors.textTertiary }]}>
                        {editDueDate
                          ? (format(editDueDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd") ? "Today"
                            : format(editDueDate, "yyyy-MM-dd") === format(addDays(new Date(), 1), "yyyy-MM-dd") ? "Tomorrow"
                            : format(editDueDate, "EEE, MMM d"))
                          : "Set date"}
                      </Text>
                      <MaterialCommunityIcons
                        name={expandedEditField === "deadline" ? "chevron-up" : "chevron-right"}
                        size={16}
                        color={appColors.textTertiary}
                      />
                    </View>
                  </Pressable>
                  {expandedEditField === "deadline" && (
                    <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
                      <View style={styles.dueDateOptions}>
                        {[
                          { label: "Today", date: endOfDay(new Date()) },
                          { label: "Tomorrow", date: endOfDay(addDays(new Date(), 1)) },
                          { label: "Next Week", date: endOfDay(addDays(new Date(), 7)) },
                        ].map((item) => {
                          const isSelected = editDueDate && format(editDueDate, "yyyy-MM-dd") === format(item.date, "yyyy-MM-dd");
                          return (
                            <Pressable
                              key={item.label}
                              style={[styles.dueDateChip, { backgroundColor: appColors.background }, isSelected && { backgroundColor: appColors.primary }]}
                              onPress={() => { setEditDueDate(item.date); setExpandedEditField(null); }}
                            >
                              <Text style={[styles.dueDateChipText, { color: appColors.textTertiary }, isSelected && { color: "#FFFFFF" }]}>
                                {item.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                        <Pressable style={[styles.dueDateChip, { backgroundColor: appColors.background }]} onPress={() => setShowDatePicker(true)}>
                          <MaterialCommunityIcons name="calendar" size={16} color={appColors.textTertiary} />
                        </Pressable>
                      </View>
                      {showDatePicker && (
                        <DateTimePicker value={editDueDate || new Date()} mode="date" minimumDate={new Date()} onChange={handleDateChange} />
                      )}
                    </View>
                  )}
                  <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />
                </>
              )}

              {/* ── Duration row ── */}
              <Pressable style={styles.attrRow} onPress={() => toggleEditField("duration")}>
                <View style={styles.attrRowLeft}>
                  <MaterialCommunityIcons name="timer-outline" size={17} color={appColors.textTertiary} />
                  <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Duration</Text>
                </View>
                <View style={styles.attrRowRight}>
                  <Text style={[styles.attrRowValue, { color: appColors.textSecondary }]}>
                    {editDuration === "60" ? "1h" : editDuration === "120" ? "2h" : `${editDuration}m`}
                  </Text>
                  <MaterialCommunityIcons
                    name={expandedEditField === "duration" ? "chevron-up" : "chevron-right"}
                    size={16}
                    color={appColors.textTertiary}
                  />
                </View>
              </Pressable>
              {expandedEditField === "duration" && (
                <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
                  <View style={styles.durationGrid}>
                    {DURATION_PRESETS.map((preset) => {
                      const isActive = editDuration === preset.value;
                      return (
                        <Pressable
                          key={preset.value}
                          style={[styles.durationChip, { backgroundColor: appColors.background }, isActive && { backgroundColor: appColors.primaryLight, borderColor: appColors.primary }]}
                          onPress={() => { setEditDuration(preset.value); setExpandedEditField(null); }}
                        >
                          <Text style={[styles.durationChipText, { color: appColors.textTertiary }, isActive && { color: appColors.primary }]}>
                            {preset.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.customDurationRow}>
                    <TextInput
                      placeholder="Custom (mins)"
                      value={DURATION_PRESETS.some(p => p.value === editDuration) ? "" : editDuration}
                      onChangeText={setEditDuration}
                      style={[styles.customDurationInput, { backgroundColor: appColors.background }]}
                      mode="outlined"
                      keyboardType="numeric"
                      outlineColor={appColors.border}
                      activeOutlineColor={appColors.primary}
                      textColor={appColors.textPrimary}
                      placeholderTextColor={appColors.textTertiary}
                      right={<TextInput.Affix text="min" textStyle={[styles.durationAffix, { color: appColors.textTertiary }]} />}
                      dense
                      theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
                    />
                  </View>
                </View>
              )}

              <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

              {/* ── Priority row ── */}
              <Pressable style={styles.attrRow} onPress={() => toggleEditField("priority")}>
                <View style={styles.attrRowLeft}>
                  <MaterialCommunityIcons
                    name={editPriority === "low" ? "flag-outline" : "flag"}
                    size={17}
                    color={editPriority === "high" ? appColors.priorityHigh : editPriority === "medium" ? appColors.priorityMedium : appColors.textTertiary}
                  />
                  <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Priority</Text>
                </View>
                <View style={styles.attrRowRight}>
                  <Text style={[styles.attrRowValue, {
                    color: editPriority === "high" ? appColors.priorityHigh
                      : editPriority === "medium" ? appColors.priorityMedium
                      : appColors.textTertiary,
                  }]}>
                    {editPriority === "high" ? "High" : editPriority === "medium" ? "Medium" : "Low"}
                  </Text>
                  <MaterialCommunityIcons
                    name={expandedEditField === "priority" ? "chevron-up" : "chevron-right"}
                    size={16}
                    color={appColors.textTertiary}
                  />
                </View>
              </Pressable>
              {expandedEditField === "priority" && (
                <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
                  <View style={styles.priorityRow}>
                    {PRIORITY_OPTIONS.map((option) => {
                      const dynamicColor = option.value === "high" ? appColors.priorityHigh
                        : option.value === "medium" ? appColors.priorityMedium
                        : appColors.priorityLow;
                      const isActive = editPriority === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          style={[styles.priorityCard, { backgroundColor: appColors.background }, isActive && { borderColor: dynamicColor, backgroundColor: `${dynamicColor}10` }]}
                          onPress={() => { setEditPriority(option.value as "low" | "medium" | "high"); setExpandedEditField(null); }}
                        >
                          <MaterialCommunityIcons name={option.icon as any} size={18} color={isActive ? dynamicColor : appColors.textTertiary} />
                          <Text style={[styles.priorityCardText, { color: appColors.textTertiary }, isActive && { color: dynamicColor }]}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

              {/* ── Notes row ── */}
              <Pressable style={styles.attrRow} onPress={() => toggleEditField("notes")}>
                <View style={styles.attrRowLeft}>
                  <MaterialCommunityIcons
                    name="text-box-outline"
                    size={17}
                    color={editDescription ? appColors.textSecondary : appColors.textTertiary}
                  />
                  <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Notes</Text>
                </View>
                <View style={styles.attrRowRight}>
                  <Text style={[styles.attrRowValue, { color: appColors.textTertiary }]} numberOfLines={1}>
                    {editDescription || "Optional"}
                  </Text>
                  <MaterialCommunityIcons
                    name={expandedEditField === "notes" ? "chevron-up" : "chevron-right"}
                    size={16}
                    color={appColors.textTertiary}
                  />
                </View>
              </Pressable>
              {expandedEditField === "notes" && (
                <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
                  <TextInput
                    placeholder="Add notes..."
                    value={editDescription}
                    onChangeText={setEditDescription}
                    style={[styles.descriptionInput, { backgroundColor: appColors.background }]}
                    mode="outlined"
                    multiline
                    numberOfLines={3}
                    outlineColor={appColors.border}
                    activeOutlineColor={appColors.primary}
                    cursorColor={appColors.primary}
                    textColor={appColors.textPrimary}
                    placeholderTextColor={appColors.textTertiary}
                    contentStyle={styles.notesInputContent}
                    theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
                  />
                </View>
              )}

              <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

              {/* ── Tags row ── */}
              <Pressable
                style={styles.attrRow}
                onPress={() => {
                  toggleEditField("tags");
                  if (expandedEditField !== "tags") setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
                }}
              >
                <View style={styles.attrRowLeft}>
                  <MaterialCommunityIcons
                    name="tag-outline"
                    size={17}
                    color={editTags.length > 0 ? appColors.secondary : appColors.textTertiary}
                  />
                  <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Tags</Text>
                </View>
                <View style={styles.attrRowRight}>
                  <Text style={[styles.attrRowValue, { color: appColors.textTertiary }]} numberOfLines={1}>
                    {editTags.length > 0 ? editTags.join(", ") : "Optional"}
                  </Text>
                  <MaterialCommunityIcons
                    name={expandedEditField === "tags" ? "chevron-up" : "chevron-right"}
                    size={16}
                    color={appColors.textTertiary}
                  />
                </View>
              </Pressable>
              {expandedEditField === "tags" && (
                <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
                  {editTags.length > 0 && (
                    <View style={styles.tagChipsRow}>
                      {editTags.map((tag) => (
                        <View key={tag} style={[styles.tagChip, { backgroundColor: appColors.secondaryLight }]}>
                          <Text style={[styles.tagChipText, { color: appColors.secondary }]}>{tag}</Text>
                          <Pressable onPress={() => removeEditTag(tag)} hitSlop={8}>
                            <MaterialCommunityIcons name="close" size={14} color={appColors.secondary} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={[styles.tagInputRow, { backgroundColor: appColors.background, marginTop: editTags.length > 0 ? 8 : 0 }]}>
                    <MaterialCommunityIcons name="tag-plus" size={20} color={editTagInput ? appColors.primary : appColors.textTertiary} />
                    <TextInput
                      placeholder={editTags.length > 0 ? "Add another tag..." : "Add tags (e.g., work, personal)..."}
                      value={editTagInput}
                      onChangeText={setEditTagInput}
                      onSubmitEditing={() => { if (editTagInput.trim()) addEditTag(editTagInput); }}
                      style={[styles.tagInput, { color: appColors.textPrimary }]}
                      mode="flat"
                      underlineColor="transparent"
                      activeUnderlineColor="transparent"
                      cursorColor={appColors.primary}
                      placeholderTextColor={appColors.textTertiary}
                      textColor={appColors.textPrimary}
                      dense
                      theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
                    />
                    {editTagInput.trim() && (
                      <Pressable onPress={() => addEditTag(editTagInput)} style={[styles.addTagBtn, { backgroundColor: appColors.primary }]}>
                        <MaterialCommunityIcons name="plus" size={16} color="#FFFFFF" />
                      </Pressable>
                    )}
                  </View>
                  {existingTags.filter(t => !editTags.includes(t)).length > 0 && (
                    <View style={styles.tagSuggestionsContainer}>
                      <Text style={[styles.tagSuggestionsLabel, { color: appColors.textTertiary }]}>Quick add:</Text>
                      <View style={styles.tagSuggestionsRow}>
                        {existingTags.filter(t => !editTags.includes(t) && (!editTagInput || t.includes(editTagInput.toLowerCase()))).slice(0, 6).map((tag) => (
                          <Pressable key={tag} style={[styles.tagSuggestion, { backgroundColor: appColors.background, borderColor: appColors.border }]} onPress={() => addEditTag(tag)}>
                            <Text style={[styles.tagSuggestionText, { color: appColors.textSecondary }]}>{tag}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )}

              <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />
            </>
          ) : (
            <>
              {/* ── View Mode ── */}
              {/* Title Section */}
              <View style={[styles.titleSection, { backgroundColor: appColors.surface }]}>
                <Text style={[styles.title, { color: appColors.textPrimary }]}>{task.title}</Text>
                <View style={styles.badges}>
                  <View style={[styles.badge, { backgroundColor: getStatusColor(task.status) + "15" }]}>
                    <View style={[styles.badgeDot, { backgroundColor: getStatusColor(task.status) }]} />
                    <Text style={[styles.badgeText, { color: getStatusColor(task.status) }]}>
                      {getStatusLabel(task.status)}
                    </Text>
                  </View>
                  {(task.is_recurring || isRecurringInstance(task)) && (
                    <View style={[styles.badge, { backgroundColor: appColors.aiPurpleLight }]}>
                      <MaterialCommunityIcons name="repeat" size={12} color={appColors.aiPurple} />
                      <Text style={[styles.badgeText, { color: appColors.aiPurple }]}>
                        {task.recurrence_rule ? getRecurrenceDescription(task.recurrence_rule) : "Recurring"}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Priority */}
              <View style={[styles.card, { backgroundColor: appColors.surface }]}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="flag" size={18} color={appColors.textSecondary} />
                  <Text style={[styles.cardLabel, { color: appColors.textSecondary }]}>Priority</Text>
                </View>
                <View style={[styles.priorityDisplay, { backgroundColor: `${priorityConfig.color}10` }]}>
                  <MaterialCommunityIcons name={priorityConfig.icon as any} size={18} color={priorityConfig.color} />
                  <Text style={[styles.priorityDisplayText, { color: priorityConfig.color }]}>
                    {priorityConfig.label} Priority
                  </Text>
                </View>
              </View>

              {/* Scheduled Time */}
              {task.scheduled_start && task.scheduled_end && (
                <View style={[styles.card, { backgroundColor: appColors.surface }]}>
                  <View style={styles.cardHeader}>
                    <MaterialCommunityIcons name="calendar-clock" size={18} color={appColors.textSecondary} />
                    <Text style={[styles.cardLabel, { color: appColors.textSecondary }]}>Scheduled</Text>
                  </View>
                  <View style={styles.scheduleInfo}>
                    <Text style={[styles.scheduleDate, { color: appColors.textSecondary }]}>{formatDate(task.scheduled_start)}</Text>
                    <Text style={[styles.scheduleTime, { color: appColors.primary }]}>
                      {formatTimeRange(task.scheduled_start, task.scheduled_end)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Duration */}
              <View style={[styles.card, { backgroundColor: appColors.surface }]}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="timer-outline" size={18} color={appColors.textSecondary} />
                  <Text style={[styles.cardLabel, { color: appColors.textSecondary }]}>Duration</Text>
                </View>
                <Text style={[styles.durationValue, { color: appColors.textPrimary }]}>{task.duration_minutes} minutes</Text>
              </View>

              {/* Tags */}
              <View style={[styles.card, { backgroundColor: appColors.surface }]}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="tag-multiple" size={18} color={appColors.textSecondary} />
                  <Text style={[styles.cardLabel, { color: appColors.textSecondary }]}>Tags</Text>
                </View>
                {task.tags && task.tags.length > 0 ? (
                  <View style={styles.tagChipsRow}>
                    {task.tags.map((tag) => (
                      <View key={tag} style={[styles.tagChipDisplay, { backgroundColor: appColors.secondaryLight }]}>
                        <Text style={[styles.tagChipDisplayText, { color: appColors.secondary }]}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.emptyDescription, { color: appColors.textTertiary }]}>No tags</Text>
                )}
              </View>

              {/* Description */}
              <View style={[styles.card, { backgroundColor: appColors.surface }]}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="text" size={18} color={appColors.textSecondary} />
                  <Text style={[styles.cardLabel, { color: appColors.textSecondary }]}>Notes</Text>
                </View>
                {task.description ? (
                  <Text style={[styles.descriptionText, { color: appColors.textPrimary }]}>{task.description}</Text>
                ) : (
                  <Text style={[styles.emptyDescription, { color: appColors.textTertiary }]}>No notes added</Text>
                )}
              </View>

              {/* Details */}
              <View style={[styles.card, { backgroundColor: appColors.surface }]}>
                <View style={styles.cardHeader}>
                  <MaterialCommunityIcons name="information-outline" size={18} color={appColors.textSecondary} />
                  <Text style={[styles.cardLabel, { color: appColors.textSecondary }]}>Details</Text>
                </View>
                <View style={styles.detailsList}>
                  <View style={styles.detailItem}>
                    <Text style={[styles.detailLabel, { color: appColors.textSecondary }]}>Scheduling</Text>
                    <Text style={[styles.detailValue, { color: appColors.textPrimary }]}>
                      {task.scheduling_method === "SMART" ? "AI Optimized" : "Manual"}
                    </Text>
                  </View>
                  {task.due_date && (
                    <View style={styles.detailItem}>
                      <Text style={[styles.detailLabel, { color: appColors.textSecondary }]}>Due Date</Text>
                      <Text style={[styles.detailValue, { color: appColors.textPrimary }]}>{formatDate(task.due_date)}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Subtasks Section */}
              {!task.parent_task_id && (
                <View style={[styles.card, { backgroundColor: appColors.surface }]}>
                  <View style={styles.cardHeader}>
                    <MaterialCommunityIcons name="format-list-checks" size={18} color={appColors.textSecondary} />
                    <Text style={[styles.cardLabel, { color: appColors.textSecondary }]}>Subtasks</Text>
                    {subtasks.length > 0 && (
                      <View style={[styles.subtaskBadge, { backgroundColor: appColors.chipBg }]}>
                        <Text style={[styles.subtaskBadgeText, { color: appColors.textSecondary }]}>{getSubtaskProgressText()}</Text>
                      </View>
                    )}
                  </View>

                  {subtasks.length > 0 && (
                    <ProgressBar
                      progress={getSubtaskProgress()}
                      color={appColors.success}
                      style={[styles.progressBar, { backgroundColor: appColors.chipBg }]}
                    />
                  )}

                  {subtasks.map((subtask) => (
                    <Pressable
                      key={subtask.id}
                      style={[styles.subtaskItem, { borderBottomColor: appColors.border }]}
                      onPress={() => router.push(`/task/${subtask.id}`)}
                    >
                      <Pressable onPress={() => handleToggleSubtask(subtask)} style={styles.subtaskCheckbox}>
                        <MaterialCommunityIcons
                          name={subtask.status === "completed" ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
                          size={22}
                          color={subtask.status === "completed" ? appColors.success : appColors.textTertiary}
                        />
                      </Pressable>
                      <Text
                        style={[
                          styles.subtaskTitle,
                          { color: appColors.textPrimary },
                          subtask.status === "completed" && { textDecorationLine: "line-through", color: appColors.textTertiary },
                        ]}
                      >
                        {subtask.title}
                      </Text>
                      <MaterialCommunityIcons name="chevron-right" size={18} color={appColors.textTertiary} />
                    </Pressable>
                  ))}

                  {showAddSubtask ? (
                    <View style={styles.addSubtaskContainer}>
                      <TextInput
                        mode="outlined"
                        placeholder="Subtask title"
                        value={newSubtaskTitle}
                        onChangeText={setNewSubtaskTitle}
                        style={[styles.addSubtaskInput, { backgroundColor: appColors.surface }]}
                        outlineColor={appColors.border}
                        activeOutlineColor={appColors.primary}
                        cursorColor={appColors.primary}
                        textColor={appColors.textPrimary}
                        placeholderTextColor={appColors.textTertiary}
                        dense
                        autoFocus
                        onSubmitEditing={handleAddSubtask}
                        theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
                      />
                      <View style={styles.addSubtaskActions}>
                        <Pressable onPress={() => { setShowAddSubtask(false); setNewSubtaskTitle(""); }} style={styles.cancelSubtaskBtn}>
                          <Text style={[styles.cancelSubtaskText, { color: appColors.textSecondary }]}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={handleAddSubtask}
                          disabled={!newSubtaskTitle.trim() || addingSubtask}
                          style={[styles.addSubtaskBtn, { backgroundColor: appColors.primary }, (!newSubtaskTitle.trim() || addingSubtask) && styles.addSubtaskBtnDisabled]}
                        >
                          {addingSubtask ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                          ) : (
                            <Text style={styles.addSubtaskBtnText}>Add</Text>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable style={styles.addSubtaskRow} onPress={() => setShowAddSubtask(true)}>
                      <MaterialCommunityIcons name="plus" size={20} color={appColors.primary} />
                      <Text style={[styles.addSubtaskText, { color: appColors.primary }]}>Add Subtask</Text>
                    </Pressable>
                  )}

                  {subtasks.length === 0 && !showAddSubtask && (
                    <Text style={[styles.noSubtasks, { color: appColors.textTertiary }]}>Break this task into smaller steps</Text>
                  )}
                </View>
              )}

              {/* Manage Series */}
              {isRecurringInstance(task) && (
                <View style={[styles.card, { backgroundColor: appColors.surface }]}>
                  <View style={styles.cardHeader}>
                    <MaterialCommunityIcons name="repeat" size={18} color={appColors.textSecondary} />
                    <Text style={[styles.cardLabel, { color: appColors.textSecondary }]}>Manage Series</Text>
                  </View>
                  <View style={styles.seriesActions}>
                    <Pressable
                      style={[styles.seriesBtn, { backgroundColor: appColors.successLight }]}
                      onPress={handleCompleteAllRecurrences}
                      disabled={actionLoading}
                    >
                      <MaterialCommunityIcons name="check-all" size={16} color={appColors.success} />
                      <Text style={[styles.seriesBtnText, { color: appColors.success }]}>Complete all</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.seriesBtn, { backgroundColor: appColors.errorLight }]}
                      onPress={handleDeleteAllRecurrences}
                      disabled={actionLoading}
                    >
                      <MaterialCommunityIcons name="delete-sweep-outline" size={16} color={appColors.error} />
                      <Text style={[styles.seriesBtnText, { color: appColors.error }]}>Delete all</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Delete */}
              <Pressable style={styles.deleteButton} onPress={handleDelete}>
                <MaterialCommunityIcons name="delete-outline" size={20} color={appColors.error} />
                <Text style={[styles.deleteButtonText, { color: appColors.error }]}>Delete Task</Text>
              </Pressable>

              <View style={{ height: 130 }} />
            </>
          )}
        </ScrollView>

      {/* Bottom Actions */}
      {isEditing ? (
        <View style={[styles.bottomAction, { backgroundColor: appColors.surface, borderTopColor: appColors.border, paddingBottom: insets.bottom + 20 }]}>
          <Pressable
            style={[
              styles.saveButton,
              { backgroundColor: saveLoading ? "#D1D5DB" : appColors.primary },
              (!editTitle.trim() || saveLoading) && styles.saveButtonDisabled,
            ]}
            onPress={saveEdits}
            disabled={!editTitle.trim() || saveLoading}
          >
            {saveLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <MaterialCommunityIcons name="check" size={22} color="#FFFFFF" />
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </>
            )}
          </Pressable>
        </View>
      ) : task.status !== "completed" ? (
        <View style={[styles.bottomActions, { backgroundColor: appColors.surface, borderTopColor: appColors.border, paddingBottom: insets.bottom + 20 }]}>
          <Pressable style={[styles.rescheduleBtn, { borderColor: appColors.primary, backgroundColor: appColors.surface }]} onPress={handleReschedule} disabled={actionLoading}>
            <MaterialCommunityIcons name="calendar-clock" size={20} color={appColors.primary} />
            <Text style={[styles.rescheduleBtnText, { color: appColors.primary }]}>
              {task.scheduled_start ? "Reschedule" : "Schedule"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.completeBtn, actionLoading && styles.completeBtnDisabled]}
            onPress={handleComplete}
            disabled={actionLoading}
          >
            <LinearGradient
              colors={actionLoading ? ["#D1D5DB", "#D1D5DB"] : [appColors.success, "#4DAF6E"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.completeBtnGradient}
            >
              {actionLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialCommunityIcons name="check" size={22} color="#FFFFFF" />
                  <Text style={styles.completeBtnText}>Complete</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      ) : (
        <View style={[styles.completedBanner, { backgroundColor: appColors.successLight, borderTopColor: appColors.successLight, paddingBottom: insets.bottom + 20 }]}>
          <MaterialCommunityIcons name="check-circle" size={20} color={appColors.success} />
          <Text style={[styles.completedBannerText, { color: appColors.success }]}>Task completed</Text>
        </View>
      )}

      </KeyboardAvoidingView>

      {/* Reschedule Modal */}
      <SchedulingModal
        visible={showRescheduleModal}
        onClose={() => setShowRescheduleModal(false)}
        onSelectSlot={handleSelectSlot}
        task={task}
        slots={rescheduleSlots}
        isLoading={rescheduleLoading}
        error={rescheduleError}
        schedulingMethod={rescheduleMethod}
        busySlots={busySlots}
        onMethodChosen={handleMethodChoice}
        isPro={isPro}
        onPaywall={() => {
          setShowRescheduleModal(false);
          router.push({ pathname: "/paywall", params: { source: "smart_reschedule" } });
        }}
      />

      {/* Scheduling Feedback Modal (shown for AI-scheduled tasks) */}
      {task && task.scheduled_start && task.scheduled_end && (
        <SchedulingFeedbackModal
          visible={showSchedulingFeedback}
          onComplete={onSchedulingFeedbackComplete}
          taskId={task.id}
          taskTitle={task.title}
          scheduledStart={task.scheduled_start}
          scheduledEnd={task.scheduled_end}
        />
      )}

      {/* Happiness Check Modal */}
      <HappinessCheckModal
        visible={showHappinessCheck}
        onResponse={onHappinessResponse}
        tasksCompleted={happinessTasksCompleted}
      />

      {/* Feedback Form Modal */}
      <FeedbackFormModal
        visible={showFeedbackForm}
        onSubmit={onFeedbackSubmit}
        onSkip={onFeedbackSkip}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  notFoundText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  goBackButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  goBackText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    letterSpacing: -0.3,
  },
  headerAction: {
    padding: 4,
  },
  cancelText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
  content: {
    flex: 1,
    padding: 16,
  },
  titleSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  editTitleInput: {
    fontSize: 22,
    fontWeight: "600",
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    marginBottom: 8,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "500",
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  cardLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
    flex: 1,
  },
  priorityOptions: {
    flexDirection: "row",
    gap: 10,
  },
  priorityOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F8F9FB",
    borderWidth: 1,
    borderColor: "transparent",
  },
  priorityOptionText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textTertiary,
  },
  priorityDisplay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  priorityDisplayText: {
    fontSize: 14,
    fontWeight: "600",
  },
  scheduleInfo: {},
  scheduleDate: {
    fontSize: 15,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  scheduleTime: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.primary,
    letterSpacing: -0.3,
  },
  durationEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  durationInput: {
    width: 80,
    backgroundColor: COLORS.surface,
  },
  durationUnit: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  durationValue: {
    fontSize: 16,
    fontWeight: "500",
    color: COLORS.textPrimary,
  },
  descriptionInput: {
    backgroundColor: COLORS.surface,
    fontSize: 14,
  },
  descriptionText: {
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.textPrimary,
  },
  emptyDescription: {
    fontSize: 14,
    color: COLORS.textTertiary,
    fontStyle: "italic",
  },
  // Due Date
  dueDateOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dueDateChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#F8F9FB",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dueDateChipActive: {
    backgroundColor: COLORS.primary,
  },
  dueDateChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textTertiary,
  },
  dueDateChipTextActive: {
    color: "#FFFFFF",
  },
  selectedDueDateText: {
    marginTop: 10,
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: "500",
  },
  // Scheduling Method
  schedulingOptions: {
    gap: 10,
  },
  schedulingOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#F8F9FB",
    borderWidth: 1,
    borderColor: "transparent",
  },
  schedulingOptionActive: {
    backgroundColor: "#F0F7FF",
    borderColor: COLORS.primary,
  },
  schedulingOptionContent: {
    flex: 1,
  },
  schedulingOptionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  schedulingOptionTitleActive: {
    color: COLORS.primary,
  },
  schedulingOptionDesc: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  // Tags
  tagsEditSection: {
    gap: 12,
  },
  tagChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.aiPurpleLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  tagChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.aiPurple,
  },
  tagChipDisplay: {
    backgroundColor: COLORS.aiPurpleLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  tagChipDisplayText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.aiPurple,
  },
  tagInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F8F9FB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  tagInput: {
    flex: 1,
    backgroundColor: "transparent",
    fontSize: 14,
  },
  addTagBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  tagSuggestions: {
    gap: 6,
  },
  tagSuggestionsLabel: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  tagSuggestionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagSuggestion: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#F8F9FB",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagSuggestionText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  detailsList: {
    gap: 12,
  },
  detailItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.textPrimary,
  },
  // Subtasks
  subtaskBadge: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  subtaskBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    marginBottom: 12,
    backgroundColor: "#F3F4F6",
  },
  subtaskItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  subtaskCheckbox: {
    marginRight: 10,
  },
  subtaskTitle: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  subtaskCompleted: {
    textDecorationLine: "line-through",
    color: COLORS.textTertiary,
  },
  addSubtaskContainer: {
    marginTop: 12,
    gap: 10,
  },
  addSubtaskInput: {
    backgroundColor: COLORS.surface,
  },
  addSubtaskActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  cancelSubtaskBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelSubtaskText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
  addSubtaskBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  addSubtaskBtnDisabled: {
    backgroundColor: "#D1D5DB",
  },
  addSubtaskBtnText: {
    fontSize: 14,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  addSubtaskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },
  addSubtaskText: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.primary,
  },
  noSubtasks: {
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: "center",
    paddingVertical: 16,
  },
  // Delete button
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: "500",
    color: COLORS.error,
  },
  seriesActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  seriesBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  seriesBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  // Bottom actions
  bottomAction: {
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  bottomActions: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    gap: 12,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  rescheduleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: "#FFFFFF",
  },
  rescheduleBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.primary,
  },
  completeBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  completeBtnDisabled: {
    opacity: 0.7,
  },
  completeBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
  },
  completeBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  completedBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F0FDF4",
    paddingTop: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: "#D1FAE5",
  },
  completedBannerText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.success,
  },

  // Edit mode — attr row layout
  scrollView: {
    flex: 1,
  },
  titleArea: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
  },
  titleInput: {
    fontSize: 22,
    fontWeight: "600",
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    lineHeight: 30,
    minHeight: 56,
  },
  listDivider: {
    height: 1,
  },
  attrRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 15,
    minHeight: 54,
  },
  attrRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  attrRowLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: COLORS.textPrimary,
  },
  attrRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  attrRowValue: {
    fontSize: 14,
    color: COLORS.textSecondary,
    maxWidth: 160,
    textAlign: "right",
  },
  attrExpanded: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  schedulePills: {
    flexDirection: "row",
    gap: 6,
  },
  schedulePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: COLORS.background,
  },
  schedulePillText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textTertiary,
  },
  durationGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  durationChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#F8F9FB",
    borderWidth: 1,
    borderColor: "transparent",
  },
  durationChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  customDurationRow: {
    flexDirection: "row",
  },
  customDurationInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    fontSize: 14,
  },
  durationAffix: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },
  priorityRow: {
    flexDirection: "row",
    gap: 10,
  },
  priorityCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#F8F9FB",
    borderWidth: 1,
    borderColor: "transparent",
  },
  priorityCardText: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.textTertiary,
  },
  notesInputContent: {
    paddingTop: 8,
  },
  tagSuggestionsContainer: {
    marginTop: 8,
    gap: 6,
  },

});
