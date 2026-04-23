/**
 * Add Task Screen - "Fluid Intelligence" Design
 *
 * Conversational task creation flow with AI-first scheduling
 * Clean, focused interface that guides users naturally
 */

import { View, StyleSheet, ScrollView, Pressable, Platform, KeyboardAvoidingView, Animated, Keyboard } from "react-native";
import { Text, TextInput, HelperText, ActivityIndicator } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
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
import { trackTaskCreated, trackTaskScheduled, updateFunnel, trackTourAIScheduled } from "@/lib/analytics";
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
  const { isPro, features, refreshAIUsage } = useSubscription();
  const appColors = useAppColors();
  const params = useLocalSearchParams<{
    title?: string;
    duration?: string;
    priority?: string;
    dueDate?: string;
    tourMode?: string;
    schedulingMethod?: string;
  }>();

  const canUseSmartScheduling = isPro;

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
  const { tourStep, advanceTour, skipTour: _skipTour, isManualTour: isManualTourMode } = useGuidedTour();
  const skipTour = useCallback(() => _skipTour(tourStep), [_skipTour, tourStep]);
  // Dismiss create-task tooltip so user taps the actual button themselves
  const [createTooltipDismissed, setCreateTooltipDismissed] = useState(false);
  const [aiModeTooltipDismissed, setAiModeTooltipDismissed] = useState(false);
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const toggleField = (field: string) => {
    if (expandedField === field) Keyboard.dismiss();
    setExpandedField(prev => prev === field ? null : field);
  };

  // Reset form every time screen is focused — prevents stale state from previous task
  useFocusEffect(
    useCallback(() => {
      const method = (params.schedulingMethod === "SMART" ? "SMART" : "MANUAL") as "SMART" | "MANUAL";
      setTitle(params.title || "");
      setDescription("");
      setDuration(params.duration || "60");
      setCustomDuration("");
      setPriority((params.priority as "low" | "medium" | "high") || "medium");
      setSchedulingMethod(method);
      setDueDate(method === "SMART" ? (params.dueDate ? new Date(params.dueDate) : endOfDay(addDays(new Date(), 1))) : null);
      setTags([]);
      setTagInput("");
      setError(null);
      setCreatedTask(null);
      setShowSchedulingModal(false);
      setCreateTooltipDismissed(false);
      setAiModeTooltipDismissed(false);
      setBusySlots([]);
      setSchedulingSlots([]);
      setSchedulingError(null);
      // Scroll back to top
      setTimeout(() => scrollViewRef.current?.scrollTo({ y: 0, animated: false }), 50);
    }, [params.title, params.duration, params.priority, params.schedulingMethod, params.dueDate])
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

      // For MANUAL: load busy slots first so modal opens with data ready (no spinner)
      // For SMART: open modal immediately then fetch AI slots (spinner is expected)
      if (schedulingMethod === "SMART") {
        setShowSchedulingModal(true);
        runSmartScheduling(insertedTask as Task, user.id);
      } else {
        await loadBusySlots(user.id);
        setShowSchedulingModal(true);
      }

      // Advance tour when scheduling modal opens
      if (tourStep === "tour_task_create_ai" || tourStep === "tour_task_due") {
        await advanceTour(schedulingMethod === "MANUAL" || isManualTourMode
          ? "tour_manual_schedule"
          : "tour_scheduling_ai");
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

      setBusySlots(busy.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()));
    } catch (err) {
      console.error("[AddTask] Load busy slots error:", err);
    }
  };

  const handleSelectSlot = async (slot: TimeSlot) => {
    if (!createdTask) return;

    // Close modal immediately — no spinner for what's just a DB update
    setShowSchedulingModal(false);

    // Advance tour before navigating back so home.tsx sees the new step
    if (tourStep === "tour_scheduling_ai") {
      await advanceTour("tour_ai_reward");
      trackTourAIScheduled().catch(() => {});
    } else if (tourStep === "tour_manual_schedule" || isManualTourMode) {
      await advanceTour("tour_manual_done");
    }

    router.back();

    // Save in background
    try {
      const calendarResult = await safeCreateCalendarEvent(
        createdTask.title,
        createdTask.description,
        slot.start,
        slot.end
      );

      const updateData: Record<string, unknown> = {
        scheduled_start: slot.start,
        scheduled_end: slot.end,
        status: "scheduled",
        ...(schedulingMethod === "MANUAL" && {
          due_date: (() => {
            const d = new Date(slot.start);
            return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
          })(),
        }),
      };

      if (calendarResult.success && calendarResult.eventId) {
        updateData.google_event_id = calendarResult.eventId;
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
        await trackTaskScheduled(schedulingMethod as "SMART" | "MANUAL");
        await updateFunnel("first_schedule_at");
        if (schedulingMethod === "SMART") await refreshAIUsage();
      }
    } catch (err) {
      console.error("[AddTask] Update error:", err);
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
      if (tourStep === "tour_task_priority") advanceTour(isManualTourMode ? "tour_task_tag" : "tour_task_due");
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
        <Animated.View style={[styles.header, { opacity: fadeAnim, backgroundColor: appColors.background }]}>
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
          {/* ── Title ── */}
          <View style={styles.titleArea}>
            <TextInput
              placeholder="What needs to be done?"
              value={title}
              onChangeText={setTitle}
              onBlur={() => {}}
              style={[styles.titleInput, { color: appColors.textPrimary, backgroundColor: "transparent" }]}
              mode="flat"
              underlineColor="transparent"
              activeUnderlineColor="transparent"
              placeholderTextColor={appColors.textTertiary}
              cursorColor={appColors.gradientStart}
              selectionColor={`${appColors.gradientStart}40`}
              multiline
              theme={{ colors: { primary: appColors.gradientStart, onSurfaceVariant: appColors.textTertiary } }}
            />
          </View>

          <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

          {/* ── Schedule row ── */}
          <View style={styles.attrRow}>
            <View style={styles.attrRowLeft}>
              <MaterialCommunityIcons
                name={schedulingMethod === "SMART" ? "star-four-points" : "clock-outline"}
                size={17}
                color={schedulingMethod === "SMART" ? (appColors.aiPurple ?? appColors.secondary) : appColors.primary}
              />
              <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Schedule</Text>
            </View>
            <View style={styles.schedulePills}>
              <Pressable
                style={[styles.schedulePill, { backgroundColor: schedulingMethod === "MANUAL" ? appColors.primaryLight : appColors.inputBg }]}
                onPress={() => setSchedulingMethod("MANUAL")}
              >
                <Text style={[styles.schedulePillText, { color: schedulingMethod === "MANUAL" ? appColors.primary : appColors.textTertiary, fontWeight: schedulingMethod === "MANUAL" ? "700" : "500" }]}>
                  Pick time
                </Text>
              </Pressable>
              <Pressable
                style={[styles.schedulePill, { backgroundColor: schedulingMethod === "SMART" && canUseSmartScheduling ? (appColors.aiPurpleLight ?? appColors.secondaryLight) : appColors.inputBg, opacity: !canUseSmartScheduling ? 0.6 : 1 }]}
                onPress={() => {
                  if (canUseSmartScheduling) {
                    setSchedulingMethod("SMART");
                    if (!dueDate) setDueDate(endOfDay(addDays(new Date(), 1)));
                    if (tourStep === "tour_task_title" && !isManualTourMode) advanceTour("tour_task_due");
                  } else {
                    router.push({ pathname: "/paywall", params: { source: "smart_scheduling" } });
                  }
                }}
              >
                <MaterialCommunityIcons
                  name="star-four-points"
                  size={12}
                  color={schedulingMethod === "SMART" && canUseSmartScheduling ? (appColors.aiPurple ?? appColors.secondary) : appColors.textTertiary}
                />
                <Text style={[styles.schedulePillText, { color: schedulingMethod === "SMART" && canUseSmartScheduling ? (appColors.aiPurple ?? appColors.secondary) : appColors.textTertiary, fontWeight: schedulingMethod === "SMART" && canUseSmartScheduling ? "700" : "500" }]}>
                  AI
                </Text>
                {!canUseSmartScheduling && <MaterialCommunityIcons name="lock" size={10} color={appColors.textTertiary} />}
              </Pressable>
            </View>
          </View>

          <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

          {/* ── Deadline row (SMART only) ── */}
          {schedulingMethod === "SMART" && (
            <>
              <Pressable style={styles.attrRow} onPress={() => toggleField("deadline")}>
                <View style={styles.attrRowLeft}>
                  <MaterialCommunityIcons
                    name="calendar-clock"
                    size={17}
                    color={dueDate ? appColors.gradientStart : appColors.textTertiary}
                  />
                  <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Deadline</Text>
                </View>
                <View style={styles.attrRowRight}>
                  <Text style={[styles.attrRowValue, { color: dueDate ? appColors.gradientStart : appColors.textTertiary }]}>
                    {dueDate
                      ? (isDueDateSelected(quickDueDates[0].date) ? "Today"
                        : isDueDateSelected(quickDueDates[1].date) ? "Tomorrow"
                        : isDueDateSelected(quickDueDates[2].date) ? "Next Week"
                        : format(dueDate, "EEE, MMM d"))
                      : "Set date"}
                  </Text>
                  <MaterialCommunityIcons
                    name={expandedField === "deadline" ? "chevron-up" : "chevron-right"}
                    size={16}
                    color={appColors.textTertiary}
                  />
                </View>
              </Pressable>
              {expandedField === "deadline" && (
                <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
                  <View style={styles.dueDateRow}>
                    {quickDueDates.map((item) => {
                      const isSelected = isDueDateSelected(item.date);
                      return (
                        <Pressable
                          key={item.label}
                          style={[styles.dueDateChip, { backgroundColor: appColors.background }, isSelected && { backgroundColor: appColors.gradientStart }]}
                          onPress={() => {
                            setDueDate(item.date);
                            setExpandedField(null);
                            if (tourStep === "tour_task_due") advanceTour("tour_task_tag");
                            else if (tourStep === "tour_task_priority") advanceTour("tour_task_due");
                          }}
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
                    <DateTimePicker value={dueDate || new Date()} mode="date" minimumDate={new Date()} onChange={handleDateChange} />
                  )}
                </View>
              )}
              <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />
            </>
          )}

          {/* ── Duration row ── */}
          <Pressable style={styles.attrRow} onPress={() => toggleField("duration")}>
            <View style={styles.attrRowLeft}>
              <MaterialCommunityIcons name="timer-outline" size={17} color={appColors.textTertiary} />
              <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Duration</Text>
            </View>
            <View style={styles.attrRowRight}>
              <Text style={[styles.attrRowValue, { color: appColors.textSecondary }]}>
                {customDuration
                  ? `${customDuration}m`
                  : duration === "60" ? "1h"
                  : duration === "120" ? "2h"
                  : `${duration}m`}
              </Text>
              <MaterialCommunityIcons
                name={expandedField === "duration" ? "chevron-up" : "chevron-right"}
                size={16}
                color={appColors.textTertiary}
              />
            </View>
          </Pressable>
          {expandedField === "duration" && (
            <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
              <View style={styles.durationGrid}>
                {DURATION_PRESETS.map((preset) => {
                  const isActive = duration === preset.value && !customDuration;
                  return (
                    <Pressable
                      key={preset.value}
                      style={[styles.durationChip, { backgroundColor: appColors.background }, isActive && { backgroundColor: appColors.primaryLight, borderColor: appColors.primary }]}
                      onPress={() => { setDuration(preset.value); setCustomDuration(""); setExpandedField(null); }}
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
                  value={customDuration}
                  onChangeText={setCustomDuration}
                  style={[styles.customDurationInput, { backgroundColor: appColors.background }]}
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
          )}

          <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

          {/* ── Priority row ── */}
          <Pressable style={styles.attrRow} onPress={() => toggleField("priority")}>
            <View style={styles.attrRowLeft}>
              <MaterialCommunityIcons
                name={priority === "low" ? "flag-outline" : "flag"}
                size={17}
                color={priority === "high" ? appColors.priorityHigh : priority === "medium" ? appColors.priorityMedium : appColors.textTertiary}
              />
              <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Priority</Text>
            </View>
            <View style={styles.attrRowRight}>
              <Text style={[styles.attrRowValue, {
                color: priority === "high" ? appColors.priorityHigh
                  : priority === "medium" ? appColors.priorityMedium
                  : appColors.textTertiary,
              }]}>
                {priority === "high" ? "High" : priority === "medium" ? "Medium" : "Low"}
              </Text>
              <MaterialCommunityIcons
                name={expandedField === "priority" ? "chevron-up" : "chevron-right"}
                size={16}
                color={appColors.textTertiary}
              />
            </View>
          </Pressable>
          {expandedField === "priority" && (
            <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
              <View style={styles.priorityRow}>
                {PRIORITY_OPTIONS.map((option) => {
                  const dynamicColor = option.value === "high" ? appColors.priorityHigh
                    : option.value === "medium" ? appColors.priorityMedium
                    : appColors.priorityLow;
                  const isActive = priority === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      style={[styles.priorityCard, { backgroundColor: appColors.background }, isActive && { borderColor: dynamicColor, backgroundColor: `${dynamicColor}10` }]}
                      onPress={() => { setPriority(option.value); setExpandedField(null); }}
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
          <Pressable style={styles.attrRow} onPress={() => toggleField("notes")}>
            <View style={styles.attrRowLeft}>
              <MaterialCommunityIcons
                name="text-box-outline"
                size={17}
                color={description ? appColors.textSecondary : appColors.textTertiary}
              />
              <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Notes</Text>
            </View>
            <View style={styles.attrRowRight}>
              <Text style={[styles.attrRowValue, { color: appColors.textTertiary }]} numberOfLines={1}>
                {description || "Optional"}
              </Text>
              <MaterialCommunityIcons
                name={expandedField === "notes" ? "chevron-up" : "chevron-right"}
                size={16}
                color={appColors.textTertiary}
              />
            </View>
          </Pressable>
          {expandedField === "notes" && (
            <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
              <TextInput
                placeholder="Add notes..."
                value={description}
                onChangeText={setDescription}
                style={[styles.notesInput, { backgroundColor: appColors.background }]}
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
          )}

          <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

          {/* ── Tags row ── */}
          <Pressable
            style={styles.attrRow}
            onPress={() => {
              toggleField("tags");
              if (expandedField !== "tags") scrollToBottom();
            }}
          >
            <View style={styles.attrRowLeft}>
              <MaterialCommunityIcons
                name="tag-outline"
                size={17}
                color={tags.length > 0 ? appColors.secondary : appColors.textTertiary}
              />
              <Text style={[styles.attrRowLabel, { color: appColors.textPrimary }]}>Tags</Text>
            </View>
            <View style={styles.attrRowRight}>
              <Text style={[styles.attrRowValue, { color: appColors.textTertiary }]} numberOfLines={1}>
                {tags.length > 0 ? tags.join(", ") : "Optional"}
              </Text>
              <MaterialCommunityIcons
                name={expandedField === "tags" ? "chevron-up" : "chevron-right"}
                size={16}
                color={appColors.textTertiary}
              />
            </View>
          </Pressable>
          {expandedField === "tags" && (
            <View style={[styles.attrExpanded, { borderTopColor: appColors.border, backgroundColor: appColors.inputBg }]}>
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
              <View style={[styles.tagInputRow, { backgroundColor: appColors.background }]}>
                <MaterialCommunityIcons name="tag-plus" size={20} color={tagInput ? appColors.gradientStart : appColors.textTertiary} />
                <TextInput
                  placeholder={tags.length > 0 ? "Add another tag..." : "Add tags (e.g., work, personal)..."}
                  value={tagInput}
                  onChangeText={(text) => { setTagInput(text); setShowTagSuggestions(true); }}
                  onFocus={() => { setShowTagSuggestions(true); scrollToBottom(); }}
                  onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                  onSubmitEditing={() => { if (tagInput.trim()) addTag(tagInput); }}
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
                          <Pressable key={tag} style={[styles.tagSuggestion, { backgroundColor: appColors.background, borderColor: appColors.border }]} onPress={() => addTag(tag)}>
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
                          <Pressable key={tag} style={[styles.tagSuggestion, { backgroundColor: appColors.background, borderColor: appColors.border }]} onPress={() => addTag(tag)}>
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
          )}

          <View style={[styles.listDivider, { backgroundColor: appColors.border }]} />

          {/* Error */}
          {error && (
            <View style={[styles.errorContainer, { backgroundColor: appColors.errorLight }]}>
              <MaterialCommunityIcons name="alert-circle" size={16} color={appColors.error} />
              <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>
            </View>
          )}

        </ScrollView>

        {/* Bottom Action */}
        <View style={[styles.bottomAction, { backgroundColor: appColors.background, borderTopColor: appColors.border }]}>
          <Pressable
            style={[styles.createButton, (!title.trim() || (schedulingMethod === "SMART" && !dueDate) || loading) && styles.createButtonDisabled]}
            onPress={handleCreateTask}
            disabled={!title.trim() || (schedulingMethod === "SMART" && !dueDate) || loading}
          >
            <View style={[styles.createButtonGradient, { backgroundColor: schedulingMethod === "SMART" ? appColors.aiPurple : appColors.primary }]}>
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <MaterialCommunityIcons name={schedulingMethod === "SMART" ? "star-four-points" : "check"} size={22} color="#FFFFFF" />
                  <Text style={styles.createButtonText}>{schedulingMethod === "MANUAL" ? "Select Time" : "Schedule for me"}</Text>
                </>
              )}
            </View>
          </Pressable>
        </View>

        {/* Tour Tooltips — rendered outside ScrollView, above keyboard */}
        <TourTooltip
          visible={tourStep === "tour_task_title" && !isManualTourMode && !aiModeTooltipDismissed}
          icon="star-four-points"
          iconColor={appColors.aiPurple ?? appColors.secondary}
          title="Switch to AI Schedule"
          body="Tap 'AI Schedule' at the top. Then fill in the details and I'll search your whole day to find the perfect gap."
          ctaLabel="Got it"
          onCta={() => {
            setAiModeTooltipDismissed(true);
            if (canUseSmartScheduling) {
              setSchedulingMethod("SMART");
              if (!dueDate) setDueDate(endOfDay(addDays(new Date(), 1)));
              advanceTour("tour_task_due");
            }
          }}
          onSkip={skipTour}
          showSkip
        />
        <TourTooltip
          visible={tourStep === "tour_task_title" && isManualTourMode}
          icon="pencil-outline"
          iconColor={appColors.primary}
          title="Fill in the basics"
          body="Name it, pick a duration, and set priority. Then you'll choose exactly when to do it."
          ctaLabel="Got it"
          onCta={() => advanceTour("tour_task_tag")}
          onSkip={skipTour}
          showSkip
        />
        <TourTooltip
          visible={tourStep === "tour_task_due" && !isManualTourMode}
          icon="pencil-outline"
          iconColor={appColors.primary}
          title="Now fill in the rest"
          body=""
          pages={[
            {
              icon: "text-box-outline",
              iconColor: appColors.aiPurple ?? appColors.secondary,
              title: "Name it clearly",
              body: "A specific label helps AI pick the right time. 'Review Q4 report' works better than 'Work task'.",
            },
            {
              icon: "clock-outline",
              iconColor: appColors.secondary,
              title: "Duration & priority",
              body: "How long will it take? High priority tasks get scheduled earlier in your day.",
            },
            {
              icon: "calendar-clock",
              iconColor: appColors.success,
              title: "Deadline",
              body: "Set it to tomorrow — gives me room to find the right slot.",
            },
          ]}
          ctaLabel="Got it"
          onCta={() => advanceTour("tour_task_tag")}
          onSkip={skipTour}
          showSkip
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
          title={isManualTourMode ? "Ready to schedule it" : "Ready to find your time"}
          body={isManualTourMode ? "Tap Select Time above. Next you'll pick the exact slot you want." : "I'll create the task and rank the best available slots based on your schedule and energy patterns."}
          ctaLabel="Got it"
          onCta={() => setCreateTooltipDismissed(true)}
          onSkip={skipTour}
          showSkip
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
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: COLORS.background,
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
    paddingTop: 0,
    paddingBottom: 16,
  },

  // Title area — large, open, no border
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

  // List structure
  listDivider: {
    height: 1,
  },

  // Attribute rows
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

  // Schedule pills (inline toggle)
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
  // Duration chips
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

  // Tags
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
    backgroundColor: COLORS.background,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
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
