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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { format, addDays, endOfDay } from "date-fns";
import DateTimePicker from "@react-native-community/datetimepicker";
import SchedulingModal from "@/components/SchedulingModal";
import { scheduleTask } from "@/lib/scheduling";
import { Task, TimeSlot, UserProfile, CalendarEvent, RecurrenceRule } from "@/lib/types";
import { safeCreateCalendarEvent } from "@/lib/google-calendar";
import { scheduleTaskReminder } from "@/lib/notifications";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { trackTaskCreated, trackTaskScheduled, updateFunnel } from "@/lib/analytics";
import { useAppColors } from "@/contexts/ThemeContext";
import { useGuidedTour } from "@/contexts/GuidedTourContext";
import TourTooltip from "@/components/TourTooltip";

// Design System (static fallbacks only – runtime colors come from appColors)
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
  const { canUseAI, aiUsage, isPro, features, refreshAIUsage } = useSubscription();
  const appColors = useAppColors();
  const params = useLocalSearchParams<{
    title?: string;
    duration?: string;
    priority?: string;
    dueDate?: string;
    tourMode?: string;
    schedulingMethod?: string;
  }>();

  const isAtWeeklyLimit = aiUsage && !aiUsage.isUnlimited && aiUsage.used >= aiUsage.limit;
  const canUseSmartScheduling = canUseAI && !isAtWeeklyLimit;

  const [title, setTitle] = useState(params.title || "");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(params.duration || "60");
  const [customDuration, setCustomDuration] = useState("");
  const [priority, setPriority] = useState(params.priority || "medium");

  // Scheduling method — defaults to MANUAL; respects param from QuickAddSheet expand
  const initialSchedulingMethod = (params.schedulingMethod === "SMART" ? "SMART" : "MANUAL") as "SMART" | "MANUAL";
  const [schedulingMethod, setSchedulingMethod] = useState<"SMART" | "MANUAL">(initialSchedulingMethod);
  const [dueDate, setDueDate] = useState<Date | null>(
    initialSchedulingMethod === "SMART"
      ? (params.dueDate ? new Date(params.dueDate) : endOfDay(addDays(new Date(), 1)))
      : null
  );
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

  // Load default duration from settings (only if not passed via params)
  useEffect(() => {
    if (!params.duration) {
      AsyncStorage.getItem("defaultTaskDuration").then((saved) => {
        if (saved) setDuration(saved);
      });
    }
  }, []);

  // Guided tour
  const { tourStep, advanceTour, skipTour } = useGuidedTour();
  const isManualTourMode = params.tourMode === "manual";
  // Dismiss create-task tooltip so user taps the actual button themselves
  const [createTooltipDismissed, setCreateTooltipDismissed] = useState(false);

  // Reset form state when entering manual tour phase (avoids stale state from previous task)
  useFocusEffect(
    useCallback(() => {
      if (params.tourMode === "manual") {
        setTitle("");
        setDuration("60");
        setPriority("medium");
        setSchedulingMethod("MANUAL");
        setDueDate(null);
        setDescription("");
        setTags([]);
        setTagInput("");
        setError(null);
        setCreatedTask(null);
        setShowSchedulingModal(false);
        setCreateTooltipDismissed(false);
      }
    }, [params.tourMode])
  );


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
      if (tourStep === "tour_task_tag") advanceTour("tour_task_create_ai");
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

      if (schedulingMethod === "SMART" && !dueDate) {
        setError("Due date is required for AI scheduling");
        return;
      }

      const durationNum = parseInt(getEffectiveDuration());
      if (isNaN(durationNum) || durationNum < 5 || durationNum > 480) {
        setError("Duration must be between 5 and 480 minutes");
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Enforce recurring task limit for free users
      if (isRecurring && !isPro && features.recurring_tasks !== -1) {
        const { count } = await supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_recurring", true);

        if ((count ?? 0) >= features.recurring_tasks) {
          setError(`Free plan allows up to ${features.recurring_tasks} recurring tasks. Upgrade to Pro for unlimited.`);
          return;
        }
      }

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
          due_date: schedulingMethod === "SMART"
            ? dueDate!.toISOString()
            : endOfDay(addDays(new Date(), 30)).toISOString(),
          status: "pending_schedule",
          tags: tags.length > 0 ? tags : [],
          is_recurring: isRecurring,
          recurrence_rule: recurrenceRule,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Track analytics
      await trackTaskCreated(schedulingMethod);
      await updateFunnel("first_task_at");

      setCreatedTask(insertedTask as Task);
      setSchedulingSlots([]);
      setSchedulingError(null);
      setShowSchedulingModal(true);

      // Load slots based on pre-selected method
      if (schedulingMethod === "SMART") {
        runSmartScheduling(insertedTask as Task, user.id);
      } else {
        loadBusySlots(user.id);
      }

      // Advance tour when scheduling modal opens
      if (tourStep === "tour_task_create_ai" || tourStep === "tour_task_due") {
        await advanceTour(schedulingMethod === "MANUAL" || isManualTourMode
          ? "tour_manual_schedule"
          : "tour_scheduling_ai");
      } else if (tourStep === "tour_add_manual") {
        await advanceTour("tour_manual_schedule");
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

      // Use safe calendar function - won't block task scheduling if calendar fails
      const calendarResult = await safeCreateCalendarEvent(
        createdTask.title,
        createdTask.description,
        slot.start,
        slot.end
      );

      if (calendarResult.success && calendarResult.eventId) {
        googleEventId = calendarResult.eventId;
      } else if (calendarResult.error && calendarResult.needsRetry) {
        // Calendar sync failed but will be retried later
        console.log("[AddTask] Calendar sync pending, task will still be scheduled");
      }

      const updateData: Record<string, unknown> = {
        scheduled_start: slot.start,
        scheduled_end: slot.end,
        status: "scheduled",
        ...(schedulingMethod === "MANUAL" && {
          // Use local date components to avoid UTC offset shifting the day
          due_date: (() => {
            const d = new Date(slot.start);
            return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
          })(),
        }),
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
        // Track scheduling
        await trackTaskScheduled(schedulingMethod as "SMART" | "MANUAL");
        await updateFunnel("first_schedule_at");

        // Refresh AI usage after using SMART scheduling
        if (schedulingMethod === "SMART") {
          await refreshAIUsage();
        }
      }

      // Advance guided tour
      if (tourStep === "tour_scheduling_ai") {
        await advanceTour("tour_ai_reward");
        import("@/lib/analytics").then(({ trackEvent }) => trackEvent("guided_tour_ai_scheduled").catch(() => {}));
      } else if (tourStep === "tour_manual_schedule" || isManualTourMode) {
        await advanceTour("tour_manual_done");
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
      setDueDate(endOfDay(selectedDate));
      if (tourStep === "tour_task_priority") advanceTour("tour_task_due");
      else if (tourStep === "tour_task_due") advanceTour("tour_task_tag");
    }
  };

  const quickDueDates = [
    { label: "Today", date: endOfDay(new Date()) },
    { label: "Tomorrow", date: endOfDay(addDays(new Date(), 1)) },
    { label: "Next Week", date: endOfDay(addDays(new Date(), 7)) },
  ];

  const isDueDateSelected = (date: Date) => {
    if (!dueDate) return false;
    return format(dueDate, "yyyy-MM-dd") === format(date, "yyyy-MM-dd");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        {/* Header */}
        <Animated.View style={[styles.header, { opacity: fadeAnim, backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <MaterialCommunityIcons name="arrow-left" size={24} color={appColors.textPrimary} />
            </Pressable>
            <Text style={[styles.headerTitle, { color: appColors.textPrimary }]}>New Task</Text>
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
          <View style={[styles.heroSection, { backgroundColor: appColors.surface }]}>
            <TextInput
              placeholder="What needs to be done?"
              value={title}
              onChangeText={setTitle}
              onBlur={() => { if (title.trim() && tourStep === "tour_task_title") advanceTour("tour_task_duration"); }}
              style={[styles.heroInput, { color: appColors.textPrimary }]}
              mode="flat"
              underlineColor="transparent"
              activeUnderlineColor="transparent"
              placeholderTextColor={appColors.textTertiary}
              cursorColor={appColors.gradientStart}
              selectionColor={`${appColors.gradientStart}40`}
              theme={{ colors: { primary: appColors.gradientStart, onSurfaceVariant: appColors.textTertiary } }}
            />
          </View>

          {/* Scheduling Method Toggle */}
          <View style={[styles.methodToggleContainer, { backgroundColor: appColors.surface }]}>
            <View style={[styles.methodToggle, { backgroundColor: appColors.inputBg }]}>
              <Pressable
                style={[
                  styles.methodOption,
                  schedulingMethod === "MANUAL" && { backgroundColor: appColors.primaryLight },
                ]}
                onPress={() => setSchedulingMethod("MANUAL")}
              >
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={16}
                  color={schedulingMethod === "MANUAL" ? appColors.primary : appColors.textTertiary}
                />
                <Text style={[
                  styles.methodOptionText,
                  { color: schedulingMethod === "MANUAL" ? appColors.primary : appColors.textSecondary },
                  schedulingMethod === "MANUAL" && { fontWeight: "700" },
                ]}>Pick a time</Text>
              </Pressable>

              <View style={[styles.methodDivider, { backgroundColor: appColors.border }]} />

              <Pressable
                style={[
                  styles.methodOption,
                  schedulingMethod === "SMART" && canUseSmartScheduling && { backgroundColor: appColors.aiPurpleLight },
                  !canUseSmartScheduling && { opacity: 0.6 },
                ]}
                onPress={() => {
                  if (canUseSmartScheduling) {
                    setSchedulingMethod("SMART");
                    if (!dueDate) setDueDate(endOfDay(addDays(new Date(), 1)));
                  } else {
                    router.push("/paywall");
                  }
                }}
              >
                <MaterialCommunityIcons
                  name="star-four-points"
                  size={16}
                  color={schedulingMethod === "SMART" && canUseSmartScheduling ? appColors.aiPurple : appColors.textTertiary}
                />
                <Text style={[
                  styles.methodOptionText,
                  { color: schedulingMethod === "SMART" && canUseSmartScheduling ? appColors.aiPurple : appColors.textSecondary },
                  schedulingMethod === "SMART" && canUseSmartScheduling && { fontWeight: "700" },
                ]}>AI Schedule</Text>
                {!canUseSmartScheduling && (
                  <MaterialCommunityIcons name="lock" size={12} color={appColors.textTertiary} />
                )}
              </Pressable>
            </View>
          </View>

          {/* Form sections */}
          <>
              {/* Duration Selection */}
              <View style={[styles.section, { backgroundColor: appColors.surface }]}>
                <Text style={[styles.sectionLabel, { color: appColors.textSecondary }]}>Duration</Text>
                <View style={styles.durationGrid}>
                  {DURATION_PRESETS.map((preset) => {
                    const isActive = duration === preset.value && !customDuration;
                    return (
                      <Pressable
                        key={preset.value}
                        style={[
                          styles.durationChip,
                          { backgroundColor: appColors.inputBg },
                          isActive && { backgroundColor: appColors.primaryLight, borderColor: appColors.primary },
                        ]}
                        onPress={() => {
                          setDuration(preset.value);
                          setCustomDuration("");
                          if (tourStep === "tour_task_duration") advanceTour("tour_task_priority");
                        }}
                      >
                        <Text
                          style={[
                            styles.durationChipText,
                            { color: appColors.textTertiary },
                            isActive && { color: appColors.primary },
                          ]}
                        >
                          {preset.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.customDurationRow}>
                  <TextInput
                    placeholder="Custom duration"
                    value={customDuration}
                    onChangeText={setCustomDuration}
                    style={[styles.customDurationInput, { backgroundColor: appColors.surface }]}
                    mode="outlined"
                    keyboardType="numeric"
                    outlineColor={appColors.border}
                    activeOutlineColor={appColors.gradientStart}
                    textColor={appColors.textPrimary}
                    placeholderTextColor={appColors.textTertiary}
                    right={<TextInput.Affix text="min" textStyle={[styles.durationAffix, { color: appColors.textTertiary }]} />}
                    dense
                    theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
                  />
                </View>
              </View>

              {/* Priority Selection */}
              <View style={[styles.section, { backgroundColor: appColors.surface }]}>
                <Text style={[styles.sectionLabel, { color: appColors.textSecondary }]}>Priority</Text>
                <View style={styles.priorityRow}>
                  {PRIORITY_OPTIONS.map((option) => {
                    const dynamicColor =
                      option.value === "high" ? appColors.priorityHigh
                      : option.value === "medium" ? appColors.priorityMedium
                      : appColors.priorityLow;
                    const isActive = priority === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        style={[
                          styles.priorityCard,
                          { backgroundColor: appColors.inputBg },
                          isActive && { borderColor: dynamicColor, backgroundColor: `${dynamicColor}10` },
                        ]}
                        onPress={() => {
                          setPriority(option.value);
                          if (tourStep === "tour_task_priority") advanceTour("tour_task_due");
                        }}
                      >
                        <MaterialCommunityIcons
                          name={option.icon as any}
                          size={18}
                          color={isActive ? dynamicColor : appColors.textTertiary}
                        />
                        <Text
                          style={[
                            styles.priorityCardText,
                            { color: appColors.textTertiary },
                            isActive && { color: dynamicColor },
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* Due Date — only shown for SMART scheduling */}
              {schedulingMethod === "SMART" && <View style={[styles.section, { backgroundColor: appColors.surface }]}>
                <Text style={[styles.sectionLabel, { color: appColors.textSecondary }]}>Due date</Text>
                <View style={styles.dueDateRow}>
                  {quickDueDates.map((item) => {
                    const isSelected = isDueDateSelected(item.date);
                    return (
                      <Pressable
                        key={item.label}
                        style={[styles.dueDateChip, { backgroundColor: appColors.inputBg }, isSelected && { backgroundColor: appColors.gradientStart }]}
                        onPress={() => { setDueDate(item.date); if (tourStep === "tour_task_priority" || tourStep === "tour_task_due") advanceTour("tour_task_due"); }}
                      >
                        <Text style={[styles.dueDateChipText, { color: appColors.textTertiary }, isSelected && { color: "#FFFFFF" }]}>
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable style={[styles.dueDateChip, { backgroundColor: appColors.inputBg }]} onPress={() => setShowDatePicker(true)}>
                    <MaterialCommunityIcons name="calendar" size={16} color={appColors.textTertiary} />
                  </Pressable>
                </View>
                {dueDate && !quickDueDates.some((d) => isDueDateSelected(d.date)) && (
                  <Text style={[styles.selectedDateText, { color: appColors.primary }]}>Due: {format(dueDate, "EEE, MMM d")}</Text>
                )}
                {showDatePicker && (
                  <DateTimePicker
                    value={dueDate || new Date()}
                    mode="date"
                    minimumDate={new Date()}
                    onChange={handleDateChange}
                  />
                )}
              </View>}

              {/* Notes */}
              <View style={[styles.section, { backgroundColor: appColors.surface }]}>
                <Text style={[styles.sectionLabel, { color: appColors.textSecondary }]}>Notes (optional)</Text>
                <TextInput
                  placeholder="Add notes..."
                  value={description}
                  onChangeText={setDescription}
                  style={[styles.notesInput, { backgroundColor: appColors.surface }]}
                  mode="outlined"
                  multiline
                  numberOfLines={3}
                  outlineColor={appColors.border}
                  activeOutlineColor={appColors.gradientStart}
                  cursorColor={appColors.gradientStart}
                  textColor={appColors.textPrimary}
                  placeholderTextColor={appColors.textTertiary}
                  contentStyle={styles.notesInputContent}
                  theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
                />
              </View>

              {/* Tags */}
              <View style={[styles.section, { backgroundColor: appColors.surface }]}>
                <Text style={[styles.sectionLabel, { color: appColors.textSecondary }]}>Tags</Text>
                <View style={styles.tagsSection}>
                  {tags.length > 0 && (
                    <View style={styles.tagChips}>
                      {tags.map((tag) => (
                        <View key={tag} style={[styles.tagChip, { backgroundColor: appColors.secondaryLight }]}>
                          <Text style={[styles.tagChipText, { color: appColors.secondary }]}>{tag}</Text>
                          <Pressable onPress={() => removeTag(tag)} hitSlop={8}>
                            <MaterialCommunityIcons name="close" size={14} color={appColors.secondary} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={[styles.tagInputRow, { backgroundColor: appColors.inputBg }]}>
                    <MaterialCommunityIcons name="tag-plus" size={20} color={tagInput ? appColors.gradientStart : appColors.textTertiary} />
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
                      style={[styles.tagInput, { color: appColors.textPrimary }]}
                      mode="flat"
                      underlineColor="transparent"
                      activeUnderlineColor="transparent"
                      cursorColor={appColors.gradientStart}
                      placeholderTextColor={appColors.textTertiary}
                      dense
                      theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
                    />
                    {tagInput.trim() && (
                      <Pressable onPress={() => addTag(tagInput)} style={styles.addTagButton}>
                        <View style={[styles.addTagButtonInner, { backgroundColor: appColors.gradientStart }]}>
                          <MaterialCommunityIcons name="plus" size={16} color="#FFFFFF" />
                        </View>
                      </Pressable>
                    )}
                  </View>

                  {showTagSuggestions && (
                    <View style={styles.tagSuggestionsContainer}>
                      {filteredSuggestions.length > 0 ? (
                        <>
                          <Text style={[styles.tagSuggestionsLabel, { color: appColors.textTertiary }]}>Existing tags:</Text>
                          <View style={styles.tagSuggestions}>
                            {filteredSuggestions.slice(0, 6).map((tag) => (
                              <Pressable key={tag} style={[styles.tagSuggestion, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]} onPress={() => addTag(tag)}>
                                <MaterialCommunityIcons name="tag" size={12} color={appColors.textTertiary} />
                                <Text style={[styles.tagSuggestionText, { color: appColors.textSecondary }]}>{tag}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </>
                      ) : tagInput.trim() ? (
                        <Text style={[styles.tagHint, { color: appColors.textTertiary }]}>Press enter or tap + to create "{tagInput.trim()}"</Text>
                      ) : existingTags.length > 0 ? (
                        <>
                          <Text style={[styles.tagSuggestionsLabel, { color: appColors.textTertiary }]}>Quick add:</Text>
                          <View style={styles.tagSuggestions}>
                            {existingTags.filter(t => !tags.includes(t)).slice(0, 6).map((tag) => (
                              <Pressable key={tag} style={[styles.tagSuggestion, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]} onPress={() => addTag(tag)}>
                                <MaterialCommunityIcons name="tag" size={12} color={appColors.textTertiary} />
                                <Text style={[styles.tagSuggestionText, { color: appColors.textSecondary }]}>{tag}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </>
                      ) : null}
                    </View>
                  )}
                </View>
              </View>

              {/* Repeat */}
              <View style={[styles.section, { backgroundColor: appColors.surface }]}>
                <Pressable
                  style={styles.repeatToggle}
                  onPress={() => setIsRecurring(!isRecurring)}
                >
                  <View style={styles.repeatToggleLeft}>
                    <MaterialCommunityIcons
                      name="repeat"
                      size={20}
                      color={isRecurring ? appColors.secondary : appColors.textTertiary}
                    />
                    <Text style={[styles.repeatToggleText, { color: appColors.textSecondary }, isRecurring && { color: appColors.secondary, fontWeight: "500" }]}>
                      Repeat this task
                    </Text>
                  </View>
                  <View style={[styles.toggleSwitch, { backgroundColor: appColors.border }, isRecurring && { backgroundColor: appColors.secondary }]}>
                    <View style={[styles.toggleKnob, isRecurring && styles.toggleKnobActive]} />
                  </View>
                </Pressable>

                {isRecurring && (
                  <View style={styles.repeatOptions}>
                    <View style={styles.frequencyRow}>
                      {(["daily", "weekly", "monthly"] as const).map((freq) => (
                        <Pressable
                          key={freq}
                          style={[styles.frequencyChip, { backgroundColor: appColors.inputBg }, recurrenceFrequency === freq && { backgroundColor: appColors.secondaryLight }]}
                          onPress={() => setRecurrenceFrequency(freq)}
                        >
                          <Text style={[styles.frequencyChipText, { color: appColors.textTertiary }, recurrenceFrequency === freq && { color: appColors.secondary }]}>
                            {freq.charAt(0).toUpperCase() + freq.slice(1)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    {recurrenceFrequency === "weekly" && (
                      <View style={styles.daySelector}>
                        {dayLabels.map(({ day, label }) => {
                          const isDayActive = recurrenceDays.includes(day);
                          return (
                            <Pressable
                              key={day}
                              style={[styles.dayButton, { backgroundColor: appColors.inputBg }, isDayActive && { backgroundColor: appColors.secondary }]}
                              onPress={() => toggleRecurrenceDay(day)}
                            >
                              <Text style={[styles.dayButtonText, { color: appColors.textTertiary }, isDayActive && { color: "#FFFFFF" }]}>
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </View>
          </>

          {/* Error */}
          {error && (
            <View style={[styles.errorContainer, { backgroundColor: appColors.errorLight }]}>
              <MaterialCommunityIcons name="alert-circle" size={16} color={appColors.error} />
              <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>
            </View>
          )}

          {/* Spacer */}
          <View style={{ height: 100 }} />
        </ScrollView>

        {/* Bottom Action */}
        <View style={[styles.bottomAction, { backgroundColor: appColors.surface, borderTopColor: appColors.border }]}>
          <Pressable
            style={[styles.createButton, (!title.trim() || (schedulingMethod === "SMART" && !dueDate) || loading) && styles.createButtonDisabled]}
            onPress={handleCreateTask}
            disabled={!title.trim() || (schedulingMethod === "SMART" && !dueDate) || loading}
          >
            <LinearGradient
              colors={!title.trim() || (schedulingMethod === "SMART" && !dueDate) || loading ? ["#D1D5DB", "#D1D5DB"] : [appColors.gradientStart, appColors.gradientEnd]}
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

        {/* Tour Tooltips — rendered outside ScrollView, above keyboard */}
        <TourTooltip
          visible={tourStep === "tour_task_title"}
          icon="pencil-outline"
          iconColor={appColors.primary}
          title={isManualTourMode ? "Name your task" : "Name your task"}
          body={isManualTourMode ? "Give it a clear name, then fill in the details below." : "Be specific — 'Write report intro' schedules better than 'Work'. I group related tasks to avoid context-switching."}
          ctaLabel="Got it"
          onCta={() => advanceTour("tour_task_duration")}
          onSkip={skipTour}
          showSkip={!isManualTourMode}
        />
        <TourTooltip
          visible={tourStep === "tour_task_duration"}
          icon="timer-outline"
          iconColor={appColors.primary}
          title="How long will it take?"
          body={isManualTourMode ? "Pick a duration so the right amount of time is blocked." : "I use this to find a gap that actually fits. I won't schedule a 2-hour task into a 45-minute window."}
          ctaLabel="Got it"
          onCta={() => advanceTour("tour_task_priority")}
          onSkip={skipTour}
          showSkip={!isManualTourMode}
        />
        <TourTooltip
          visible={tourStep === "tour_task_priority"}
          icon="flag-outline"
          iconColor={appColors.warning}
          title="How urgent is this?"
          body={isManualTourMode ? "Set the priority, then choose a due date." : "High priority tasks get your peak energy hours. Low priority fills natural gaps."}
          ctaLabel="Got it"
          onCta={() => advanceTour("tour_task_due")}
          onSkip={skipTour}
          showSkip={!isManualTourMode}
        />
        <TourTooltip
          visible={tourStep === "tour_task_due"}
          icon="calendar-outline"
          iconColor={appColors.primary}
          title="Set a deadline"
          body={isManualTourMode ? "Pick your due date below." : "This tells me how urgently to schedule it. Due tomorrow? I'll find a slot today."}
          ctaLabel="Got it"
          onCta={() => advanceTour("tour_task_tag")}
          onSkip={skipTour}
          showSkip={!isManualTourMode}
        />
        <TourTooltip
          visible={tourStep === "tour_task_tag"}
          icon="tag-outline"
          iconColor={appColors.secondary}
          title="Add a tag (optional)"
          body="Tags like 'work' or 'personal' let you filter tasks later. Type one and press enter — or skip if you prefer."
          ctaLabel="Skip tags"
          onCta={() => advanceTour("tour_task_create_ai")}
          onSkip={skipTour}
          showSkip={false}
        />
        <TourTooltip
          visible={tourStep === "tour_task_create_ai" && !createTooltipDismissed}
          icon="robot-outline"
          iconColor={appColors.secondary}
          title="Ready to find your time"
          body="Tap the Create Task button above. I'll rank the best slots for this task based on your schedule and energy patterns."
          ctaLabel="Got it"
          onCta={() => setCreateTooltipDismissed(true)}
          onSkip={skipTour}
          showSkip
        />
        <TourTooltip
          visible={tourStep === "tour_add_manual"}
          icon="gesture-tap"
          iconColor={appColors.secondary}
          title="Create another task"
          body="You already know this part — fill in the details however you like. This time you'll pick your own time."
          showSkip
          onSkip={skipTour}
        />
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
        schedulingMethod={schedulingMethod}
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
  tourHintBar: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  tourHintText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },

  // Scheduling Method Toggle
  methodToggleContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginBottom: 8,
  },
  methodToggle: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
    gap: 2,
  },
  methodOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 9,
  },
  methodOptionText: {
    fontSize: 14,
    fontWeight: "500",
  },
  methodDivider: {
    width: 1,
    marginVertical: 6,
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
  heroSectionCompact: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 0,
  },
  heroInputCompact: {
    fontSize: 18,
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

  // Duration - Compact chips
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
  dueDateChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textTertiary,
  },
  selectedDateText: {
    marginTop: 10,
    fontSize: 13,
    color: COLORS.gradientStart,
    fontWeight: "500",
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
  toggleSwitch: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#E5E7EB",
    padding: 2,
    justifyContent: "center",
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
  frequencyChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textTertiary,
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
  dayButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textTertiary,
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
  bottomActionKeyboard: {
    paddingBottom: 12,
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
