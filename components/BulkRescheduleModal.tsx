/**
 * BulkRescheduleModal - Urgency-first reschedule for overdue tasks
 *
 * Flow:
 * 1. Show task count + urgency picker: [Today] [Tomorrow] [In 3 days] [This Week]
 * 2. Two modes:
 *    - "AI All": One urgency for all → AI schedules all at once
 *    - "Review Each": Per-task urgency picker → AI suggests → Accept/Change/Skip
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  Text,
  ActivityIndicator,
  ProgressBar,
  Surface,
} from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Task, TimeSlot, UserProfile, CalendarEvent } from "@/lib/types";
import { scheduleTask, saveScheduledSlot } from "@/lib/scheduling";
import { supabase } from "@/lib/supabase";
import { format, addDays, endOfDay } from "date-fns";
import { doTimeSlotsOverlap } from "@/lib/utils";
import SchedulingModal from "./SchedulingModal";
import { useAppColors } from "@/contexts/ThemeContext";

interface BulkRescheduleModalProps {
  visible: boolean;
  tasks: Task[];
  onComplete: () => void;
  onDismiss: () => void;
}

type UrgencyWindow = "today" | "tomorrow" | "3days" | "week";
type FlowMode = "pick" | "ai_all" | "ai_summary" | "review_each";
type TaskResult = "accepted" | "changed" | "skipped" | "failed";

interface PendingSlot {
  task: Task;
  slots: TimeSlot[];
  error?: string;
}

const URGENCY_DAYS: Record<UrgencyWindow, number> = {
  today: 0,
  tomorrow: 1,
  "3days": 3,
  week: 7,
};

const URGENCY_LABELS: Record<UrgencyWindow, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  "3days": "In 3 days",
  week: "This Week",
};

const URGENCY_ICONS: Record<UrgencyWindow, string> = {
  today: "weather-sunny",
  tomorrow: "weather-partly-cloudy",
  "3days": "calendar-range",
  week: "calendar-week",
};

interface OverlapConflict {
  taskAId: string;
  taskATitle: string;
  taskBId: string;
  taskBTitle: string;
}

function detectOverlaps(
  pendingSlots: PendingSlot[],
  slotIndices: Record<string, number>,
): OverlapConflict[] {
  const conflicts: OverlapConflict[] = [];
  for (let i = 0; i < pendingSlots.length; i++) {
    const a = pendingSlots[i];
    const slotA = a.slots[slotIndices[a.task.id] || 0];
    if (!slotA) continue;
    for (let j = i + 1; j < pendingSlots.length; j++) {
      const b = pendingSlots[j];
      const slotB = b.slots[slotIndices[b.task.id] || 0];
      if (!slotB) continue;
      if (doTimeSlotsOverlap(slotA.start, slotA.end, slotB.start, slotB.end)) {
        conflicts.push({
          taskAId: a.task.id,
          taskATitle: a.task.title,
          taskBId: b.task.id,
          taskBTitle: b.task.title,
        });
      }
    }
  }
  return conflicts;
}

export default function BulkRescheduleModal({
  visible,
  tasks,
  onComplete,
  onDismiss,
}: BulkRescheduleModalProps) {
  const appColors = useAppColors();

  // Flow state
  const [mode, setMode] = useState<FlowMode>("pick");

  // Pick mode: deadline date (replaces urgency UrgencyWindow)
  const [deadlineDate, setDeadlineDate] = useState<Date>(endOfDay(addDays(new Date(), 3)));
  const [showPickDatePicker, setShowPickDatePicker] = useState(false);

  // AI All state
  const [aiAllProcessing, setAiAllProcessing] = useState(false);
  const [aiAllProgress, setAiAllProgress] = useState(0);
  const [aiAllResults, setAiAllResults] = useState<TaskResult[]>([]);
  const [aiAllPendingSlots, setAiAllPendingSlots] = useState<PendingSlot[]>([]);
  const [aiAllSaving, setAiAllSaving] = useState(false);

  // Review Each state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [perTaskDeadline, setPerTaskDeadline] = useState<Date>(endOfDay(addDays(new Date(), 3)));
  const [showReviewDatePicker, setShowReviewDatePicker] = useState(false);
  const [showReviewFindButton, setShowReviewFindButton] = useState(false);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [reviewResults, setReviewResults] = useState<TaskResult[]>([]);

  // Review Each: "apply to remaining" shortcut
  const [firstReviewDeadline, setFirstReviewDeadline] = useState<Date | null>(null);
  const [applyToRemaining, setApplyToRemaining] = useState(false);

  // Review Each: slot cycling (Try Another)
  const [slotIndex, setSlotIndex] = useState(0);

  // AI All: per-task slot index for cycling in summary
  const [aiSlotIndices, setAiSlotIndices] = useState<Record<string, number>>({});

  // SchedulingModal for "Change Time" (review each) or manual override (AI summary)
  const [showSchedulingModal, setShowSchedulingModal] = useState(false);
  const [schedulingSlots, setSchedulingSlots] = useState<TimeSlot[]>([]);
  const [manualOverrideTaskId, setManualOverrideTaskId] = useState<string | null>(null);

  // Done screen
  const [showDone, setShowDone] = useState(false);
  const [finalResults, setFinalResults] = useState<TaskResult[]>([]);

  // Overlap detection: AI All summary
  const [forceConfirmOverlaps, setForceConfirmOverlaps] = useState(false);

  // Overlap detection: Review Each
  const [acceptedReviewSlots, setAcceptedReviewSlots] = useState<Array<{ taskId: string; taskTitle: string; slot: TimeSlot }>>([]);
  const [reviewOverlapWarning, setReviewOverlapWarning] = useState<{ conflictsWith: string; slot: TimeSlot } | null>(null);

  const currentTask = tasks[currentIndex];

  // Detect pairwise overlaps among currently-selected AI All slots
  const currentOverlaps = useMemo(() => {
    if (mode !== "ai_summary") return [];
    return detectOverlaps(aiAllPendingSlots, aiSlotIndices);
  }, [mode, aiAllPendingSlots, aiSlotIndices]);

  // Reset force-confirm when user adjusts any slot
  useEffect(() => {
    setForceConfirmOverlaps(false);
  }, [aiSlotIndices]);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setMode("pick");
      setDeadlineDate(endOfDay(addDays(new Date(), 3)));
      setShowPickDatePicker(false);
      setAiAllProcessing(false);
      setAiAllProgress(0);
      setAiAllResults([]);
      setAiAllPendingSlots([]);
      setAiAllSaving(false);
      setAiSlotIndices({});
      setManualOverrideTaskId(null);
      setCurrentIndex(0);
      setPerTaskDeadline(endOfDay(addDays(new Date(), 3)));
      setShowReviewDatePicker(false);
      setShowReviewFindButton(false);
      setSlots([]);
      setFirstReviewDeadline(null);
      setApplyToRemaining(false);
      setSlotIndex(0);
      setLoading(false);
      setError(null);
      setAccepting(false);
      setReviewResults([]);
      setShowDone(false);
      setFinalResults([]);
      setForceConfirmOverlaps(false);
      setAcceptedReviewSlots([]);
      setReviewOverlapWarning(null);
    }
  }, [visible]);

  // ============================================
  // Shared: compute lookAheadDays from a deadline date
  // ============================================
  function deadlineToLookAhead(deadline: Date): number {
    return Math.max(1, Math.ceil((endOfDay(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }

  // ============================================
  // Shared: schedule one task with overridden due_date
  // ============================================
  async function scheduleOneTask(task: Task, deadline: Date): Promise<{ slots: TimeSlot[]; error?: string }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (!profile) throw new Error("Profile not found");

      const { data: existingTasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["scheduled", "pending_schedule"])
        .neq("id", task.id);

      const { data: calendarEvents } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", user.id)
        .gte("end_time", new Date().toISOString());

      const taskWithNewDeadline: Task = {
        ...task,
        due_date: endOfDay(deadline).toISOString(),
      };

      const result = await scheduleTask({
        task: taskWithNewDeadline,
        userProfile: profile as UserProfile,
        existingEvents: (calendarEvents || []) as CalendarEvent[],
        existingTasks: (existingTasks || []) as Task[],
        lookAheadDays: deadlineToLookAhead(deadline),
      });

      if (result.slots.length === 0) {
        return { slots: [], error: "No available times found" };
      }

      return { slots: result.slots.slice(0, 3) };
    } catch (err) {
      return { slots: [], error: err instanceof Error ? err.message : "Scheduling failed" };
    }
  }

  // ============================================
  // AI ALL: Schedule all tasks, then show summary
  // ============================================
  const handleAiAll = async () => {
    setMode("ai_all");
    setAiAllProcessing(true);
    setAiAllProgress(0);
    const pending: PendingSlot[] = [];

    for (let i = 0; i < tasks.length; i++) {
      setAiAllProgress(i + 1);
      const { slots: taskSlots, error: schedError } = await scheduleOneTask(tasks[i], deadlineDate);
      pending.push({ task: tasks[i], slots: taskSlots, error: schedError });
    }

    setAiAllPendingSlots(pending);
    setAiAllProcessing(false);
    setMode("ai_summary");
  };

  // ============================================
  // AI ALL: Confirm and save all pending slots
  // ============================================
  const handleConfirmAiAll = async () => {
    setAiAllSaving(true);
    const results: TaskResult[] = [];

    for (const pending of aiAllPendingSlots) {
      const idx = aiSlotIndices[pending.task.id] || 0;
      const selectedSlot = pending.slots[idx];
      if (selectedSlot) {
        const success = await saveScheduledSlot(pending.task, selectedSlot);
        results.push(success ? "accepted" : "failed");
      } else {
        results.push("failed");
      }
    }

    setAiAllResults(results);
    setAiAllSaving(false);
    setFinalResults(results);
    setShowDone(true);
  };

  // ============================================
  // REVIEW EACH: Load slots for current task
  // ============================================
  const loadSlotsForCurrentTask = async (taskToLoad: Task, deadline: Date) => {
    setLoading(true);
    setError(null);
    setSlots([]);
    setShowReviewFindButton(false);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (!profile) throw new Error("Profile not found");

      const { data: existingTasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["scheduled", "pending_schedule"])
        .neq("id", taskToLoad.id);

      const { data: calendarEvents } = await supabase
        .from("calendar_events")
        .select("*")
        .eq("user_id", user.id)
        .gte("end_time", new Date().toISOString());

      const taskWithNewDeadline: Task = {
        ...taskToLoad,
        due_date: endOfDay(deadline).toISOString(),
      };

      const result = await scheduleTask({
        task: taskWithNewDeadline,
        userProfile: profile as UserProfile,
        existingEvents: (calendarEvents || []) as CalendarEvent[],
        existingTasks: (existingTasks || []) as Task[],
        lookAheadDays: deadlineToLookAhead(deadline),
      });

      setSlots(result.slots);
    } catch (err) {
      console.error("[BulkReschedule] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to find times");
    } finally {
      setLoading(false);
    }
  };

  const startReviewEach = () => {
    setMode("review_each");
    setCurrentIndex(0);
    setReviewResults([]);
    setPerTaskDeadline(endOfDay(addDays(new Date(), 3)));
    setShowReviewDatePicker(false);
    setShowReviewFindButton(false);
    setFirstReviewDeadline(null);
    setApplyToRemaining(false);
    setSlotIndex(0);
    setAcceptedReviewSlots([]);
    setReviewOverlapWarning(null);
    // Don't auto-load — user picks deadline per task first, then we load
  };

  const handleReviewChipPress = (w: UrgencyWindow) => {
    const date = endOfDay(addDays(new Date(), URGENCY_DAYS[w]));
    setPerTaskDeadline(date);
    setShowReviewFindButton(false);
    // Track first pick for "apply to remaining" shortcut
    if (firstReviewDeadline === null) {
      setFirstReviewDeadline(date);
    }
    if (currentTask) {
      loadSlotsForCurrentTask(currentTask, date);
    }
  };

  const handleApplyToRemaining = () => {
    if (firstReviewDeadline) {
      setApplyToRemaining(true);
      setPerTaskDeadline(firstReviewDeadline);
      if (currentTask) {
        loadSlotsForCurrentTask(currentTask, firstReviewDeadline);
      }
    }
  };

  const handleReviewAccept = async (slot: TimeSlot, force = false) => {
    if (!currentTask) return;

    // Check for overlap with previously accepted slots in this session
    if (!force) {
      const conflict = acceptedReviewSlots.find((accepted) =>
        doTimeSlotsOverlap(slot.start, slot.end, accepted.slot.start, accepted.slot.end)
      );
      if (conflict) {
        setReviewOverlapWarning({ conflictsWith: conflict.taskTitle, slot });
        return;
      }
    }

    setReviewOverlapWarning(null);
    setAccepting(true);
    const success = await saveScheduledSlot(currentTask, slot);
    setAccepting(false);

    if (success) {
      setAcceptedReviewSlots((prev) => [
        ...prev,
        { taskId: currentTask.id, taskTitle: currentTask.title, slot },
      ]);
    }

    moveToNextReview(success ? "accepted" : "failed");
  };

  const handleReviewChangeTime = () => {
    setSchedulingSlots(slots);
    setShowSchedulingModal(true);
  };

  const handleSchedulingSelect = async (slot: TimeSlot) => {
    setShowSchedulingModal(false);

    // If this was a manual override from the AI summary screen
    if (manualOverrideTaskId) {
      const pendingIdx = aiAllPendingSlots.findIndex(p => p.task.id === manualOverrideTaskId);
      if (pendingIdx >= 0) {
        // Replace the pending slot with the manually chosen one
        const updated = [...aiAllPendingSlots];
        updated[pendingIdx] = { ...updated[pendingIdx], slots: [slot], error: undefined };
        setAiAllPendingSlots(updated);
        setAiSlotIndices(prev => ({ ...prev, [manualOverrideTaskId!]: 0 }));
      }
      setManualOverrideTaskId(null);
      return;
    }

    // Otherwise it's from review-each
    await handleReviewAccept(slot);
  };

  const handleReviewSkip = () => {
    moveToNextReview("skipped");
  };

  const moveToNextReview = (result: TaskResult) => {
    const newResults = [...reviewResults, result];
    setReviewResults(newResults);

    const nextIndex = currentIndex + 1;
    if (nextIndex >= tasks.length) {
      setFinalResults(newResults);
      setShowDone(true);
    } else {
      setCurrentIndex(nextIndex);
      setSlots([]);
      setError(null);
      setSlotIndex(0);
      // If "apply to remaining" is active, auto-load with same deadline
      if (applyToRemaining && firstReviewDeadline) {
        loadSlotsForCurrentTask(tasks[nextIndex], firstReviewDeadline);
      }
      // Otherwise user picks urgency for next task
    }
  };

  // ============================================
  // Computed
  // ============================================
  const rescheduledCount = finalResults.filter((r) => r === "accepted" || r === "changed").length;
  const failedCount = finalResults.filter((r) => r === "failed").length;
  const reviewHasLoadedSlots = mode === "review_each" && slots.length > 0;
  const reviewIsPickingUrgency = mode === "review_each" && slots.length === 0 && !loading && !error;

  if (!visible) return null;

  const currentSlot = slots[slotIndex];
  const hasMoreSlots = slotIndex < slots.length - 1;
  const exhaustedSlots = slots.length > 0 && slotIndex >= slots.length - 1;

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
        <View style={styles.overlay}>
          <Surface style={[styles.modal, { backgroundColor: appColors.surface }]} elevation={5}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: appColors.border }]}>
              <Text style={[styles.title, { color: appColors.textPrimary }]}>
                {showDone ? "All done!" : mode === "pick" ? "Reschedule Overdue" : mode === "ai_all" ? "AI Scheduling..." : mode === "ai_summary" ? "Review Schedule" : "Review Tasks"}
              </Text>
              <Pressable onPress={onDismiss} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={24} color={appColors.textSecondary} />
              </Pressable>
            </View>

            {/* ===== DONE SCREEN ===== */}
            {showDone && (
              <View style={styles.doneContainer}>
                <MaterialCommunityIcons name="check-circle" size={56} color={appColors.success} />
                <Text style={[styles.doneTitle, { color: appColors.textPrimary }]}>Rescheduling Complete</Text>
                <Text style={[styles.doneSubtitle, { color: appColors.textSecondary }]}>
                  {rescheduledCount} of {tasks.length} task{tasks.length !== 1 ? "s" : ""} rescheduled
                  {failedCount > 0 ? `\n${failedCount} couldn't be scheduled` : ""}
                </Text>
                <Pressable style={[styles.doneButton, { backgroundColor: appColors.primary }]} onPress={onComplete}>
                  <Text style={styles.doneButtonText}>Done</Text>
                </Pressable>
              </View>
            )}

            {/* ===== PICK MODE: Urgency + AI All / Review Each ===== */}
            {mode === "pick" && !showDone && (
              <View style={styles.pickContainer}>
                {/* Icon circle */}
                <View style={[styles.pickIconCircle, { backgroundColor: `${appColors.error}15` }]}>
                  <MaterialCommunityIcons name="calendar-alert" size={28} color={appColors.error} />
                </View>

                <Text style={[styles.pickTitle, { color: appColors.textPrimary }]}>
                  {tasks.length} overdue task{tasks.length !== 1 ? "s" : ""}
                </Text>
                <Text style={[styles.pickSubtitle, { color: appColors.textSecondary }]}>
                  When do you need these done?
                </Text>

                {/* Date display — tap to open picker */}
                <Pressable
                  style={[styles.dateDisplay, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]}
                  onPress={() => setShowPickDatePicker(true)}
                >
                  <MaterialCommunityIcons name="calendar" size={18} color={appColors.primary} />
                  <Text style={[styles.dateDisplayText, { color: appColors.textPrimary }]}>
                    {format(deadlineDate, "EEEE, MMM d")}
                  </Text>
                  <MaterialCommunityIcons name="pencil-outline" size={15} color={appColors.textTertiary} />
                </Pressable>

                {showPickDatePicker && (
                  <DateTimePicker
                    value={deadlineDate}
                    mode="date"
                    minimumDate={new Date()}
                    onChange={(_event: any, date?: Date) => {
                      setShowPickDatePicker(Platform.OS === "ios");
                      if (date) setDeadlineDate(endOfDay(date));
                    }}
                  />
                )}

                {/* Quick options — single row, text only */}
                <View style={styles.urgencyRow}>
                  {(["today", "tomorrow", "3days", "week"] as UrgencyWindow[]).map((w) => {
                    const chipDate = endOfDay(addDays(new Date(), URGENCY_DAYS[w]));
                    const isSelected = format(deadlineDate, "yyyy-MM-dd") === format(chipDate, "yyyy-MM-dd");
                    return (
                      <Pressable
                        key={w}
                        style={[
                          styles.urgencyPill,
                          { borderColor: appColors.border },
                          isSelected && { borderColor: appColors.primary, backgroundColor: `${appColors.primary}10` },
                        ]}
                        onPress={() => setDeadlineDate(chipDate)}
                      >
                        <Text style={[
                          styles.urgencyPillText,
                          { color: appColors.textSecondary },
                          isSelected && { color: appColors.primary, fontWeight: "700" },
                        ]}>
                          {URGENCY_LABELS[w]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Method cards — matching SchedulingModal's method choice */}
                <Pressable
                  style={[styles.methodCard, { backgroundColor: `${appColors.primary}10` }]}
                  onPress={handleAiAll}
                >
                  <View style={[styles.methodCardIcon, { backgroundColor: `${appColors.primary}20` }]}>
                    <MaterialCommunityIcons name="brain" size={26} color={appColors.primary} />
                  </View>
                  <View style={styles.methodCardContent}>
                    <Text style={[styles.methodCardTitle, { color: appColors.textPrimary }]}>AI Schedule All</Text>
                    <Text style={[styles.methodCardDesc, { color: appColors.textSecondary }]}>
                      Schedule all tasks at once with AI
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={appColors.textTertiary} />
                </Pressable>

                <Pressable
                  style={[styles.methodCard, { backgroundColor: appColors.inputBg }]}
                  onPress={startReviewEach}
                >
                  <View style={[styles.methodCardIcon, { backgroundColor: appColors.chipBg }]}>
                    <MaterialCommunityIcons name="eye-outline" size={26} color={appColors.textSecondary} />
                  </View>
                  <View style={styles.methodCardContent}>
                    <Text style={[styles.methodCardTitle, { color: appColors.textPrimary }]}>Review Each Task</Text>
                    <Text style={[styles.methodCardDesc, { color: appColors.textSecondary }]}>
                      Set urgency and approve per task
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={appColors.textTertiary} />
                </Pressable>

              </View>
            )}

            {/* ===== AI ALL: Processing ===== */}
            {mode === "ai_all" && !showDone && (
              <View style={styles.aiAllContainer}>
                <ActivityIndicator size="large" color={appColors.primary} />
                <Text style={[styles.aiAllProgressText, { color: appColors.textPrimary }]}>
                  Scheduling task {aiAllProgress} of {tasks.length}
                </Text>
                {aiAllProgress > 0 && aiAllProgress <= tasks.length && (
                  <Text style={[styles.aiAllCurrentTask, { color: appColors.textSecondary }]}>
                    {tasks[aiAllProgress - 1]?.title}
                  </Text>
                )}
                <ProgressBar
                  progress={tasks.length > 0 ? aiAllProgress / tasks.length : 0}
                  color={appColors.primary}
                  style={[styles.aiAllBar, { backgroundColor: appColors.chipBg }]}
                />
              </View>
            )}

            {/* ===== AI SUMMARY: Review before confirming ===== */}
            {mode === "ai_summary" && !showDone && (
              <>
                <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                  <Text style={[styles.summarySubtitle, { color: appColors.textSecondary }]}>
                    Tap arrows to see other options per task
                  </Text>
                  {aiAllPendingSlots.map((pending) => {
                    const taskId = pending.task.id;
                    const si = aiSlotIndices[taskId] || 0;
                    const currentSlotForTask = pending.slots[si];
                    const hasMore = si < pending.slots.length - 1;
                    const hasPrev = si > 0;
                    const isConflicting = currentOverlaps.some(
                      (c) => c.taskAId === taskId || c.taskBId === taskId
                    );

                    return (
                      <View
                        key={taskId}
                        style={[
                          styles.summaryCard,
                          { backgroundColor: appColors.inputBg, borderColor: appColors.border },
                          isConflicting && { borderColor: appColors.warning, borderWidth: 2 },
                        ]}
                      >
                        {/* Task title */}
                        <Text style={[styles.summaryTaskTitle, { color: appColors.textPrimary }]} numberOfLines={1}>
                          {pending.task.title}
                        </Text>

                        {currentSlotForTask ? (
                          <>
                            {/* Slot time + navigation arrows */}
                            <View style={styles.summarySlotRow}>
                              <Pressable
                                onPress={() => setAiSlotIndices(prev => ({ ...prev, [taskId]: si - 1 }))}
                                disabled={!hasPrev}
                                hitSlop={8}
                                style={{ opacity: hasPrev ? 1 : 0.25 }}
                              >
                                <MaterialCommunityIcons name="chevron-left" size={24} color={appColors.primary} />
                              </Pressable>

                              <View style={styles.summarySlotCenter}>
                                <Text style={[styles.summarySlotDate, { color: appColors.textSecondary }]}>
                                  {formatDate(currentSlotForTask.start)}
                                </Text>
                                <Text style={[styles.summarySlotTime, { color: appColors.textPrimary }]}>
                                  {formatTime(currentSlotForTask.start)} - {formatTime(currentSlotForTask.end)}
                                </Text>
                                {pending.slots.length > 1 && (
                                  <Text style={[styles.summarySlotCounter, { color: appColors.textTertiary }]}>
                                    Option {si + 1} of {pending.slots.length}
                                  </Text>
                                )}
                              </View>

                              <Pressable
                                onPress={() => setAiSlotIndices(prev => ({ ...prev, [taskId]: si + 1 }))}
                                disabled={!hasMore}
                                hitSlop={8}
                                style={{ opacity: hasMore ? 1 : 0.25 }}
                              >
                                <MaterialCommunityIcons name="chevron-right" size={24} color={appColors.primary} />
                              </Pressable>
                            </View>

                            {/* Always-visible manual option */}
                            <Pressable
                              style={styles.summaryManualRow}
                              onPress={() => {
                                setManualOverrideTaskId(taskId);
                                setSchedulingSlots([]);
                                setShowSchedulingModal(true);
                              }}
                            >
                              <MaterialCommunityIcons name="clock-edit-outline" size={13} color={appColors.textTertiary} />
                              <Text style={[styles.summaryManualLink, { color: appColors.textTertiary }]}>
                                Set manually
                              </Text>
                            </Pressable>
                          </>
                        ) : (
                          <View style={styles.summaryErrorRow}>
                            <MaterialCommunityIcons name="alert-circle" size={16} color={appColors.error} />
                            <Text style={[styles.summaryErrorText, { color: appColors.error }]}>
                              {pending.error || "No time found"}
                            </Text>
                            <Pressable
                              onPress={() => {
                                setManualOverrideTaskId(taskId);
                                setSchedulingSlots([]);
                                setShowSchedulingModal(true);
                              }}
                            >
                              <Text style={[styles.summaryManualLink, { color: appColors.primary }]}>
                                Set manually
                              </Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  })}
                  <View style={{ height: 20 }} />
                </ScrollView>

                {/* Overlap warning banner */}
                {currentOverlaps.length > 0 && (
                  <View style={[styles.overlapBanner, { backgroundColor: appColors.warningLight }]}>
                    <MaterialCommunityIcons name="alert-outline" size={18} color={appColors.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.overlapBannerTitle, { color: appColors.warning }]}>
                        Time conflicts detected
                      </Text>
                      {currentOverlaps.map((conflict, idx) => (
                        <Text key={idx} style={[styles.overlapBannerDetail, { color: appColors.textSecondary }]}>
                          "{conflict.taskATitle}" overlaps with "{conflict.taskBTitle}"
                        </Text>
                      ))}
                    </View>
                  </View>
                )}

                <View style={[styles.actionBar, { borderTopColor: appColors.border }]}>
                  <Pressable
                    style={[
                      styles.actionButton,
                      styles.acceptButton,
                      { backgroundColor: forceConfirmOverlaps && currentOverlaps.length > 0 ? appColors.warning : appColors.success },
                      aiAllSaving && styles.actionButtonDisabled,
                    ]}
                    onPress={() => {
                      if (currentOverlaps.length > 0 && !forceConfirmOverlaps) {
                        setForceConfirmOverlaps(true);
                        return;
                      }
                      handleConfirmAiAll();
                    }}
                    disabled={aiAllSaving}
                  >
                    {aiAllSaving ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="check-all" size={20} color="#FFFFFF" />
                        <Text style={styles.acceptButtonText}>
                          {forceConfirmOverlaps && currentOverlaps.length > 0
                            ? "Confirm Anyway"
                            : `Confirm All (${aiAllPendingSlots.filter(p => p.slots.length > 0).length})`}
                        </Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    style={[styles.actionButton, styles.changeButton, { backgroundColor: appColors.surface, borderColor: appColors.border }]}
                    onPress={onDismiss}
                    disabled={aiAllSaving}
                  >
                    <Text style={[styles.changeButtonText, { color: appColors.textSecondary }]}>Cancel</Text>
                  </Pressable>
                </View>
              </>
            )}

            {/* ===== REVIEW EACH ===== */}
            {mode === "review_each" && !showDone && (
              <>
                {/* Progress */}
                <View style={styles.progressSection}>
                  <Text style={[styles.progressLabel, { color: appColors.textSecondary }]}>
                    Task {currentIndex + 1} of {tasks.length}
                  </Text>
                  <ProgressBar
                    progress={(currentIndex + 1) / tasks.length}
                    color={appColors.primary}
                    style={[styles.progressBarSmall, { backgroundColor: appColors.chipBg }]}
                  />
                </View>

                <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                  {/* Task info */}
                  {currentTask && (
                    <View style={[styles.taskInfoCard, { backgroundColor: appColors.inputBg }]}>
                      <Text style={[styles.taskTitle, { color: appColors.textPrimary }]}>
                        {currentTask.title}
                      </Text>
                      <View style={styles.taskMeta}>
                        <View style={styles.taskMetaItem}>
                          <MaterialCommunityIcons name="timer-outline" size={14} color={appColors.textTertiary} />
                          <Text style={[styles.taskMetaText, { color: appColors.textTertiary }]}>
                            {currentTask.duration_minutes} min
                          </Text>
                        </View>
                        {currentTask.due_date && (
                          <View style={styles.taskMetaItem}>
                            <MaterialCommunityIcons name="calendar-alert" size={14} color={appColors.error} />
                            <Text style={[styles.taskMetaText, { color: appColors.error }]}>
                              Was due {format(new Date(currentTask.due_date), "MMM d")}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  )}

                  {/* Per-task deadline picker (shown before AI loads) */}
                  {reviewIsPickingUrgency && (
                    <View style={styles.reviewUrgencySection}>
                      <Text style={[styles.reviewUrgencyLabel, { color: appColors.textPrimary }]}>
                        When do you need this done?
                      </Text>

                      {/* Date display */}
                      <Pressable
                        style={[styles.dateDisplay, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]}
                        onPress={() => setShowReviewDatePicker(true)}
                      >
                        <MaterialCommunityIcons name="calendar" size={20} color={appColors.primary} />
                        <Text style={[styles.dateDisplayText, { color: appColors.textPrimary }]}>
                          {format(perTaskDeadline, "EEEE, MMM d")}
                        </Text>
                        <MaterialCommunityIcons name="pencil-outline" size={16} color={appColors.textTertiary} />
                      </Pressable>

                      {showReviewDatePicker && (
                        <DateTimePicker
                          value={perTaskDeadline}
                          mode="date"
                          minimumDate={new Date()}
                          onChange={(_event: any, date?: Date) => {
                            setShowReviewDatePicker(Platform.OS === "ios");
                            if (date) {
                              setPerTaskDeadline(endOfDay(date));
                              setShowReviewFindButton(true);
                            }
                          }}
                        />
                      )}

                      <View style={styles.urgencyRow}>
                        {(["today", "tomorrow", "3days", "week"] as UrgencyWindow[]).map((w) => {
                          const chipDate = endOfDay(addDays(new Date(), URGENCY_DAYS[w]));
                          const isSelected = !showReviewFindButton &&
                            format(perTaskDeadline, "yyyy-MM-dd") === format(chipDate, "yyyy-MM-dd");
                          return (
                            <Pressable
                              key={w}
                              style={[
                                styles.urgencyPill,
                                { borderColor: appColors.border },
                                isSelected && { borderColor: appColors.primary, backgroundColor: `${appColors.primary}10` },
                              ]}
                              onPress={() => handleReviewChipPress(w)}
                            >
                              <Text style={[
                                styles.urgencyPillText,
                                { color: appColors.textSecondary },
                                isSelected && { color: appColors.primary, fontWeight: "700" },
                              ]}>
                                {URGENCY_LABELS[w]}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      {/* Custom date confirm button */}
                      {showReviewFindButton && (
                        <Pressable
                          style={[styles.findTimeButton, { backgroundColor: appColors.primary }]}
                          onPress={() => currentTask && loadSlotsForCurrentTask(currentTask, perTaskDeadline)}
                        >
                          <MaterialCommunityIcons name="brain" size={18} color="#FFFFFF" />
                          <Text style={styles.findTimeButtonText}>Find Best Time</Text>
                        </Pressable>
                      )}

                      {/* "Apply to remaining" shortcut after first pick */}
                      {firstReviewDeadline !== null && !applyToRemaining && currentIndex > 0 && (
                        <Pressable
                          style={[styles.applyRemainingButton, { backgroundColor: appColors.primaryLight, borderColor: appColors.primary }]}
                          onPress={handleApplyToRemaining}
                        >
                          <MaterialCommunityIcons name="lightning-bolt" size={16} color={appColors.primary} />
                          <Text style={[styles.applyRemainingText, { color: appColors.primary }]}>
                            Apply "{format(firstReviewDeadline, "MMM d")}" to remaining {tasks.length - currentIndex} tasks
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  )}

                  {/* Loading */}
                  {loading && (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="large" color={appColors.primary} />
                      <Text style={[styles.loadingText, { color: appColors.textSecondary }]}>
                        Finding the best time...
                      </Text>
                    </View>
                  )}

                  {/* Error */}
                  {error && !loading && (
                    <View style={styles.errorContainer}>
                      <MaterialCommunityIcons name="alert-circle-outline" size={32} color={appColors.error} />
                      <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>
                      <Pressable
                        style={[styles.retryButton, { backgroundColor: appColors.inputBg }]}
                        onPress={() => currentTask && loadSlotsForCurrentTask(currentTask, perTaskDeadline)}
                      >
                        <Text style={[styles.retryButtonText, { color: appColors.primary }]}>Try Again</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* AI Suggestion */}
                  {!loading && !error && currentSlot && (
                    <View style={[styles.suggestionCard, { backgroundColor: appColors.primaryLight, borderColor: appColors.border }]}>
                      <View style={styles.suggestionHeader}>
                        <MaterialCommunityIcons name="robot-outline" size={18} color={appColors.secondary} />
                        <Text style={[styles.suggestionLabel, { color: appColors.secondary }]}>
                          AI Suggestion
                        </Text>
                      </View>

                      <Text style={[styles.suggestionDate, { color: appColors.textSecondary }]}>
                        {formatDate(currentSlot.start)}
                      </Text>
                      <Text style={[styles.suggestionTime, { color: appColors.textPrimary }]}>
                        {formatTime(currentSlot.start)} - {formatTime(currentSlot.end)}
                      </Text>

                      {currentSlot.reason && (
                        <Text style={[styles.reasonText, { color: appColors.textSecondary }]}>
                          "{currentSlot.reason}"
                        </Text>
                      )}

                      {currentSlot.factors && currentSlot.factors.length > 0 && (
                        <View style={styles.factorsContainer}>
                          {currentSlot.factors.slice(0, 3).map((factor, idx) => (
                            <View key={idx} style={styles.factorRow}>
                              <MaterialCommunityIcons
                                name={
                                  (factor.icon as any) ||
                                  (factor.impact > 0 ? "check-circle" : "alert-circle")
                                }
                                size={14}
                                color={factor.impact > 0 ? appColors.success : appColors.warning}
                              />
                              <Text style={[styles.factorText, { color: appColors.textSecondary }]}>
                                {factor.description}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {/* No slots found */}
                  {!loading && !error && slots.length === 0 && !reviewIsPickingUrgency && (
                    <View style={styles.noSlotsContainer}>
                      <MaterialCommunityIcons name="calendar-remove-outline" size={32} color={appColors.textTertiary} />
                      <Text style={[styles.noSlotsText, { color: appColors.textTertiary }]}>
                        No available times found
                      </Text>
                    </View>
                  )}

                  <View style={{ height: 20 }} />
                </ScrollView>

                {/* Slot counter */}
                {!loading && !error && currentSlot && slots.length > 1 && (
                  <Text style={[styles.slotCounter, { color: appColors.textTertiary }]}>
                    Option {slotIndex + 1} of {slots.length}
                  </Text>
                )}

                {/* Exhausted all slots message */}
                {!loading && !error && exhaustedSlots && slots.length > 1 && (
                  <View style={[styles.exhaustedBanner, { backgroundColor: appColors.warningLight }]}>
                    <MaterialCommunityIcons name="information-outline" size={16} color={appColors.warning} />
                    <Text style={[styles.exhaustedText, { color: appColors.warning }]}>
                      No more AI options — pick one above or set time manually
                    </Text>
                  </View>
                )}

                {/* Review Each: overlap warning */}
                {reviewOverlapWarning && (
                  <View style={[styles.overlapBanner, { backgroundColor: appColors.warningLight }]}>
                    <MaterialCommunityIcons name="alert-outline" size={18} color={appColors.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.overlapBannerTitle, { color: appColors.warning }]}>
                        Overlaps with "{reviewOverlapWarning.conflictsWith}"
                      </Text>
                      <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
                        <Pressable onPress={() => handleReviewAccept(reviewOverlapWarning.slot, true)}>
                          <Text style={[styles.overlapAction, { color: appColors.warning }]}>Accept Anyway</Text>
                        </Pressable>
                        <Pressable onPress={() => setReviewOverlapWarning(null)}>
                          <Text style={[styles.overlapAction, { color: appColors.textSecondary }]}>Pick Different</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                )}

                {/* Action bar: Accept / Try Another / Start Over + Manual */}
                {!loading && !error && currentSlot && (
                  <View style={[styles.actionBar, { borderTopColor: appColors.border }]}>
                    <Pressable
                      style={[styles.actionButton, styles.acceptButton, { backgroundColor: appColors.success }, accepting && styles.actionButtonDisabled]}
                      onPress={() => handleReviewAccept(currentSlot)}
                      disabled={accepting}
                    >
                      {accepting ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <MaterialCommunityIcons name="check" size={20} color="#FFFFFF" />
                          <Text style={styles.acceptButtonText}>Accept</Text>
                        </>
                      )}
                    </Pressable>
                    {hasMoreSlots ? (
                      <Pressable
                        style={[styles.actionButton, styles.changeButton, { backgroundColor: appColors.surface, borderColor: appColors.primary }]}
                        onPress={() => setSlotIndex(slotIndex + 1)}
                        disabled={accepting}
                      >
                        <MaterialCommunityIcons name="refresh" size={18} color={appColors.primary} />
                        <Text style={[styles.changeButtonText, { color: appColors.primary }]}>Try Another</Text>
                      </Pressable>
                    ) : (
                      <>
                        {slots.length > 1 && (
                          <Pressable
                            style={[styles.actionButton, styles.startOverButton, { backgroundColor: appColors.surface, borderColor: appColors.primary }]}
                            onPress={() => setSlotIndex(0)}
                            disabled={accepting}
                          >
                            <MaterialCommunityIcons name="arrow-left" size={18} color={appColors.primary} />
                          </Pressable>
                        )}
                        <Pressable
                          style={[styles.actionButton, styles.changeButton, { backgroundColor: appColors.surface, borderColor: appColors.textSecondary }]}
                          onPress={handleReviewChangeTime}
                          disabled={accepting}
                        >
                          <MaterialCommunityIcons name="clock-outline" size={18} color={appColors.textSecondary} />
                          <Text style={[styles.changeButtonText, { color: appColors.textSecondary }]}>Manual</Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                )}

                {/* Skip-only when no slots */}
                {!loading && !error && slots.length === 0 && !reviewIsPickingUrgency && (
                  <View style={[styles.actionBar, { borderTopColor: appColors.border }]}>
                    <Pressable
                      style={[styles.actionButton, styles.skipButton, { flex: 1, backgroundColor: appColors.inputBg }]}
                      onPress={handleReviewSkip}
                    >
                      <Text style={[styles.skipButtonText, { color: appColors.textSecondary }]}>Skip</Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}
          </Surface>
        </View>
      </Modal>

      {/* Full SchedulingModal for manual time picking */}
      {(() => {
        const manualTask = manualOverrideTaskId
          ? aiAllPendingSlots.find(p => p.task.id === manualOverrideTaskId)?.task
          : currentTask;
        return manualTask ? (
          <SchedulingModal
            visible={showSchedulingModal}
            onClose={() => { setShowSchedulingModal(false); setManualOverrideTaskId(null); }}
            onSelectSlot={handleSchedulingSelect}
            task={manualTask}
            slots={schedulingSlots}
            isLoading={false}
            error={null}
            schedulingMethod="MANUAL"
            busySlots={[]}
          />
        ) : null;
      })()}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modal: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: "80%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },

  // ===== PICK MODE =====
  pickContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: "center",
  },
  pickIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  pickTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  pickSubtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  dateDisplay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    width: "100%",
    marginBottom: 12,
  },
  dateDisplayText: {
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  urgencyRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 20,
    width: "100%",
  },
  urgencyPill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  urgencyPillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  findTimeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    width: "100%",
    marginTop: 4,
  },
  findTimeButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  methodCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    gap: 12,
    width: "100%",
    marginBottom: 10,
  },
  methodCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  methodCardContent: {
    flex: 1,
  },
  methodCardTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  methodCardDesc: {
    fontSize: 13,
    lineHeight: 18,
  },

  // ===== AI ALL =====
  aiAllContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 16,
  },
  aiAllProgressText: {
    fontSize: 18,
    fontWeight: "600",
    marginTop: 12,
  },
  aiAllCurrentTask: {
    fontSize: 14,
    textAlign: "center",
  },
  aiAllBar: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    marginTop: 8,
  },

  // ===== REVIEW EACH =====
  progressSection: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 8,
  },
  progressBarSmall: {
    height: 4,
    borderRadius: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  taskInfoCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  taskTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  taskMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  taskMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  taskMetaText: {
    fontSize: 13,
  },
  reviewUrgencySection: {
    alignItems: "center",
    paddingVertical: 12,
    width: "100%",
  },
  reviewUrgencyLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 16,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
  },
  errorContainer: {
    alignItems: "center",
    paddingVertical: 30,
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  suggestionCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  suggestionLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  suggestionDate: {
    fontSize: 15,
    marginBottom: 2,
  },
  suggestionTime: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: 12,
  },
  reasonText: {
    fontSize: 14,
    fontStyle: "italic",
    marginBottom: 12,
    lineHeight: 20,
  },
  factorsContainer: {
    gap: 6,
  },
  factorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  factorText: {
    fontSize: 13,
    flex: 1,
  },
  noSlotsContainer: {
    alignItems: "center",
    paddingVertical: 30,
    gap: 12,
  },
  noSlotsText: {
    fontSize: 14,
    textAlign: "center",
  },

  // Action bar
  actionBar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
  },
  actionButtonDisabled: {
    opacity: 0.7,
  },
  acceptButton: {
    flex: 2,
  },
  acceptButtonText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  changeButton: {
    flex: 1.5,
    borderWidth: 1,
  },
  startOverButton: {
    width: 48,
    borderWidth: 1,
    paddingHorizontal: 0,
  },
  changeButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  skipButton: {
    flex: 1,
  },
  skipButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },

  // AI Summary
  summarySubtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
    marginTop: 4,
  },
  summaryCard: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
  },
  summaryTaskTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 8,
  },
  summarySlotRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summarySlotCenter: {
    flex: 1,
    alignItems: "center",
  },
  summarySlotDate: {
    fontSize: 13,
    marginBottom: 2,
  },
  summarySlotTime: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  summarySlotCounter: {
    fontSize: 11,
    marginTop: 2,
  },
  summaryManualRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.06)",
  },
  summaryManualLink: {
    fontSize: 12,
    fontWeight: "500",
  },
  summaryErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryErrorText: {
    fontSize: 13,
    flex: 1,
  },

  // Slot counter + exhausted
  slotCounter: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 4,
  },
  exhaustedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  exhaustedText: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },

  // Apply to remaining
  applyRemainingButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  applyRemainingText: {
    fontSize: 13,
    fontWeight: "600",
  },

  // Overlap detection
  overlapBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  overlapBannerTitle: {
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 2,
  },
  overlapBannerDetail: {
    fontSize: 12,
    lineHeight: 16,
  },
  overlapAction: {
    fontSize: 13,
    fontWeight: "600",
  },


  // Done screen
  doneContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  doneTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginTop: 20,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  doneSubtitle: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 22,
  },
  doneButton: {
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 14,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
