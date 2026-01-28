/**
 * Add Task Screen
 *
 * Form to create new task with SMART/MANUAL scheduling
 * Saves task to Supabase, then shows scheduling modal
 */

import { View, StyleSheet, ScrollView, Pressable, Platform } from "react-native";
import {
  Text,
  TextInput,
  Button,
  SegmentedButtons,
  RadioButton,
  HelperText,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useCallback } from "react";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { format, addDays } from "date-fns";
import DateTimePicker from "@react-native-community/datetimepicker";
import SchedulingModal from "@/components/SchedulingModal";
import { scheduleTask } from "@/lib/scheduling";
import { Task, TimeSlot, UserProfile, CalendarEvent } from "@/lib/types";
import {
  isGoogleCalendarConnected,
  createGoogleCalendarEvent,
} from "@/lib/google-calendar";

export default function AddTaskScreen() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("60");
  const [priority, setPriority] = useState("medium");
  const [schedulingMethod, setSchedulingMethod] = useState("SMART");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scheduling modal state
  const [showSchedulingModal, setShowSchedulingModal] = useState(false);
  const [createdTask, setCreatedTask] = useState<Task | null>(null);
  const [schedulingSlots, setSchedulingSlots] = useState<TimeSlot[]>([]);
  const [schedulingLoading, setSchedulingLoading] = useState(false);
  const [schedulingError, setSchedulingError] = useState<string | null>(null);
  const [busySlots, setBusySlots] = useState<{ start: string; end: string; title: string }[]>([]);

  const handleCreateTask = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validate
      if (!title.trim()) {
        setError("Title is required");
        return;
      }

      const durationNum = parseInt(duration);
      if (isNaN(durationNum) || durationNum < 5 || durationNum > 480) {
        setError("Duration must be between 5 and 480 minutes");
        return;
      }

      // Get user ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create task
      const { data: insertedTask, error: insertError } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          title: title.trim(),
          description: description.trim() || null,
          duration_minutes: durationNum,
          priority,
          scheduling_method: schedulingMethod,
          due_date: dueDate?.toISOString() || null,
          status: "pending_schedule",
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Store created task and show scheduling modal
      setCreatedTask(insertedTask as Task);
      setShowSchedulingModal(true);

      // Start scheduling process
      if (schedulingMethod === "SMART") {
        await runSmartScheduling(insertedTask as Task, user.id);
      } else {
        await loadBusySlots(user.id);
      }
    } catch (err) {
      console.error("[AddTask] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setLoading(false);
    }
  };

  // Run SMART scheduling - get AI recommendations
  const runSmartScheduling = async (task: Task, userId: string) => {
    try {
      setSchedulingLoading(true);
      setSchedulingError(null);

      // Fetch user profile
      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (profileError) throw profileError;

      // Fetch existing tasks
      const { data: existingTasks, error: tasksError } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["scheduled", "pending_schedule"])
        .neq("id", task.id);

      if (tasksError) throw tasksError;

      // Fetch calendar events
      const { data: calendarEvents, error: eventsError } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", userId)
        .gte("end_time", new Date().toISOString());

      // Run scheduling algorithm + AI
      const result = await scheduleTask({
        task,
        userProfile: profile as UserProfile,
        existingEvents: (calendarEvents || []) as CalendarEvent[],
        existingTasks: (existingTasks || []) as Task[],
        lookAheadDays: 14,
      });

      setSchedulingSlots(result.slots);
    } catch (err) {
      console.error("[AddTask] Scheduling error:", err);
      setSchedulingError(
        err instanceof Error ? err.message : "Failed to find available times"
      );
    } finally {
      setSchedulingLoading(false);
    }
  };

  // Load busy slots for MANUAL scheduling
  const loadBusySlots = async (userId: string) => {
    try {
      setSchedulingLoading(true);

      // Get scheduled tasks
      const { data: tasks } = await supabase
        .from("tasks")
        .select("title, scheduled_start, scheduled_end")
        .eq("user_id", userId)
        .eq("status", "scheduled")
        .not("scheduled_start", "is", null);

      // Get calendar events
      const { data: events } = await supabase
        .from("calendar_events")
        .select("title, start_time, end_time")
        .eq("user_id", userId)
        .gte("end_time", new Date().toISOString());

      const busy: { start: string; end: string; title: string }[] = [];

      // Add tasks
      tasks?.forEach((t) => {
        if (t.scheduled_start && t.scheduled_end) {
          busy.push({
            start: t.scheduled_start,
            end: t.scheduled_end,
            title: t.title,
          });
        }
      });

      // Add events
      events?.forEach((e) => {
        busy.push({
          start: e.start_time,
          end: e.end_time,
          title: e.title,
        });
      });

      setBusySlots(busy);
    } catch (err) {
      console.error("[AddTask] Load busy slots error:", err);
    } finally {
      setSchedulingLoading(false);
    }
  };

  // Handle slot selection from modal
  const handleSelectSlot = async (slot: TimeSlot) => {
    if (!createdTask) return;

    try {
      setSchedulingLoading(true);

      let googleEventId: string | null = null;

      // Create Google Calendar event if connected
      const isCalendarConnected = await isGoogleCalendarConnected();
      if (isCalendarConnected) {
        try {
          googleEventId = await createGoogleCalendarEvent(
            createdTask.title,
            createdTask.description,
            slot.start,
            slot.end
          );
        } catch (calError) {
          console.warn("[AddTask] Failed to create calendar event:", calError);
          // Continue without calendar event - don't block scheduling
        }
      }

      // Update task with scheduled time and optional google_event_id
      const updateData: Record<string, unknown> = {
        scheduled_start: slot.start,
        scheduled_end: slot.end,
        status: "scheduled",
      };

      if (googleEventId) {
        updateData.google_event_id = googleEventId;
      }

      const { error: updateError } = await supabase
        .from("tasks")
        .update(updateData)
        .eq("id", createdTask.id);

      if (updateError) throw updateError;

      // Success - close modal and go back
      setShowSchedulingModal(false);
      router.back();
    } catch (err) {
      console.error("[AddTask] Update error:", err);
      setSchedulingError(
        err instanceof Error ? err.message : "Failed to schedule task"
      );
    } finally {
      setSchedulingLoading(false);
    }
  };

  // Handle modal close (skip scheduling for now)
  const handleCloseModal = () => {
    setShowSchedulingModal(false);
    // Task is saved but not scheduled - go back anyway
    router.back();
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === "ios");
    if (selectedDate) {
      setDueDate(selectedDate);
    }
  };

  const quickDueDates = [
    { label: "Today", date: new Date() },
    { label: "Tomorrow", date: addDays(new Date(), 1) },
    { label: "This Week", date: addDays(new Date(), 7) },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.title}>
          New Task
        </Text>
      </View>

      <ScrollView style={styles.content}>
        <TextInput
          label="Task Title"
          value={title}
          onChangeText={setTitle}
          mode="outlined"
          style={styles.input}
          placeholder="e.g., Write proposal"
        />

        <TextInput
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          mode="outlined"
          multiline
          numberOfLines={3}
          style={styles.input}
          placeholder="Add details about this task..."
        />

        <TextInput
          label="Duration (minutes)"
          value={duration}
          onChangeText={setDuration}
          mode="outlined"
          keyboardType="numeric"
          style={styles.input}
          placeholder="60"
        />

        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Priority
          </Text>
          <SegmentedButtons
            value={priority}
            onValueChange={setPriority}
            buttons={[
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]}
          />
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Due Date (optional)
          </Text>
          <View style={styles.quickDates}>
            {quickDueDates.map((item) => (
              <Pressable
                key={item.label}
                style={[
                  styles.quickDateButton,
                  dueDate && format(dueDate, "yyyy-MM-dd") === format(item.date, "yyyy-MM-dd") &&
                    styles.quickDateButtonSelected,
                ]}
                onPress={() => setDueDate(item.date)}
              >
                <Text
                  style={[
                    styles.quickDateText,
                    dueDate && format(dueDate, "yyyy-MM-dd") === format(item.date, "yyyy-MM-dd") &&
                      styles.quickDateTextSelected,
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={styles.quickDateButton}
              onPress={() => setShowDatePicker(true)}
            >
              <Text style={styles.quickDateText}>Pick Date</Text>
            </Pressable>
          </View>
          {dueDate && (
            <Text variant="bodySmall" style={styles.selectedDate}>
              Due: {format(dueDate, "EEEE, MMMM d, yyyy")}
            </Text>
          )}
          {showDatePicker && (
            <DateTimePicker
              value={dueDate || new Date()}
              mode="date"
              minimumDate={new Date()}
              onChange={handleDateChange}
            />
          )}
        </View>

        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Scheduling Method
          </Text>

          <RadioButton.Group
            onValueChange={setSchedulingMethod}
            value={schedulingMethod}
          >
            <View style={styles.radioOption}>
              <RadioButton.Item
                label="Let AI pick the best time"
                value="SMART"
                position="leading"
              />
              <Text variant="bodySmall" style={styles.radioDescription}>
                AI analyzes your schedule and personality to find optimal time
              </Text>
            </View>

            <View style={styles.radioOption}>
              <RadioButton.Item
                label="I'll pick the time myself"
                value="MANUAL"
                position="leading"
              />
              <Text variant="bodySmall" style={styles.radioDescription}>
                Choose exact time from calendar picker
              </Text>
            </View>
          </RadioButton.Group>
        </View>

        {error && (
          <HelperText type="error" visible={!!error} style={styles.error}>
            {error}
          </HelperText>
        )}

        <Button
          mode="contained"
          onPress={handleCreateTask}
          style={styles.button}
          contentStyle={styles.buttonContent}
          disabled={!title.trim() || loading}
          loading={loading}
        >
          {loading ? "Creating..." : "Create Task"}
        </Button>
      </ScrollView>

      {/* Scheduling Modal */}
      <SchedulingModal
        visible={showSchedulingModal}
        onClose={handleCloseModal}
        onSelectSlot={handleSelectSlot}
        task={createdTask}
        slots={schedulingSlots}
        isLoading={schedulingLoading}
        error={schedulingError}
        schedulingMethod={schedulingMethod as "SMART" | "MANUAL"}
        busySlots={busySlots}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    padding: 24,
    paddingTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  title: {
    fontWeight: "bold",
  },
  content: {
    flex: 1,
    padding: 24,
  },
  input: {
    marginBottom: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 12,
    fontWeight: "600",
  },
  quickDates: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickDateButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  quickDateButtonSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  quickDateText: {
    color: "#64748b",
    fontSize: 14,
  },
  quickDateTextSelected: {
    color: "#2563eb",
    fontWeight: "500",
  },
  selectedDate: {
    marginTop: 12,
    color: "#2563eb",
  },
  radioOption: {
    marginBottom: 16,
  },
  radioDescription: {
    color: "#64748b",
    marginLeft: 54,
    marginTop: -8,
    marginBottom: 8,
  },
  error: {
    marginBottom: 8,
  },
  button: {
    marginTop: 8,
    marginBottom: 32,
  },
  buttonContent: {
    paddingVertical: 8,
  },
});
