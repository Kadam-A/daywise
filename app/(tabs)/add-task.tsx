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
  Chip,
  IconButton,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useCallback, useEffect } from "react";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { format, addDays } from "date-fns";
import DateTimePicker from "@react-native-community/datetimepicker";
import SchedulingModal from "@/components/SchedulingModal";
import { scheduleTask } from "@/lib/scheduling";
import { Task, TimeSlot, UserProfile, CalendarEvent, RecurrenceRule } from "@/lib/types";
import {
  isGoogleCalendarConnected,
  createGoogleCalendarEvent,
} from "@/lib/google-calendar";
import { scheduleTaskReminder } from "@/lib/notifications";

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

  // Tag state
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  // Recurrence state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([1, 3, 5]); // Mon, Wed, Fri default

  const toggleRecurrenceDay = (day: number) => {
    if (recurrenceDays.includes(day)) {
      setRecurrenceDays(recurrenceDays.filter((d) => d !== day));
    } else {
      setRecurrenceDays([...recurrenceDays, day].sort());
    }
  };

  const dayLabels = [
    { day: 1, label: "M" },
    { day: 2, label: "T" },
    { day: 3, label: "W" },
    { day: 4, label: "T" },
    { day: 5, label: "F" },
    { day: 6, label: "S" },
    { day: 7, label: "S" },
  ];

  // Fetch existing tags on mount
  useEffect(() => {
    loadExistingTags();
  }, []);

  const loadExistingTags = async () => {
    try {
      const { data: tasks } = await supabase
        .from("tasks")
        .select("tags")
        .not("tags", "eq", "{}");

      if (tasks) {
        // Extract unique tags from all tasks
        const allTags = new Set<string>();
        tasks.forEach((task) => {
          if (task.tags) {
            task.tags.forEach((tag: string) => allTags.add(tag));
          }
        });
        setExistingTags(Array.from(allTags).sort());
      }
    } catch (err) {
      console.error("[AddTask] Error loading tags:", err);
    }
  };

  const addTag = (tag: string) => {
    const trimmedTag = tag.trim().toLowerCase();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
    }
    setTagInput("");
    setShowTagSuggestions(false);
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const filteredSuggestions = existingTags.filter(
    (t) =>
      t.toLowerCase().includes(tagInput.toLowerCase()) &&
      !tags.includes(t.toLowerCase())
  );

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

      // Build recurrence rule if recurring
      const recurrenceRule: RecurrenceRule | null = isRecurring
        ? {
            frequency: recurrenceFrequency,
            ...(recurrenceFrequency === "weekly" && { days: recurrenceDays }),
          }
        : null;

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
          tags: tags.length > 0 ? tags : [],
          is_recurring: isRecurring,
          recurrence_rule: recurrenceRule,
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

      const { data: updatedTask, error: updateError } = await supabase
        .from("tasks")
        .update(updateData)
        .eq("id", createdTask.id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Schedule notification reminder
      if (updatedTask) {
        await scheduleTaskReminder(updatedTask as Task);
      }

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
        {/* ESSENTIAL INFO */}
        <TextInput
          label="What do you need to do?"
          value={title}
          onChangeText={setTitle}
          mode="outlined"
          style={styles.input}
          placeholder="e.g., Write proposal"
        />

        {/* Duration and Priority - grouped */}
        <View style={styles.rowSection}>
          <View style={styles.durationContainer}>
            <TextInput
              label="Duration"
              value={duration}
              onChangeText={setDuration}
              mode="outlined"
              keyboardType="numeric"
              placeholder="60"
              right={<TextInput.Affix text="min" />}
            />
          </View>
          <View style={styles.priorityContainer}>
            <Text variant="labelMedium" style={styles.rowLabel}>Priority</Text>
            <SegmentedButtons
              value={priority}
              onValueChange={setPriority}
              buttons={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Med" },
                { value: "high", label: "High" },
              ]}
              density="small"
            />
          </View>
        </View>

        {/* Due Date */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Due Date
          </Text>
          <View style={styles.quickDates}>
            <Pressable
              style={[styles.quickDateButton, !dueDate && styles.quickDateButtonSelected]}
              onPress={() => setDueDate(null)}
            >
              <Text style={[styles.quickDateText, !dueDate && styles.quickDateTextSelected]}>
                No deadline
              </Text>
            </Pressable>
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
              <Text style={styles.quickDateText}>Other</Text>
            </Pressable>
          </View>
          {dueDate && (
            <Text variant="bodySmall" style={styles.selectedDate}>
              Due: {format(dueDate, "EEE, MMM d")}
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

        {/* Scheduling Method - simplified */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            How should we schedule this?
          </Text>
          <View style={styles.schedulingOptions}>
            <Pressable
              style={[
                styles.schedulingOption,
                schedulingMethod === "SMART" && styles.schedulingOptionSelected,
              ]}
              onPress={() => setSchedulingMethod("SMART")}
            >
              <Text style={[
                styles.schedulingOptionTitle,
                schedulingMethod === "SMART" && styles.schedulingOptionTitleSelected,
              ]}>
                AI picks best time
              </Text>
              <Text style={styles.schedulingOptionDesc}>
                Finds your optimal focus time
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.schedulingOption,
                schedulingMethod === "MANUAL" && styles.schedulingOptionSelected,
              ]}
              onPress={() => setSchedulingMethod("MANUAL")}
            >
              <Text style={[
                styles.schedulingOptionTitle,
                schedulingMethod === "MANUAL" && styles.schedulingOptionTitleSelected,
              ]}>
                I'll pick
              </Text>
              <Text style={styles.schedulingOptionDesc}>
                Choose from calendar
              </Text>
            </Pressable>
          </View>
        </View>

        {/* OPTIONAL SECTIONS - Collapsible feel */}
        <View style={styles.optionalDivider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>Optional</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Description */}
        <TextInput
          label="Notes"
          value={description}
          onChangeText={setDescription}
          mode="outlined"
          multiline
          numberOfLines={2}
          style={styles.input}
          placeholder="Add details..."
        />

        {/* Recurrence Section - simplified */}
        <View style={styles.section}>
          <View style={styles.recurrenceToggle}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Repeat
            </Text>
            <Pressable
              style={[
                styles.toggleButton,
                isRecurring && styles.toggleButtonActive,
              ]}
              onPress={() => setIsRecurring(!isRecurring)}
            >
              <Text
                style={[
                  styles.toggleButtonText,
                  isRecurring && styles.toggleButtonTextActive,
                ]}
              >
                {isRecurring ? "ON" : "OFF"}
              </Text>
            </Pressable>
          </View>

          {isRecurring && (
            <View style={styles.recurrenceOptions}>
              <SegmentedButtons
                value={recurrenceFrequency}
                onValueChange={(value) =>
                  setRecurrenceFrequency(value as "daily" | "weekly" | "monthly")
                }
                buttons={[
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
                style={styles.frequencyButtons}
                density="small"
              />

              {recurrenceFrequency === "weekly" && (
                <View style={styles.daySelector}>
                  <View style={styles.dayButtons}>
                    {dayLabels.map(({ day, label }) => (
                      <Pressable
                        key={day}
                        style={[
                          styles.dayButton,
                          recurrenceDays.includes(day) && styles.dayButtonActive,
                        ]}
                        onPress={() => toggleRecurrenceDay(day)}
                      >
                        <Text
                          style={[
                            styles.dayButtonText,
                            recurrenceDays.includes(day) && styles.dayButtonTextActive,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Tags Section */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Tags
          </Text>

          {tags.length > 0 && (
            <View style={styles.tagChips}>
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  onClose={() => removeTag(tag)}
                  style={styles.tagChip}
                  textStyle={styles.tagChipText}
                >
                  {tag}
                </Chip>
              ))}
            </View>
          )}

          <View style={styles.tagInputContainer}>
            <TextInput
              mode="outlined"
              placeholder="Add tag..."
              value={tagInput}
              onChangeText={(text) => {
                setTagInput(text);
                setShowTagSuggestions(text.length > 0);
              }}
              onSubmitEditing={() => {
                if (tagInput.trim()) addTag(tagInput);
              }}
              style={styles.tagInput}
              dense
              right={
                tagInput.trim() ? (
                  <TextInput.Icon
                    icon="plus"
                    onPress={() => addTag(tagInput)}
                  />
                ) : undefined
              }
            />
          </View>

          {showTagSuggestions && filteredSuggestions.length > 0 && (
            <View style={styles.tagSuggestions}>
              {filteredSuggestions.slice(0, 5).map((tag) => (
                <Pressable
                  key={tag}
                  style={styles.tagSuggestion}
                  onPress={() => addTag(tag)}
                >
                  <Text style={styles.tagSuggestionText}>{tag}</Text>
                </Pressable>
              ))}
            </View>
          )}
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
    marginBottom: 20,
  },
  sectionTitle: {
    marginBottom: 10,
    fontWeight: "600",
  },
  // Row layout for duration + priority
  rowSection: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 20,
  },
  durationContainer: {
    flex: 1,
  },
  priorityContainer: {
    flex: 1.5,
  },
  rowLabel: {
    marginBottom: 8,
    color: "#666",
  },
  // Scheduling options
  schedulingOptions: {
    flexDirection: "row",
    gap: 12,
  },
  schedulingOption: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#e2e8f0",
    backgroundColor: "#ffffff",
  },
  schedulingOptionSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  schedulingOptionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    marginBottom: 4,
  },
  schedulingOptionTitleSelected: {
    color: "#2563eb",
  },
  schedulingOptionDesc: {
    fontSize: 12,
    color: "#64748b",
  },
  // Optional divider
  optionalDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e2e8f0",
  },
  dividerText: {
    paddingHorizontal: 12,
    fontSize: 12,
    color: "#94a3b8",
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
  // Tag styles
  tagChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  tagChip: {
    backgroundColor: "#e0f2fe",
    height: "auto",
  },
  tagChipText: {
    fontSize: 13,
  },
  tagInputContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  tagInput: {
    flex: 1,
    backgroundColor: "#fff",
  },
  tagSuggestions: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginTop: 4,
    overflow: "hidden",
  },
  tagSuggestion: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tagSuggestionText: {
    color: "#334155",
  },
  // Recurrence styles
  recurrenceToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toggleButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#e2e8f0",
  },
  toggleButtonActive: {
    backgroundColor: "#2563eb",
  },
  toggleButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  toggleButtonTextActive: {
    color: "#ffffff",
  },
  recurrenceOptions: {
    marginTop: 16,
  },
  frequencyButtons: {
    marginBottom: 16,
  },
  daySelector: {
    marginBottom: 12,
  },
  daySelectorLabel: {
    color: "#64748b",
    marginBottom: 8,
  },
  dayButtons: {
    flexDirection: "row",
    gap: 8,
  },
  dayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f1f5f9",
    justifyContent: "center",
    alignItems: "center",
  },
  dayButtonActive: {
    backgroundColor: "#2563eb",
  },
  dayButtonText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#64748b",
  },
  dayButtonTextActive: {
    color: "#ffffff",
  },
  recurrenceHint: {
    color: "#64748b",
    fontStyle: "italic",
  },
});
