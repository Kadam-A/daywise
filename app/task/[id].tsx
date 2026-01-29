/**
 * Task Detail Screen
 *
 * Shows task details with actions:
 * - Mark Complete
 * - Reschedule
 * - Delete
 */

import { View, StyleSheet, ScrollView, Alert, TextInput as RNTextInput } from "react-native";
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
import { useState, useEffect, useCallback } from "react";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading task...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!task) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text>Task not found</Text>
          <Button onPress={() => goBack()}>Go Back</Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton icon="arrow-left" size={24} onPress={() => goBack()} />
        <Text variant="titleLarge" style={styles.headerTitle}>
          Task Details
        </Text>
        <IconButton
          icon="delete-outline"
          size={24}
          onPress={handleDelete}
          disabled={actionLoading}
        />
      </View>

      <ScrollView style={styles.content}>
        {/* Title and Status */}
        <View style={styles.titleSection}>
          <Text variant="headlineSmall" style={styles.title}>
            {task.title}
          </Text>
          <View style={styles.chips}>
            <Chip
              style={[
                styles.chip,
                { backgroundColor: getStatusColor(task.status) + "20" },
              ]}
              textStyle={{ color: getStatusColor(task.status) }}
            >
              {getStatusLabel(task.status)}
            </Chip>
            <Chip
              style={[
                styles.chip,
                { backgroundColor: getPriorityColor(task.priority) + "20" },
              ]}
              textStyle={{ color: getPriorityColor(task.priority) }}
            >
              {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}{" "}
              Priority
            </Chip>
            {/* Recurring indicator */}
            {(task.is_recurring || isRecurringInstance(task)) && (
              <Chip
                icon="repeat"
                style={[styles.chip, { backgroundColor: "#e0f2fe" }]}
                textStyle={{ color: "#0369a1" }}
              >
                {task.recurrence_rule
                  ? getRecurrenceDescription(task.recurrence_rule)
                  : "Recurring"}
              </Chip>
            )}
          </View>
        </View>

        {/* Description */}
        {task.description && (
          <Surface style={styles.card} elevation={1}>
            <Text variant="titleSmall" style={styles.cardTitle}>
              Description
            </Text>
            <Text style={styles.description}>{task.description}</Text>
          </Surface>
        )}

        {/* Scheduled Time */}
        {task.scheduled_start && task.scheduled_end && (
          <Surface style={styles.card} elevation={1}>
            <Text variant="titleSmall" style={styles.cardTitle}>
              Scheduled Time
            </Text>
            <Text style={styles.dateText}>{formatDate(task.scheduled_start)}</Text>
            <Text style={styles.timeText}>
              {formatTimeRange(task.scheduled_start, task.scheduled_end)}
            </Text>
          </Surface>
        )}

        {/* Details */}
        <Surface style={styles.card} elevation={1}>
          <Text variant="titleSmall" style={styles.cardTitle}>
            Details
          </Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Duration</Text>
            <Text style={styles.detailValue}>{task.duration_minutes} min</Text>
          </View>

          <Divider style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Scheduling</Text>
            <Text style={styles.detailValue}>
              {task.scheduling_method === "SMART" ? "AI Optimized" : "Manual"}
            </Text>
          </View>

          {task.due_date && (
            <>
              <Divider style={styles.divider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Due Date</Text>
                <Text style={styles.detailValue}>{formatDate(task.due_date)}</Text>
              </View>
            </>
          )}

          <Divider style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Auto-reschedule</Text>
            <Text style={styles.detailValue}>
              {task.auto_reschedule ? "Enabled" : "Disabled"}
            </Text>
          </View>
        </Surface>

        {/* Subtasks Section - only show for parent tasks */}
        {!task.parent_task_id && (
          <Surface style={styles.card} elevation={1}>
            <View style={styles.subtaskHeader}>
              <Text variant="titleSmall" style={styles.cardTitle}>
                Subtasks
              </Text>
              {subtasks.length > 0 && (
                <Text style={styles.subtaskProgress}>{getSubtaskProgressText()}</Text>
              )}
            </View>

            {/* Progress bar */}
            {subtasks.length > 0 && (
              <ProgressBar
                progress={getSubtaskProgress()}
                color="#4caf50"
                style={styles.progressBar}
              />
            )}

            {/* Subtask list */}
            {subtasks.map((subtask) => (
              <View key={subtask.id} style={styles.subtaskItem}>
                <Checkbox
                  status={subtask.status === "completed" ? "checked" : "unchecked"}
                  onPress={() => handleToggleSubtask(subtask)}
                />
                <Text
                  style={[
                    styles.subtaskTitle,
                    subtask.status === "completed" && styles.subtaskCompleted,
                  ]}
                  onPress={() => router.push(`/task/${subtask.id}`)}
                >
                  {subtask.title}
                </Text>
              </View>
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
                  dense
                  autoFocus
                  onSubmitEditing={handleAddSubtask}
                />
                <View style={styles.addSubtaskButtons}>
                  <Button
                    mode="text"
                    onPress={() => {
                      setShowAddSubtask(false);
                      setNewSubtaskTitle("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    mode="contained"
                    onPress={handleAddSubtask}
                    loading={addingSubtask}
                    disabled={!newSubtaskTitle.trim() || addingSubtask}
                  >
                    Add
                  </Button>
                </View>
              </View>
            ) : (
              <Button
                mode="text"
                icon="plus"
                onPress={() => setShowAddSubtask(true)}
                style={styles.addSubtaskButton}
              >
                Add Subtask
              </Button>
            )}

            {subtasks.length === 0 && !showAddSubtask && (
              <Text style={styles.noSubtasks}>
                Break this task into smaller steps
              </Text>
            )}
          </Surface>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {task.status !== "completed" && (
            <Button
              mode="contained"
              onPress={handleComplete}
              style={styles.completeButton}
              icon="check"
              loading={actionLoading}
              disabled={actionLoading}
            >
              Mark Complete
            </Button>
          )}

          {task.status !== "completed" && (
            <Button
              mode="outlined"
              onPress={handleReschedule}
              style={styles.rescheduleButton}
              icon="calendar-clock"
              disabled={actionLoading}
            >
              {task.scheduled_start ? "Reschedule" : "Schedule Now"}
            </Button>
          )}

          {task.status === "completed" && (
            <Surface style={styles.completedBanner} elevation={0}>
              <Text style={styles.completedText}>
                This task has been completed
              </Text>
            </Surface>
          )}
        </View>
      </ScrollView>

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
    backgroundColor: "#f5f5f5",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#666",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontWeight: "600",
  },
  content: {
    flex: 1,
    padding: 16,
  },
  titleSection: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  title: {
    fontWeight: "bold",
    marginBottom: 12,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    height: "auto",
    maxWidth: "100%",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontWeight: "600",
    marginBottom: 12,
    color: "#666",
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
    color: "#333",
  },
  dateText: {
    fontSize: 16,
    color: "#333",
    marginBottom: 4,
  },
  timeText: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#2196f3",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 14,
    color: "#666",
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  divider: {
    marginVertical: 4,
  },
  actions: {
    gap: 12,
    paddingBottom: 32,
  },
  completeButton: {
    backgroundColor: "#4caf50",
  },
  rescheduleButton: {},
  completedBanner: {
    backgroundColor: "#e8f5e9",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  completedText: {
    color: "#4caf50",
    fontWeight: "500",
  },
  // Subtask styles
  subtaskHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  subtaskProgress: {
    fontSize: 12,
    color: "#666",
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    marginBottom: 12,
  },
  subtaskItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  subtaskTitle: {
    flex: 1,
    fontSize: 14,
    color: "#333",
  },
  subtaskCompleted: {
    textDecorationLine: "line-through",
    color: "#999",
  },
  addSubtaskContainer: {
    marginTop: 8,
  },
  addSubtaskInput: {
    backgroundColor: "#fff",
  },
  addSubtaskButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  addSubtaskButton: {
    marginTop: 8,
  },
  noSubtasks: {
    fontSize: 13,
    color: "#999",
    textAlign: "center",
    paddingVertical: 12,
  },
});
