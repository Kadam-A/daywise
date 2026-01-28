/**
 * Task Detail Screen
 *
 * Shows task details with actions:
 * - Mark Complete
 * - Reschedule
 * - Delete
 */

import { View, StyleSheet, ScrollView, Alert } from "react-native";
import {
  Text,
  Button,
  Surface,
  Chip,
  ProgressBar,
  IconButton,
  Divider,
  ActivityIndicator,
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

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // Navigate back to home
  const goBack = () => {
    router.replace("/(tabs)/home");
  };
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

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

      const { error } = await supabase
        .from("tasks")
        .update({ status: "completed" })
        .eq("id", task.id);

      if (error) throw error;

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

      const { error } = await supabase
        .from("tasks")
        .update(updateData)
        .eq("id", task.id);

      if (error) throw error;

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
    height: 28,
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
});
