/**
 * Add Task Screen - "Fluid Intelligence" Design
 *
 * Conversational task creation flow with AI-first scheduling
 * Clean, focused interface that guides users naturally
 */

import { View, StyleSheet, ScrollView, Pressable, Platform, KeyboardAvoidingView, Animated } from "react-native";
import { Text, TextInput, HelperText, ActivityIndicator } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useState, useCallback, useEffect, useRef } from "react";
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
  borderFocus: "#4A90E2",
  priorityHigh: "#E25555",
  priorityMedium: "#F5A962",
  priorityLow: "#5FBF73",
  aiPurple: "#7C6FBF",
  aiPurpleLight: "#E8E5F5",
  error: "#E25555",
};

// Duration presets for quick selection
const DURATION_PRESETS = [
  { value: "15", label: "15m", icon: "lightning-bolt" },
  { value: "30", label: "30m", icon: "timer-sand" },
  { value: "60", label: "1h", icon: "clock-outline" },
  { value: "120", label: "2h", icon: "clock" },
];

// Priority options
const PRIORITY_OPTIONS = [
  { value: "low", label: "Low", color: COLORS.priorityLow, icon: "flag-outline" },
  { value: "medium", label: "Medium", color: COLORS.priorityMedium, icon: "flag" },
  { value: "high", label: "High", color: COLORS.priorityHigh, icon: "flag-variant" },
];

export default function AddTaskScreen() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("30");
  const [customDuration, setCustomDuration] = useState("");
  const [priority, setPriority] = useState("medium");
  const [schedulingMethod, setSchedulingMethod] = useState("SMART");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, []);

  // Scroll to bottom when tag input is focused
  const scrollToBottom = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Tag state
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  // Recurrence state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([1, 3, 5]);

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
    { day: 0, label: "S" },
  ];

  // Scheduling modal state
  const [showSchedulingModal, setShowSchedulingModal] = useState(false);
  const [createdTask, setCreatedTask] = useState<Task | null>(null);
  const [schedulingSlots, setSchedulingSlots] = useState<TimeSlot[]>([]);
  const [schedulingLoading, setSchedulingLoading] = useState(false);
  const [schedulingError, setSchedulingError] = useState<string | null>(null);
  const [busySlots, setBusySlots] = useState<{ start: string; end: string; title: string }[]>([]);

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
    (t) => t.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(t.toLowerCase())
  );

  const getEffectiveDuration = () => {
    if (customDuration) return customDuration;
    return duration;
  };

  const handleCreateTask = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!title.trim()) {
        setError("What do you need to do?");
        return;
      }

      const durationNum = parseInt(getEffectiveDuration());
      if (isNaN(durationNum) || durationNum < 5 || durationNum > 480) {
        setError("Duration must be between 5 and 480 minutes");
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const recurrenceRule: RecurrenceRule | null = isRecurring
        ? {
            frequency: recurrenceFrequency,
            ...(recurrenceFrequency === "weekly" && { days: recurrenceDays }),
          }
        : null;

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

      setCreatedTask(insertedTask as Task);
      setShowSchedulingModal(true);

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

  const runSmartScheduling = async (task: Task, userId: string) => {
    try {
      setSchedulingLoading(true);
      setSchedulingError(null);

      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (profileError) throw profileError;

      const { data: existingTasks, error: tasksError } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["scheduled", "pending_schedule"])
        .neq("id", task.id);

      if (tasksError) throw tasksError;

      const { data: calendarEvents } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", userId)
        .gte("end_time", new Date().toISOString());

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
      setSchedulingError(err instanceof Error ? err.message : "Failed to find available times");
    } finally {
      setSchedulingLoading(false);
    }
  };

  const loadBusySlots = async (userId: string) => {
    try {
      setSchedulingLoading(true);

      const { data: tasks } = await supabase
        .from("tasks")
        .select("title, scheduled_start, scheduled_end")
        .eq("user_id", userId)
        .eq("status", "scheduled")
        .not("scheduled_start", "is", null);

      const { data: events } = await supabase
        .from("calendar_events")
        .select("title, start_time, end_time")
        .eq("user_id", userId)
        .gte("end_time", new Date().toISOString());

      const busy: { start: string; end: string; title: string }[] = [];

      tasks?.forEach((t) => {
        if (t.scheduled_start && t.scheduled_end) {
          busy.push({ start: t.scheduled_start, end: t.scheduled_end, title: t.title });
        }
      });

      events?.forEach((e) => {
        busy.push({ start: e.start_time, end: e.end_time, title: e.title });
      });

      setBusySlots(busy);
    } catch (err) {
      console.error("[AddTask] Load busy slots error:", err);
    } finally {
      setSchedulingLoading(false);
    }
  };

  const handleSelectSlot = async (slot: TimeSlot) => {
    if (!createdTask) return;

    try {
      setSchedulingLoading(true);

      let googleEventId: string | null = null;

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
        }
      }

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

      if (updatedTask) {
        await scheduleTaskReminder(updatedTask as Task);
      }

      setShowSchedulingModal(false);
      router.back();
    } catch (err) {
      console.error("[AddTask] Update error:", err);
      setSchedulingError(err instanceof Error ? err.message : "Failed to schedule task");
    } finally {
      setSchedulingLoading(false);
    }
  };

  const handleCloseModal = () => {
    setShowSchedulingModal(false);
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
    { label: "Next Week", date: addDays(new Date(), 7) },
  ];

  const isDueDateSelected = (date: Date) => {
    if (!dueDate) return false;
    return format(dueDate, "yyyy-MM-dd") === format(date, "yyyy-MM-dd");
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        {/* Header */}
        <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>New Task</Text>
          <View style={styles.headerSpacer} />
        </Animated.View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Main Input - Hero Style */}
          <View style={styles.heroSection}>
            <TextInput
              placeholder="What needs to be done?"
              value={title}
              onChangeText={setTitle}
              style={styles.heroInput}
              mode="flat"
              underlineColor="transparent"
              activeUnderlineColor="transparent"
              placeholderTextColor={COLORS.textTertiary}
              cursorColor={COLORS.gradientStart}
              selectionColor={`${COLORS.gradientStart}40`}
              theme={{ colors: { primary: COLORS.gradientStart } }}
            />
          </View>

          {/* Duration Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>How long will this take?</Text>
            <View style={styles.durationGrid}>
              {DURATION_PRESETS.map((preset) => (
                <Pressable
                  key={preset.value}
                  style={[
                    styles.durationCard,
                    duration === preset.value && !customDuration && styles.durationCardActive,
                  ]}
                  onPress={() => {
                    setDuration(preset.value);
                    setCustomDuration("");
                  }}
                >
                  <MaterialCommunityIcons
                    name={preset.icon as any}
                    size={20}
                    color={duration === preset.value && !customDuration ? COLORS.gradientStart : COLORS.textTertiary}
                  />
                  <Text
                    style={[
                      styles.durationCardText,
                      duration === preset.value && !customDuration && styles.durationCardTextActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.customDurationRow}>
              <TextInput
                placeholder="Custom duration"
                value={customDuration}
                onChangeText={setCustomDuration}
                style={styles.customDurationInput}
                mode="outlined"
                keyboardType="numeric"
                outlineColor={COLORS.border}
                activeOutlineColor={COLORS.gradientStart}
                right={<TextInput.Affix text="min" textStyle={styles.durationAffix} />}
                dense
              />
            </View>
          </View>

          {/* Priority Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Priority</Text>
            <View style={styles.priorityRow}>
              {PRIORITY_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={[
                    styles.priorityCard,
                    priority === option.value && { borderColor: option.color, backgroundColor: `${option.color}10` },
                  ]}
                  onPress={() => setPriority(option.value)}
                >
                  <MaterialCommunityIcons
                    name={option.icon as any}
                    size={18}
                    color={priority === option.value ? option.color : COLORS.textTertiary}
                  />
                  <Text
                    style={[
                      styles.priorityCardText,
                      priority === option.value && { color: option.color },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Scheduling Method */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>How should we schedule this?</Text>
            <View style={styles.schedulingRow}>
              <Pressable
                style={[styles.schedulingCard, schedulingMethod === "SMART" && styles.schedulingCardActive]}
                onPress={() => setSchedulingMethod("SMART")}
              >
                <LinearGradient
                  colors={schedulingMethod === "SMART" ? [COLORS.gradientStart, COLORS.gradientEnd] : ["transparent", "transparent"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.schedulingCardGradient}
                >
                  <MaterialCommunityIcons
                    name="robot-outline"
                    size={28}
                    color={schedulingMethod === "SMART" ? "#FFFFFF" : COLORS.aiPurple}
                  />
                </LinearGradient>
                <View style={styles.schedulingCardContent}>
                  <Text style={[styles.schedulingCardTitle, schedulingMethod === "SMART" && styles.schedulingCardTitleActive]}>
                    AI Scheduling
                  </Text>
                  <Text style={styles.schedulingCardDesc}>Find the best time based on your patterns</Text>
                </View>
                {schedulingMethod === "SMART" && (
                  <MaterialCommunityIcons name="check-circle" size={22} color={COLORS.gradientStart} />
                )}
              </Pressable>

              <Pressable
                style={[styles.schedulingCard, schedulingMethod === "MANUAL" && styles.schedulingCardActive]}
                onPress={() => setSchedulingMethod("MANUAL")}
              >
                <View style={[styles.schedulingCardIcon, schedulingMethod === "MANUAL" && styles.schedulingCardIconActive]}>
                  <MaterialCommunityIcons
                    name="calendar-cursor"
                    size={28}
                    color={schedulingMethod === "MANUAL" ? "#FFFFFF" : COLORS.textTertiary}
                  />
                </View>
                <View style={styles.schedulingCardContent}>
                  <Text style={[styles.schedulingCardTitle, schedulingMethod === "MANUAL" && styles.schedulingCardTitleActive]}>
                    Pick Manually
                  </Text>
                  <Text style={styles.schedulingCardDesc}>Choose your own time slot</Text>
                </View>
                {schedulingMethod === "MANUAL" && (
                  <MaterialCommunityIcons name="check-circle" size={22} color={COLORS.gradientStart} />
                )}
              </Pressable>
            </View>
          </View>

          {/* Due Date */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Due date (optional)</Text>
            <View style={styles.dueDateRow}>
              <Pressable
                style={[styles.dueDateChip, !dueDate && styles.dueDateChipActive]}
                onPress={() => setDueDate(null)}
              >
                <Text style={[styles.dueDateChipText, !dueDate && styles.dueDateChipTextActive]}>
                  No deadline
                </Text>
              </Pressable>
              {quickDueDates.map((item) => (
                <Pressable
                  key={item.label}
                  style={[styles.dueDateChip, isDueDateSelected(item.date) && styles.dueDateChipActive]}
                  onPress={() => setDueDate(item.date)}
                >
                  <Text style={[styles.dueDateChipText, isDueDateSelected(item.date) && styles.dueDateChipTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
              <Pressable style={styles.dueDateChip} onPress={() => setShowDatePicker(true)}>
                <MaterialCommunityIcons name="calendar" size={16} color={COLORS.textTertiary} />
              </Pressable>
            </View>
            {dueDate && !quickDueDates.some((d) => isDueDateSelected(d.date)) && (
              <Text style={styles.selectedDateText}>Due: {format(dueDate, "EEE, MMM d")}</Text>
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

          {/* Expandable Options */}
          <View style={styles.optionalSection}>
            <View style={styles.optionalDivider}>
              <View style={styles.optionalDividerLine} />
              <Text style={styles.optionalDividerText}>Additional options</Text>
              <View style={styles.optionalDividerLine} />
            </View>

            {/* Notes */}
            <View style={styles.optionalItem}>
              <TextInput
                placeholder="Add notes..."
                value={description}
                onChangeText={setDescription}
                style={styles.notesInput}
                mode="outlined"
                multiline
                numberOfLines={3}
                outlineColor={COLORS.border}
                activeOutlineColor={COLORS.gradientStart}
                cursorColor={COLORS.gradientStart}
                contentStyle={styles.notesInputContent}
              />
            </View>

            {/* Repeat */}
            <View style={styles.optionalItem}>
              <Pressable
                style={styles.repeatToggle}
                onPress={() => setIsRecurring(!isRecurring)}
              >
                <View style={styles.repeatToggleLeft}>
                  <MaterialCommunityIcons
                    name="repeat"
                    size={20}
                    color={isRecurring ? COLORS.aiPurple : COLORS.textTertiary}
                  />
                  <Text style={[styles.repeatToggleText, isRecurring && styles.repeatToggleTextActive]}>
                    Repeat this task
                  </Text>
                </View>
                <View style={[styles.toggleSwitch, isRecurring && styles.toggleSwitchActive]}>
                  <View style={[styles.toggleKnob, isRecurring && styles.toggleKnobActive]} />
                </View>
              </Pressable>

              {isRecurring && (
                <View style={styles.repeatOptions}>
                  <View style={styles.frequencyRow}>
                    {(["daily", "weekly", "monthly"] as const).map((freq) => (
                      <Pressable
                        key={freq}
                        style={[styles.frequencyChip, recurrenceFrequency === freq && styles.frequencyChipActive]}
                        onPress={() => setRecurrenceFrequency(freq)}
                      >
                        <Text style={[styles.frequencyChipText, recurrenceFrequency === freq && styles.frequencyChipTextActive]}>
                          {freq.charAt(0).toUpperCase() + freq.slice(1)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {recurrenceFrequency === "weekly" && (
                    <View style={styles.daySelector}>
                      {dayLabels.map(({ day, label }) => (
                        <Pressable
                          key={day}
                          style={[styles.dayButton, recurrenceDays.includes(day) && styles.dayButtonActive]}
                          onPress={() => toggleRecurrenceDay(day)}
                        >
                          <Text style={[styles.dayButtonText, recurrenceDays.includes(day) && styles.dayButtonTextActive]}>
                            {label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Tags */}
            <View style={styles.optionalItem}>
              <View style={styles.tagsSection}>
                {/* Selected tags displayed first */}
                {tags.length > 0 && (
                  <View style={styles.tagChips}>
                    {tags.map((tag) => (
                      <View key={tag} style={styles.tagChip}>
                        <Text style={styles.tagChipText}>{tag}</Text>
                        <Pressable onPress={() => removeTag(tag)} hitSlop={8}>
                          <MaterialCommunityIcons name="close" size={14} color={COLORS.aiPurple} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}

                {/* Tag input */}
                <View style={styles.tagInputRow}>
                  <MaterialCommunityIcons name="tag-plus" size={20} color={tagInput ? COLORS.gradientStart : COLORS.textTertiary} />
                  <TextInput
                    placeholder={tags.length > 0 ? "Add another tag..." : "Add tags (e.g., work, personal)..."}
                    value={tagInput}
                    onChangeText={(text) => {
                      setTagInput(text);
                      setShowTagSuggestions(true);
                    }}
                    onFocus={() => {
                      setShowTagSuggestions(true);
                      scrollToBottom();
                    }}
                    onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                    onSubmitEditing={() => {
                      if (tagInput.trim()) addTag(tagInput);
                    }}
                    style={styles.tagInput}
                    mode="flat"
                    underlineColor="transparent"
                    activeUnderlineColor="transparent"
                    cursorColor={COLORS.gradientStart}
                    dense
                  />
                  {tagInput.trim() && (
                    <Pressable onPress={() => addTag(tagInput)} style={styles.addTagButton}>
                      <View style={styles.addTagButtonInner}>
                        <MaterialCommunityIcons name="plus" size={16} color="#FFFFFF" />
                      </View>
                    </Pressable>
                  )}
                </View>

                {/* Suggestions - show existing tags or hint */}
                {showTagSuggestions && (
                  <View style={styles.tagSuggestionsContainer}>
                    {filteredSuggestions.length > 0 ? (
                      <>
                        <Text style={styles.tagSuggestionsLabel}>Existing tags:</Text>
                        <View style={styles.tagSuggestions}>
                          {filteredSuggestions.slice(0, 6).map((tag) => (
                            <Pressable key={tag} style={styles.tagSuggestion} onPress={() => addTag(tag)}>
                              <MaterialCommunityIcons name="tag" size={12} color={COLORS.textTertiary} />
                              <Text style={styles.tagSuggestionText}>{tag}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </>
                    ) : tagInput.trim() ? (
                      <Text style={styles.tagHint}>Press enter or tap + to create "{tagInput.trim()}"</Text>
                    ) : existingTags.length > 0 ? (
                      <>
                        <Text style={styles.tagSuggestionsLabel}>Quick add:</Text>
                        <View style={styles.tagSuggestions}>
                          {existingTags.filter(t => !tags.includes(t)).slice(0, 6).map((tag) => (
                            <Pressable key={tag} style={styles.tagSuggestion} onPress={() => addTag(tag)}>
                              <MaterialCommunityIcons name="tag" size={12} color={COLORS.textTertiary} />
                              <Text style={styles.tagSuggestionText}>{tag}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </>
                    ) : null}
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Error */}
          {error && (
            <View style={styles.errorContainer}>
              <MaterialCommunityIcons name="alert-circle" size={16} color={COLORS.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Spacer */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Bottom Action */}
        <View style={styles.bottomAction}>
          <Pressable
            style={[styles.createButton, (!title.trim() || loading) && styles.createButtonDisabled]}
            onPress={handleCreateTask}
            disabled={!title.trim() || loading}
          >
            <LinearGradient
              colors={!title.trim() || loading ? ["#D1D5DB", "#D1D5DB"] : [COLORS.gradientStart, COLORS.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.createButtonGradient}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialCommunityIcons name="check" size={22} color="#FFFFFF" />
                  <Text style={styles.createButtonText}>Create Task</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

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
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLORS.surface,
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
  headerSpacer: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
  },

  // Hero Input
  heroSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLORS.surface,
    marginBottom: 8,
  },
  heroInput: {
    fontSize: 22,
    fontWeight: "600",
    backgroundColor: "transparent",
    paddingHorizontal: 0,
  },

  // Sections
  section: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: 14,
    letterSpacing: -0.2,
  },

  // Duration
  durationGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  durationCard: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#F8F9FB",
    gap: 6,
  },
  durationCardActive: {
    backgroundColor: "#EBF4FF",
    borderWidth: 1,
    borderColor: COLORS.gradientStart,
  },
  durationCardText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  durationCardTextActive: {
    color: COLORS.gradientStart,
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

  // Priority
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

  // Scheduling
  schedulingRow: {
    gap: 12,
  },
  schedulingCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#F8F9FB",
    borderWidth: 1,
    borderColor: "transparent",
    gap: 14,
  },
  schedulingCardActive: {
    backgroundColor: "#FAFAFF",
    borderColor: COLORS.gradientStart,
  },
  schedulingCardGradient: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  schedulingCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#E5E7EB",
    justifyContent: "center",
    alignItems: "center",
  },
  schedulingCardIconActive: {
    backgroundColor: COLORS.gradientStart,
  },
  schedulingCardContent: {
    flex: 1,
  },
  schedulingCardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  schedulingCardTitleActive: {
    color: COLORS.gradientStart,
  },
  schedulingCardDesc: {
    fontSize: 13,
    color: COLORS.textTertiary,
  },

  // Due Date
  dueDateRow: {
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
  selectedDateText: {
    marginTop: 10,
    fontSize: 13,
    color: COLORS.gradientStart,
    fontWeight: "500",
  },

  // Optional Section
  optionalSection: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginTop: 8,
  },
  optionalDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  optionalDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  optionalDividerText: {
    paddingHorizontal: 12,
    fontSize: 12,
    color: COLORS.textTertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  optionalItem: {
    marginBottom: 20,
  },

  // Notes
  notesInput: {
    backgroundColor: COLORS.surface,
    fontSize: 14,
    minHeight: 80,
  },
  notesInputContent: {
    paddingTop: 12,
    textAlignVertical: "top",
  },

  // Repeat
  repeatToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  repeatToggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  repeatToggleText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  repeatToggleTextActive: {
    color: COLORS.aiPurple,
    fontWeight: "500",
  },
  toggleSwitch: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#E5E7EB",
    padding: 2,
    justifyContent: "center",
  },
  toggleSwitchActive: {
    backgroundColor: COLORS.aiPurple,
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleKnobActive: {
    alignSelf: "flex-end",
  },
  repeatOptions: {
    marginTop: 16,
    gap: 14,
  },
  frequencyRow: {
    flexDirection: "row",
    gap: 8,
  },
  frequencyChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#F8F9FB",
  },
  frequencyChipActive: {
    backgroundColor: COLORS.aiPurpleLight,
  },
  frequencyChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textTertiary,
  },
  frequencyChipTextActive: {
    color: COLORS.aiPurple,
  },
  daySelector: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  dayButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F8F9FB",
    justifyContent: "center",
    alignItems: "center",
  },
  dayButtonActive: {
    backgroundColor: COLORS.aiPurple,
  },
  dayButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  dayButtonTextActive: {
    color: "#FFFFFF",
  },

  // Tags
  tagsSection: {
    gap: 12,
  },
  tagChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
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
  tagInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F8F9FB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tagInput: {
    flex: 1,
    backgroundColor: "transparent",
    fontSize: 14,
  },
  addTagButton: {
    padding: 4,
  },
  addTagButtonInner: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.gradientStart,
    justifyContent: "center",
    alignItems: "center",
  },
  tagSuggestionsContainer: {
    gap: 8,
  },
  tagSuggestionsLabel: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginLeft: 4,
  },
  tagSuggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagSuggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "#F8F9FB",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tagSuggestionText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  tagHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    fontStyle: "italic",
    marginLeft: 4,
  },

  // Error
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    marginHorizontal: 20,
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.error,
    flex: 1,
  },

  // Bottom Action
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 8,
  },
  createButton: {
    borderRadius: 16,
    overflow: "hidden",
  },
  createButtonDisabled: {
    opacity: 0.7,
  },
  createButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
});
