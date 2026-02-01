/**
 * Task Detail Screen - "Fluid Intelligence" Design
 *
 * Shows task details with actions:
 * - Edit task
 * - Mark Complete
 * - Reschedule
 * - Delete
 */

import { View, StyleSheet, ScrollView, Alert, Pressable, Animated, KeyboardAvoidingView, Platform } from "react-native";
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
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState, useEffect, useCallback, useRef } from "react";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { format, addDays } from "date-fns";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "@/lib/supabase";
import { Task, TimeSlot, UserProfile, CalendarEvent } from "@/lib/types";
import SchedulingModal from "@/components/SchedulingModal";
import { scheduleTask } from "@/lib/scheduling";
import {
  isGoogleCalendarConnected,
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from "@/lib/google-calendar";
import { scheduleTaskReminder, cancelTaskReminder } from "@/lib/notifications";
import {
  generateNextInstance,
  isRecurringInstance,
  getRecurrenceDescription,
} from "@/lib/recurrence";

// Design System
const COLORS = {
  gradientStart: "#4A90E2",
  gradientEnd: "#7C6FBF",
  background: "#F8F9FB",
  surface: "#FFFFFF",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  border: "#E5E7EB",
  priorityHigh: "#E25555",
  priorityMedium: "#F5A962",
  priorityLow: "#5FBF73",
  success: "#5FBF73",
  error: "#E25555",
  aiPurple: "#7C6FBF",
  aiPurpleLight: "#E8E5F5",
};

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

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
  const scrollViewRef = useRef<ScrollView>(null);

  // Subtask state
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);

  // Reschedule modal state
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleSlots, setRescheduleSlots] = useState<TimeSlot[]>([]);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [busySlots, setBusySlots] = useState<
    { start: string; end: string; title: string }[]
  >([]);

  // Load task on focus
  useFocusEffect(
    useCallback(() => {
      loadTask();
    }, [id])
  );

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
      setEditDueDate(selectedDate);
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

      const { data: updatedTask, error } = await supabase
        .from("tasks")
        .update({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          duration_minutes: durationNum,
          priority: editPriority,
          tags: editTags.length > 0 ? editTags : [],
          due_date: editDueDate?.toISOString() || null,
          scheduling_method: editSchedulingMethod,
        })
        .eq("id", task.id)
        .select()
        .single();

      if (error) throw error;

      setTask(updatedTask as Task);
      setIsEditing(false);
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
          const nextInstance = generateNextInstance(
            parentTask as Task,
            task.instance_date
          );

          if (nextInstance) {
            await supabase.from("tasks").insert(nextInstance);
            console.log("[TaskDetail] Generated next recurring instance");
          }
        }
      }

      // Go back after completing
      goBack();
    } catch (err) {
      console.error("[TaskDetail] Complete error:", err);
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

      // Delete Google Calendar event if exists
      if (task.google_event_id) {
        try {
          const isCalendarConnected = await isGoogleCalendarConnected();
          if (isCalendarConnected) {
            await deleteGoogleCalendarEvent(task.google_event_id);
          }
        } catch (calError) {
          console.warn("[TaskDetail] Failed to delete calendar event:", calError);
          // Continue with task deletion even if calendar delete fails
        }
      }

      const { error } = await supabase.from("tasks").delete().eq("id", task.id);

      if (error) throw error;

      goBack();
    } catch (err) {
      console.error("[TaskDetail] Delete error:", err);
      Alert.alert("Error", "Failed to delete task");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReschedule = async () => {
    if (!task) return;

    setShowRescheduleModal(true);

    if (task.scheduling_method === "SMART") {
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
        auto_reschedule: false,
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
      const result = await scheduleTask({
        task,
        userProfile: profile as UserProfile,
        existingEvents: (calendarEvents || []) as CalendarEvent[],
        existingTasks: (existingTasks || []) as Task[],
        lookAheadDays: 14,
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
      const isCalendarConnected = await isGoogleCalendarConnected();

      // Update or create Google Calendar event
      if (isCalendarConnected) {
        try {
          if (googleEventId) {
            // Update existing event
            await updateGoogleCalendarEvent(
              googleEventId,
              task.title,
              task.description,
              slot.start,
              slot.end
            );
          } else {
            // Create new event
            googleEventId = await createGoogleCalendarEvent(
              task.title,
              task.description,
              slot.start,
              slot.end
            );
          }
        } catch (calError) {
          console.warn("[TaskDetail] Calendar update failed:", calError);
          // Continue with task update even if calendar fails
        }
      }

      // Update task with scheduled time
      const updateData: Record<string, unknown> = {
        scheduled_start: slot.start,
        scheduled_end: slot.end,
        status: "scheduled",
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

      setShowRescheduleModal(false);
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
        return "#f44336";
      case "medium":
        return "#ff9800";
      case "low":
        return "#4caf50";
      default:
        return "#9e9e9e";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "scheduled":
        return "#2196f3";
      case "completed":
        return "#4caf50";
      case "overdue":
        return "#f44336";
      case "pending_schedule":
        return "#ff9800";
      default:
        return "#9e9e9e";
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
      case "high": return { color: COLORS.priorityHigh, label: "High", icon: "flag-variant" };
      case "medium": return { color: COLORS.priorityMedium, label: "Medium", icon: "flag" };
      case "low": return { color: COLORS.priorityLow, label: "Low", icon: "flag-outline" };
      default: return { color: COLORS.textTertiary, label: priority, icon: "flag-outline" };
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.gradientStart} />
          <Text style={styles.loadingText}>Loading task...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!task) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.notFoundText}>Task not found</Text>
          <Pressable style={styles.goBackButton} onPress={() => goBack()}>
            <Text style={styles.goBackText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const priorityConfig = getPriorityConfig(task.priority);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => goBack()} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>
            {isEditing ? "Edit Task" : "Task Details"}
          </Text>
          {isEditing ? (
            <Pressable onPress={cancelEditing} style={styles.headerAction}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          ) : (
            <Pressable onPress={startEditing} style={styles.headerAction}>
              <MaterialCommunityIcons name="pencil" size={22} color={COLORS.gradientStart} />
            </Pressable>
          )}
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Title Section */}
          <View style={styles.titleSection}>
            {isEditing ? (
              <TextInput
                value={editTitle}
                onChangeText={setEditTitle}
                style={styles.editTitleInput}
                mode="flat"
                placeholder="Task title"
                underlineColor="transparent"
                activeUnderlineColor="transparent"
                cursorColor={COLORS.gradientStart}
              />
            ) : (
              <Text style={styles.title}>{task.title}</Text>
            )}

            {/* Status badges */}
            {!isEditing && (
              <View style={styles.badges}>
                <View style={[styles.badge, { backgroundColor: getStatusColor(task.status) + "15" }]}>
                  <View style={[styles.badgeDot, { backgroundColor: getStatusColor(task.status) }]} />
                  <Text style={[styles.badgeText, { color: getStatusColor(task.status) }]}>
                    {getStatusLabel(task.status)}
                  </Text>
                </View>
                {(task.is_recurring || isRecurringInstance(task)) && (
                  <View style={[styles.badge, { backgroundColor: COLORS.aiPurpleLight }]}>
                    <MaterialCommunityIcons name="repeat" size={12} color={COLORS.aiPurple} />
                    <Text style={[styles.badgeText, { color: COLORS.aiPurple }]}>
                      {task.recurrence_rule ? getRecurrenceDescription(task.recurrence_rule) : "Recurring"}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Priority Selection (Edit mode) or Display */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="flag" size={18} color={COLORS.textTertiary} />
              <Text style={styles.cardLabel}>Priority</Text>
            </View>
            {isEditing ? (
              <View style={styles.priorityOptions}>
                {(["low", "medium", "high"] as const).map((p) => {
                  const config = getPriorityConfig(p);
                  const isSelected = editPriority === p;
                  return (
                    <Pressable
                      key={p}
                      style={[
                        styles.priorityOption,
                        isSelected && { backgroundColor: `${config.color}15`, borderColor: config.color }
                      ]}
                      onPress={() => setEditPriority(p)}
                    >
                      <MaterialCommunityIcons
                        name={config.icon as any}
                        size={18}
                        color={isSelected ? config.color : COLORS.textTertiary}
                      />
                      <Text style={[styles.priorityOptionText, isSelected && { color: config.color }]}>
                        {config.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={[styles.priorityDisplay, { backgroundColor: `${priorityConfig.color}10` }]}>
                <MaterialCommunityIcons name={priorityConfig.icon as any} size={18} color={priorityConfig.color} />
                <Text style={[styles.priorityDisplayText, { color: priorityConfig.color }]}>
                  {priorityConfig.label} Priority
                </Text>
              </View>
            )}
          </View>

          {/* Scheduled Time */}
          {task.scheduled_start && task.scheduled_end && !isEditing && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <MaterialCommunityIcons name="calendar-clock" size={18} color={COLORS.textTertiary} />
                <Text style={styles.cardLabel}>Scheduled</Text>
              </View>
              <View style={styles.scheduleInfo}>
                <Text style={styles.scheduleDate}>{formatDate(task.scheduled_start)}</Text>
                <Text style={styles.scheduleTime}>
                  {formatTimeRange(task.scheduled_start, task.scheduled_end)}
                </Text>
              </View>
            </View>
          )}

          {/* Duration */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="timer-outline" size={18} color={COLORS.textTertiary} />
              <Text style={styles.cardLabel}>Duration</Text>
            </View>
            {isEditing ? (
              <View style={styles.durationEditRow}>
                <TextInput
                  value={editDuration}
                  onChangeText={setEditDuration}
                  style={styles.durationInput}
                  mode="outlined"
                  keyboardType="numeric"
                  outlineColor={COLORS.border}
                  activeOutlineColor={COLORS.gradientStart}
                  cursorColor={COLORS.gradientStart}
                  dense
                />
                <Text style={styles.durationUnit}>minutes</Text>
              </View>
            ) : (
              <Text style={styles.durationValue}>{task.duration_minutes} minutes</Text>
            )}
          </View>

          {/* Due Date - Edit mode */}
          {isEditing && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <MaterialCommunityIcons name="calendar" size={18} color={COLORS.textTertiary} />
                <Text style={styles.cardLabel}>Due Date</Text>
              </View>
              <View style={styles.dueDateOptions}>
                <Pressable
                  style={[styles.dueDateChip, !editDueDate && styles.dueDateChipActive]}
                  onPress={() => setEditDueDate(null)}
                >
                  <Text style={[styles.dueDateChipText, !editDueDate && styles.dueDateChipTextActive]}>
                    No deadline
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.dueDateChip, editDueDate && format(editDueDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd") && styles.dueDateChipActive]}
                  onPress={() => setEditDueDate(new Date())}
                >
                  <Text style={[styles.dueDateChipText, editDueDate && format(editDueDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd") && styles.dueDateChipTextActive]}>
                    Today
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.dueDateChip, editDueDate && format(editDueDate, "yyyy-MM-dd") === format(addDays(new Date(), 1), "yyyy-MM-dd") && styles.dueDateChipActive]}
                  onPress={() => setEditDueDate(addDays(new Date(), 1))}
                >
                  <Text style={[styles.dueDateChipText, editDueDate && format(editDueDate, "yyyy-MM-dd") === format(addDays(new Date(), 1), "yyyy-MM-dd") && styles.dueDateChipTextActive]}>
                    Tomorrow
                  </Text>
                </Pressable>
                <Pressable style={styles.dueDateChip} onPress={() => setShowDatePicker(true)}>
                  <MaterialCommunityIcons name="calendar-edit" size={16} color={COLORS.textTertiary} />
                </Pressable>
              </View>
              {editDueDate && format(editDueDate, "yyyy-MM-dd") !== format(new Date(), "yyyy-MM-dd") && format(editDueDate, "yyyy-MM-dd") !== format(addDays(new Date(), 1), "yyyy-MM-dd") && (
                <Text style={styles.selectedDueDateText}>Due: {format(editDueDate, "EEE, MMM d")}</Text>
              )}
              {showDatePicker && (
                <DateTimePicker
                  value={editDueDate || new Date()}
                  mode="date"
                  minimumDate={new Date()}
                  onChange={handleDateChange}
                />
              )}
            </View>
          )}

          {/* Scheduling Method - Edit mode */}
          {isEditing && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <MaterialCommunityIcons name="robot-outline" size={18} color={COLORS.textTertiary} />
                <Text style={styles.cardLabel}>Scheduling Method</Text>
              </View>
              <View style={styles.schedulingOptions}>
                <Pressable
                  style={[styles.schedulingOption, editSchedulingMethod === "SMART" && styles.schedulingOptionActive]}
                  onPress={() => setEditSchedulingMethod("SMART")}
                >
                  <MaterialCommunityIcons
                    name="robot-outline"
                    size={20}
                    color={editSchedulingMethod === "SMART" ? COLORS.gradientStart : COLORS.textTertiary}
                  />
                  <View style={styles.schedulingOptionContent}>
                    <Text style={[styles.schedulingOptionTitle, editSchedulingMethod === "SMART" && styles.schedulingOptionTitleActive]}>
                      AI Scheduling
                    </Text>
                    <Text style={styles.schedulingOptionDesc}>Find best time automatically</Text>
                  </View>
                  {editSchedulingMethod === "SMART" && (
                    <MaterialCommunityIcons name="check-circle" size={20} color={COLORS.gradientStart} />
                  )}
                </Pressable>
                <Pressable
                  style={[styles.schedulingOption, editSchedulingMethod === "MANUAL" && styles.schedulingOptionActive]}
                  onPress={() => setEditSchedulingMethod("MANUAL")}
                >
                  <MaterialCommunityIcons
                    name="calendar-cursor"
                    size={20}
                    color={editSchedulingMethod === "MANUAL" ? COLORS.gradientStart : COLORS.textTertiary}
                  />
                  <View style={styles.schedulingOptionContent}>
                    <Text style={[styles.schedulingOptionTitle, editSchedulingMethod === "MANUAL" && styles.schedulingOptionTitleActive]}>
                      Manual
                    </Text>
                    <Text style={styles.schedulingOptionDesc}>Choose your own time</Text>
                  </View>
                  {editSchedulingMethod === "MANUAL" && (
                    <MaterialCommunityIcons name="check-circle" size={20} color={COLORS.gradientStart} />
                  )}
                </Pressable>
              </View>
            </View>
          )}

          {/* Tags - Edit mode or display */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="tag-multiple" size={18} color={COLORS.textTertiary} />
              <Text style={styles.cardLabel}>Tags</Text>
            </View>
            {isEditing ? (
              <View style={styles.tagsEditSection}>
                {/* Selected tags */}
                {editTags.length > 0 && (
                  <View style={styles.tagChipsRow}>
                    {editTags.map((tag) => (
                      <View key={tag} style={styles.tagChip}>
                        <Text style={styles.tagChipText}>{tag}</Text>
                        <Pressable onPress={() => removeEditTag(tag)} hitSlop={8}>
                          <MaterialCommunityIcons name="close" size={14} color={COLORS.aiPurple} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                {/* Tag input */}
                <View style={styles.tagInputRow}>
                  <MaterialCommunityIcons name="tag-plus" size={18} color={editTagInput ? COLORS.gradientStart : COLORS.textTertiary} />
                  <TextInput
                    placeholder={editTags.length > 0 ? "Add another tag..." : "Add tags..."}
                    value={editTagInput}
                    onChangeText={setEditTagInput}
                    onSubmitEditing={() => {
                      if (editTagInput.trim()) addEditTag(editTagInput);
                    }}
                    style={styles.tagInput}
                    mode="flat"
                    underlineColor="transparent"
                    activeUnderlineColor="transparent"
                    cursorColor={COLORS.gradientStart}
                    dense
                  />
                  {editTagInput.trim() && (
                    <Pressable onPress={() => addEditTag(editTagInput)} style={styles.addTagBtn}>
                      <MaterialCommunityIcons name="plus" size={16} color="#FFFFFF" />
                    </Pressable>
                  )}
                </View>
                {/* Tag suggestions */}
                {existingTags.filter(t => !editTags.includes(t)).length > 0 && (
                  <View style={styles.tagSuggestions}>
                    <Text style={styles.tagSuggestionsLabel}>Quick add:</Text>
                    <View style={styles.tagSuggestionsRow}>
                      {existingTags.filter(t => !editTags.includes(t) && (!editTagInput || t.includes(editTagInput.toLowerCase()))).slice(0, 5).map((tag) => (
                        <Pressable key={tag} style={styles.tagSuggestion} onPress={() => addEditTag(tag)}>
                          <Text style={styles.tagSuggestionText}>{tag}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            ) : task.tags && task.tags.length > 0 ? (
              <View style={styles.tagChipsRow}>
                {task.tags.map((tag) => (
                  <View key={tag} style={styles.tagChipDisplay}>
                    <Text style={styles.tagChipDisplayText}>{tag}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyDescription}>No tags</Text>
            )}
          </View>

          {/* Description */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="text" size={18} color={COLORS.textTertiary} />
              <Text style={styles.cardLabel}>Notes</Text>
            </View>
            {isEditing ? (
              <TextInput
                value={editDescription}
                onChangeText={setEditDescription}
                style={styles.descriptionInput}
                mode="outlined"
                multiline
                numberOfLines={3}
                placeholder="Add notes..."
                outlineColor={COLORS.border}
                activeOutlineColor={COLORS.gradientStart}
                cursorColor={COLORS.gradientStart}
                contentStyle={{ paddingTop: 12 }}
              />
            ) : task.description ? (
              <Text style={styles.descriptionText}>{task.description}</Text>
            ) : (
              <Text style={styles.emptyDescription}>No notes added</Text>
            )}
          </View>

          {/* Details (view mode only) */}
          {!isEditing && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <MaterialCommunityIcons name="information-outline" size={18} color={COLORS.textTertiary} />
                <Text style={styles.cardLabel}>Details</Text>
              </View>
              <View style={styles.detailsList}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Scheduling</Text>
                  <Text style={styles.detailValue}>
                    {task.scheduling_method === "SMART" ? "AI Optimized" : "Manual"}
                  </Text>
                </View>
                {task.due_date && (
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Due Date</Text>
                    <Text style={styles.detailValue}>{formatDate(task.due_date)}</Text>
                  </View>
                )}
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Auto-reschedule</Text>
                  <Text style={styles.detailValue}>{task.auto_reschedule ? "Enabled" : "Disabled"}</Text>
                </View>
              </View>
            </View>
          )}

        {/* Subtasks Section - only show for parent tasks and not in edit mode */}
        {!task.parent_task_id && !isEditing && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="format-list-checks" size={18} color={COLORS.textTertiary} />
              <Text style={styles.cardLabel}>Subtasks</Text>
              {subtasks.length > 0 && (
                <View style={styles.subtaskBadge}>
                  <Text style={styles.subtaskBadgeText}>{getSubtaskProgressText()}</Text>
                </View>
              )}
            </View>

            {/* Progress bar */}
            {subtasks.length > 0 && (
              <ProgressBar
                progress={getSubtaskProgress()}
                color={COLORS.success}
                style={styles.progressBar}
              />
            )}

            {/* Subtask list */}
            {subtasks.map((subtask) => (
              <Pressable
                key={subtask.id}
                style={styles.subtaskItem}
                onPress={() => router.push(`/task/${subtask.id}`)}
              >
                <Pressable
                  onPress={() => handleToggleSubtask(subtask)}
                  style={styles.subtaskCheckbox}
                >
                  <MaterialCommunityIcons
                    name={subtask.status === "completed" ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
                    size={22}
                    color={subtask.status === "completed" ? COLORS.success : COLORS.textTertiary}
                  />
                </Pressable>
                <Text
                  style={[
                    styles.subtaskTitle,
                    subtask.status === "completed" && styles.subtaskCompleted,
                  ]}
                >
                  {subtask.title}
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={18} color={COLORS.textTertiary} />
              </Pressable>
            ))}

            {/* Add subtask input */}
            {showAddSubtask ? (
              <View style={styles.addSubtaskContainer}>
                <TextInput
                  mode="outlined"
                  placeholder="Subtask title"
                  value={newSubtaskTitle}
                  onChangeText={setNewSubtaskTitle}
                  style={styles.addSubtaskInput}
                  outlineColor={COLORS.border}
                  activeOutlineColor={COLORS.gradientStart}
                  cursorColor={COLORS.gradientStart}
                  dense
                  autoFocus
                  onSubmitEditing={handleAddSubtask}
                />
                <View style={styles.addSubtaskActions}>
                  <Pressable onPress={() => { setShowAddSubtask(false); setNewSubtaskTitle(""); }} style={styles.cancelSubtaskBtn}>
                    <Text style={styles.cancelSubtaskText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleAddSubtask}
                    disabled={!newSubtaskTitle.trim() || addingSubtask}
                    style={[styles.addSubtaskBtn, (!newSubtaskTitle.trim() || addingSubtask) && styles.addSubtaskBtnDisabled]}
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
                <MaterialCommunityIcons name="plus" size={20} color={COLORS.gradientStart} />
                <Text style={styles.addSubtaskText}>Add Subtask</Text>
              </Pressable>
            )}

            {subtasks.length === 0 && !showAddSubtask && (
              <Text style={styles.noSubtasks}>Break this task into smaller steps</Text>
            )}
          </View>
        )}

        {/* Danger Zone */}
        {!isEditing && (
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <MaterialCommunityIcons name="delete-outline" size={20} color={COLORS.error} />
            <Text style={styles.deleteButtonText}>Delete Task</Text>
          </Pressable>
        )}

        {/* Spacer */}
        <View style={{ height: isEditing ? 120 : 100 }} />
      </ScrollView>

      {/* Bottom Actions */}
      {isEditing ? (
        <View style={styles.bottomAction}>
          <Pressable
            style={[styles.saveButton, (!editTitle.trim() || saveLoading) && styles.saveButtonDisabled]}
            onPress={saveEdits}
            disabled={!editTitle.trim() || saveLoading}
          >
            <LinearGradient
              colors={!editTitle.trim() || saveLoading ? ["#D1D5DB", "#D1D5DB"] : [COLORS.gradientStart, COLORS.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.saveButtonGradient}
            >
              {saveLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialCommunityIcons name="check" size={22} color="#FFFFFF" />
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      ) : task.status !== "completed" ? (
        <View style={styles.bottomActions}>
          <Pressable style={styles.rescheduleBtn} onPress={handleReschedule} disabled={actionLoading}>
            <MaterialCommunityIcons name="calendar-clock" size={20} color={COLORS.gradientStart} />
            <Text style={styles.rescheduleBtnText}>
              {task.scheduled_start ? "Reschedule" : "Schedule"}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.completeBtn, actionLoading && styles.completeBtnDisabled]}
            onPress={handleComplete}
            disabled={actionLoading}
          >
            <LinearGradient
              colors={actionLoading ? ["#D1D5DB", "#D1D5DB"] : [COLORS.success, "#4DAF6E"]}
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
        <View style={styles.completedBanner}>
          <MaterialCommunityIcons name="check-circle" size={20} color={COLORS.success} />
          <Text style={styles.completedBannerText}>Task completed</Text>
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
        schedulingMethod={task.scheduling_method as "SMART" | "MANUAL"}
        busySlots={busySlots}
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
    backgroundColor: COLORS.gradientStart,
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
    color: COLORS.gradientStart,
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
    backgroundColor: COLORS.gradientStart,
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
    color: COLORS.gradientStart,
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
    borderColor: COLORS.gradientStart,
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
    color: COLORS.gradientStart,
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
    backgroundColor: COLORS.gradientStart,
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
    backgroundColor: COLORS.gradientStart,
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
    color: COLORS.gradientStart,
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
  // Bottom actions
  bottomAction: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  saveButton: {
    borderRadius: 16,
    overflow: "hidden",
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
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
    paddingVertical: 16,
    paddingBottom: 32,
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
    borderColor: COLORS.gradientStart,
    backgroundColor: "#FFFFFF",
  },
  rescheduleBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.gradientStart,
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
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: "#D1FAE5",
  },
  completedBannerText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.success,
  },
});
