/**
 * QuickAddSheet - Compact bottom sheet for instant task creation
 *
 * Two taps: type name → Create. Expand button transitions to full add-task screen.
 * Reuses SchedulingModal for slot selection after task creation.
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  ActivityIndicator,
  Animated,
  Dimensions,
} from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { format, addDays, endOfDay } from "date-fns";
import DateTimePicker from "@react-native-community/datetimepicker";
import { supabase } from "@/lib/supabase";
import { Task, TimeSlot, UserProfile, CalendarEvent } from "@/lib/types";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/contexts/ThemeContext";
import { scheduleTask } from "@/lib/scheduling";
import { safeCreateCalendarEvent } from "@/lib/google-calendar";
import { scheduleTaskReminder } from "@/lib/notifications";
import { trackTaskCreated, trackTaskScheduled, updateFunnel } from "@/lib/analytics";
import SchedulingModal from "@/components/SchedulingModal";

type Duration = "30" | "60" | "120" | "custom";
type Priority = "low" | "medium" | "high";

interface QuickAddSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onCreated: () => void;
  preselectedDate?: Date;
}

const SHEET_HEIGHT = 400; // approximate max sheet height for animation

export default function QuickAddSheet({ visible, onDismiss, onCreated, preselectedDate }: QuickAddSheetProps) {
  const appColors = useAppColors();
  const { canUseAI, aiUsage, refreshAIUsage } = useSubscription();
  const inputRef = useRef<TextInput>(null);

  // Animation values
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const [modalVisible, setModalVisible] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [duration, setDuration] = useState<Duration>("30");
  const [customDuration, setCustomDuration] = useState("45");
  const [showCustomDurationModal, setShowCustomDurationModal] = useState(false);
  const [priority, setPriority] = useState<Priority>("medium");

  const isAtWeeklyLimit = aiUsage && !aiUsage.isUnlimited && aiUsage.used >= aiUsage.limit;
  const canUseSmartScheduling = canUseAI && !isAtWeeklyLimit;
  const [schedulingMethod, setSchedulingMethod] = useState<"SMART" | "MANUAL">(
    "MANUAL"
  );

  const [dueDate, setDueDate] = useState<Date | null>(endOfDay(addDays(new Date(), 1)));
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

  // Animate in: slide sheet + fade overlay + focus input together
  useEffect(() => {
    if (visible) {
      // Reset form state
      setTitle("");
      setDescription("");
      setShowDescription(false);
      setDuration("30");
      setCustomDuration("45");
      setShowCustomDurationModal(false);
      setPriority("medium");
      setSchedulingMethod("MANUAL");
      setDueDate(endOfDay(addDays(new Date(), 1)));
      setShowDatePicker(false);
      setLoading(false);
      setError(null);
      setShowSchedulingModal(false);
      setCreatedTask(null);
      setSchedulingSlots([]);
      setSchedulingLoading(false);
      setSchedulingError(null);
      setBusySlots([]);

      // Show modal container instantly, then animate contents
      sheetTranslateY.setValue(SHEET_HEIGHT);
      overlayOpacity.setValue(0);
      setModalVisible(true);

      // Run slide + fade together, focus input early so keyboard rises in sync
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.spring(sheetTranslateY, {
          toValue: 0,
          damping: 28,
          stiffness: 300,
          mass: 0.8,
          useNativeDriver: true,
        }),
      ]).start();

      // Focus at ~100ms — keyboard starts rising while sheet is still sliding up
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  // Animate out then truly dismiss
  const animateDismiss = useCallback((callback?: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: SHEET_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setModalVisible(false);
      if (callback) callback();
      else onDismiss();
    });
  }, [onDismiss, overlayOpacity, sheetTranslateY]);

  const handleExpand = () => {
    animateDismiss(() => {
      onDismiss();
      router.push({
        pathname: "/(tabs)/add-task",
        params: {
          title,
          duration,
          priority,
          schedulingMethod,
          ...(dueDate ? { dueDate: dueDate.toISOString() } : {}),
        },
      });
    });
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    if (schedulingMethod === "SMART" && !dueDate) {
      setError("Due date is required for AI scheduling");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      Keyboard.dismiss();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: insertedTask, error: insertError } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          title: title.trim(),
          description: description.trim() || null,
          duration_minutes: resolvedDurationMinutes,
          priority,
          task_type: null,
          scheduling_method: schedulingMethod,
          // Manual tasks: placeholder due_date replaced by end-of-slot-day when slot is picked
          due_date: schedulingMethod === "SMART"
            ? dueDate!.toISOString()
            : endOfDay(addDays(new Date(), 30)).toISOString(),
          status: "pending_schedule",
          tags: [],
        })
        .select()
        .single();

      if (insertError) throw insertError;

      await trackTaskCreated(schedulingMethod);
      await updateFunnel("first_task_at");

      setCreatedTask(insertedTask as Task);
      setShowSchedulingModal(true);

      if (schedulingMethod === "SMART") {
        await runSmartScheduling(insertedTask as Task, user.id);
      } else {
        await loadBusySlots(user.id);
      }
    } catch (err) {
      console.error("[QuickAdd] Error:", err);
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
      console.error("[QuickAdd] Scheduling error:", err);
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
      console.error("[QuickAdd] Load busy slots error:", err);
    } finally {
      setSchedulingLoading(false);
    }
  };

  const handleSelectSlot = async (slot: TimeSlot) => {
    if (!createdTask) return;

    try {
      setSchedulingLoading(true);

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
        // For manual tasks: set due_date to end of the day they scheduled it on
        ...(schedulingMethod === "MANUAL" && {
          // Use local date components to avoid UTC offset shifting the day
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
        await trackTaskScheduled(schedulingMethod);
        await updateFunnel("first_schedule_at");
        if (schedulingMethod === "SMART") {
          await refreshAIUsage();
        }
      }

      setShowSchedulingModal(false);
      setModalVisible(false);
      onCreated();
    } catch (err) {
      console.error("[QuickAdd] Update error:", err);
      setSchedulingError(err instanceof Error ? err.message : "Failed to schedule task");
    } finally {
      setSchedulingLoading(false);
    }
  };

  const handleCloseSchedulingModal = () => {
    setShowSchedulingModal(false);
    setModalVisible(false);
    // Task was created but not scheduled - still dismiss and refresh
    onCreated();
  };

  const durationOptions: { value: Duration; label: string }[] = [
    { value: "30", label: "30m" },
    { value: "60", label: "1h" },
    { value: "120", label: "2h" },
    { value: "custom", label: "Custom" },
  ];

  const resolvedDurationMinutes =
    duration === "custom"
      ? Math.max(5, Math.min(480, parseInt(customDuration) || 45))
      : parseInt(duration);

  const priorityOptions: { value: Priority; label: string; color: string }[] = [
    { value: "low", label: "Low", color: appColors.priorityLow },
    { value: "medium", label: "Med", color: appColors.priorityMedium },
    { value: "high", label: "High", color: appColors.priorityHigh },
  ];

  const priorityColor =
    priority === "high" ? appColors.priorityHigh :
    priority === "medium" ? appColors.priorityMedium : appColors.priorityLow;

  const quickDueDates = [
    { label: "Today", date: endOfDay(new Date()) },
    { label: "Tomorrow", date: endOfDay(addDays(new Date(), 1)) },
    { label: "Next Week", date: endOfDay(addDays(new Date(), 7)) },
  ];

  const isDueDateSelected = (date: Date) => {
    if (!dueDate) return false;
    return format(dueDate, "yyyy-MM-dd") === format(date, "yyyy-MM-dd");
  };

  const handleDateChange = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === "ios");
    if (selectedDate) {
      setDueDate(endOfDay(selectedDate));
    }
  };

  return (
    <>
      <Modal
        visible={modalVisible && !showSchedulingModal}
        animationType="none"
        transparent
        onRequestClose={() => animateDismiss()}
      >
        <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => animateDismiss()} />
        </Animated.View>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardView}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.sheet, { backgroundColor: appColors.surface, transform: [{ translateY: sheetTranslateY }] }]}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              {/* Handle bar */}
              <View style={[styles.handleBar, { backgroundColor: appColors.border }]} />

              {/* Expand button */}
              <Pressable style={[styles.expandButton, { backgroundColor: appColors.chipBg }]} onPress={handleExpand}>
                <MaterialCommunityIcons name="arrow-expand" size={18} color={appColors.textTertiary} />
              </Pressable>

              {/* Title input */}
              <TextInput
                ref={inputRef}
                placeholder="What needs to be done?"
                placeholderTextColor={appColors.textTertiary}
                value={title}
                onChangeText={setTitle}
                style={[styles.titleInput, { color: appColors.textPrimary }]}
                cursorColor={appColors.primary}
                multiline
                blurOnSubmit
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (title.trim()) handleCreate();
                }}
              />

              {/* Description — hidden until tapped */}
              {showDescription ? (
                <TextInput
                  placeholder="Add a note..."
                  placeholderTextColor={appColors.textTertiary}
                  value={description}
                  onChangeText={setDescription}
                  style={[styles.descriptionInput, { color: appColors.textPrimary }]}
                  cursorColor={appColors.primary}
                  multiline
                  numberOfLines={2}
                  autoFocus
                />
              ) : (
                <Pressable onPress={() => setShowDescription(true)} style={styles.descriptionToggle}>
                  <MaterialCommunityIcons name="plus" size={13} color={appColors.textTertiary} />
                  <Text style={[styles.descriptionToggleText, { color: appColors.textTertiary }]}>Add description</Text>
                </Pressable>
              )}

              {/* Divider */}
              <View style={[styles.divider, { backgroundColor: appColors.chipBg }]} />

              {/* Scheduling method toggle — prominent, always visible */}
              <View style={[styles.methodToggle, { backgroundColor: appColors.chipBg }]}>
                <Pressable
                  style={[
                    styles.methodOption,
                    schedulingMethod === "MANUAL" && { backgroundColor: appColors.primaryLight },
                  ]}
                  onPress={() => setSchedulingMethod("MANUAL")}
                >
                  <MaterialCommunityIcons
                    name="clock-outline"
                    size={14}
                    color={schedulingMethod === "MANUAL" ? appColors.primary : appColors.textTertiary}
                  />
                  <Text style={[
                    styles.methodText,
                    { color: schedulingMethod === "MANUAL" ? appColors.primary : appColors.textSecondary },
                    schedulingMethod === "MANUAL" && { fontWeight: "700" },
                  ]}>
                    Pick a time
                  </Text>
                </Pressable>

                <View style={[styles.methodDivider, { backgroundColor: appColors.border }]} />

                <Pressable
                  style={[
                    styles.methodOption,
                    schedulingMethod === "SMART" && canUseSmartScheduling && {
                      backgroundColor: appColors.aiPurpleLight,
                    },
                    !canUseSmartScheduling && { opacity: 0.5 },
                  ]}
                  onPress={() => {
                    if (canUseSmartScheduling) {
                      setSchedulingMethod("SMART");
                    } else {
                      onDismiss();
                      router.push("/paywall");
                    }
                  }}
                >
                  <MaterialCommunityIcons
                    name="star-four-points"
                    size={14}
                    color={schedulingMethod === "SMART" && canUseSmartScheduling ? appColors.aiPurple : appColors.textTertiary}
                  />
                  <Text style={[
                    styles.methodText,
                    { color: schedulingMethod === "SMART" && canUseSmartScheduling ? appColors.aiPurple : appColors.textSecondary },
                    schedulingMethod === "SMART" && canUseSmartScheduling && { fontWeight: "700" },
                  ]}>
                    AI Schedule
                  </Text>
                  {!canUseSmartScheduling && (
                    <MaterialCommunityIcons name="lock" size={11} color={appColors.textTertiary} />
                  )}
                </Pressable>
              </View>

              {/* Chip row — duration scroll + priority cycle button */}
              <View style={styles.chipRow}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRowContent}
                  keyboardShouldPersistTaps="always"
                >
                  {durationOptions.map((opt) => (
                    <Pressable
                      key={opt.value}
                      style={[
                        styles.chip,
                        { backgroundColor: appColors.chipBg },
                        duration === opt.value && { backgroundColor: appColors.primaryLight, borderColor: appColors.primary },
                      ]}
                      onPress={() => {
                        setDuration(opt.value);
                        if (opt.value === "custom") setShowCustomDurationModal(true);
                      }}
                    >
                      {opt.value === "custom" ? (
                        duration === "custom" ? (
                          <Text style={[styles.chipText, { color: appColors.primary }]}>{customDuration}m</Text>
                        ) : (
                          <MaterialCommunityIcons name="pencil-outline" size={14} color={appColors.textSecondary} />
                        )
                      ) : (
                        <Text style={[styles.chipText, { color: appColors.textSecondary }, duration === opt.value && { color: appColors.primary }]}>
                          {opt.label}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </ScrollView>

                <View style={[styles.chipDivider, { backgroundColor: appColors.border }]} />

                {/* Priority cycle button — tap to cycle Low → Med → High */}
                <Pressable
                  style={[styles.priorityButton, { backgroundColor: `${priorityColor}18`, borderColor: priorityColor }]}
                  onPress={() => {
                    const order: Priority[] = ["low", "medium", "high"];
                    setPriority(order[(order.indexOf(priority) + 1) % order.length]);
                  }}
                >
                  <MaterialCommunityIcons name="flag" size={13} color={priorityColor} />
                  <Text style={[styles.priorityButtonText, { color: priorityColor }]}>
                    {priority === "low" ? "Low" : priority === "medium" ? "Med" : "High"}
                  </Text>
                </Pressable>
              </View>

              {/* Due date row — only shown for AI scheduling */}
              {schedulingMethod === "SMART" && (
                <>
                  <View style={styles.dueDateRow}>
                    <MaterialCommunityIcons name="calendar-clock" size={16} color={appColors.textTertiary} style={styles.dueDateIcon} />
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.dueDateChipsContent}
                      keyboardShouldPersistTaps="always"
                    >
                      {quickDueDates.map((item) => (
                        <Pressable
                          key={item.label}
                          style={[styles.dueDateChip, { backgroundColor: appColors.chipBg }, isDueDateSelected(item.date) && { backgroundColor: appColors.primaryLight }]}
                          onPress={() => setDueDate(item.date)}
                        >
                          <Text style={[styles.dueDateChipText, { color: appColors.textTertiary }, isDueDateSelected(item.date) && { color: appColors.primary }]}>
                            {item.label}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        style={[
                          styles.dueDateChip,
                          { backgroundColor: appColors.chipBg },
                          dueDate && !quickDueDates.some((d) => isDueDateSelected(d.date)) && { backgroundColor: appColors.primaryLight },
                        ]}
                        onPress={() => setShowDatePicker(true)}
                      >
                        <MaterialCommunityIcons name="calendar" size={14} color={
                          dueDate && !quickDueDates.some((d) => isDueDateSelected(d.date))
                            ? appColors.primary
                            : appColors.textTertiary
                        } />
                        <Text style={[
                          styles.dueDateChipText,
                          { color: appColors.textTertiary },
                          dueDate && !quickDueDates.some((d) => isDueDateSelected(d.date)) && { color: appColors.primary },
                        ]}>
                          {dueDate && !quickDueDates.some((d) => isDueDateSelected(d.date))
                            ? format(dueDate, "MMM d")
                            : "Pick"}
                        </Text>
                      </Pressable>
                    </ScrollView>
                  </View>
                  {showDatePicker && (
                    <DateTimePicker
                      value={dueDate || new Date()}
                      mode="date"
                      minimumDate={new Date()}
                      onChange={handleDateChange}
                    />
                  )}
                </>
              )}

              {/* Error */}
              {error && (
                <View style={styles.errorRow}>
                  <MaterialCommunityIcons name="alert-circle" size={14} color={appColors.error} />
                  <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>
                </View>
              )}

              {/* Create button */}
              <Pressable
                style={[
                  styles.createButton,
                  { backgroundColor: appColors.primary },
                  (!title.trim() || (schedulingMethod === "SMART" && !dueDate) || loading) && { backgroundColor: appColors.border },
                ]}
                onPress={handleCreate}
                disabled={!title.trim() || (schedulingMethod === "SMART" && !dueDate) || loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.createButtonText}>Create Task</Text>
                )}
              </Pressable>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Custom duration modal */}
      <Modal visible={showCustomDurationModal} transparent animationType="fade" onRequestClose={() => setShowCustomDurationModal(false)}>
        <Pressable style={styles.customDurationOverlay} onPress={() => setShowCustomDurationModal(false)}>
          <Pressable style={[styles.customDurationCard, { backgroundColor: appColors.surface }]} onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.customDurationTitle, { color: appColors.textPrimary }]}>Custom duration</Text>
            <View style={[styles.customDurationInputRow, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]}>
              <TextInput
                value={customDuration}
                onChangeText={(v) => setCustomDuration(v.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                maxLength={3}
                style={[styles.customDurationTextInput, { color: appColors.textPrimary }]}
                autoFocus
                selectTextOnFocus
              />
              <Text style={[styles.customDurationUnitLabel, { color: appColors.textSecondary }]}>min</Text>
            </View>
            <Pressable
              style={[styles.customDurationConfirm, { backgroundColor: appColors.primary }]}
              onPress={() => setShowCustomDurationModal(false)}
            >
              <Text style={styles.customDurationConfirmText}>Done</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Scheduling Modal */}
      <SchedulingModal
        visible={showSchedulingModal}
        onClose={handleCloseSchedulingModal}
        onSelectSlot={handleSelectSlot}
        task={createdTask}
        slots={schedulingSlots}
        isLoading={schedulingLoading}
        error={schedulingError}
        schedulingMethod={schedulingMethod}
        busySlots={busySlots}
        preselectedDate={preselectedDate}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  keyboardView: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
    // Large soft shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 16,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  expandButton: {
    position: "absolute",
    top: 12,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  titleInput: {
    fontSize: 22,
    fontWeight: "500",
    paddingVertical: 8,
    paddingHorizontal: 0,
  },
  descriptionToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    marginBottom: 6,
  },
  descriptionToggleText: {
    fontSize: 13,
  },
  descriptionInput: {
    fontSize: 14,
    paddingVertical: 6,
    paddingHorizontal: 0,
    marginBottom: 6,
    maxHeight: 72,
  },
  divider: {
    height: 1,
    marginHorizontal: -4,
    marginTop: 8,
    marginBottom: 16,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  chipRowContent: {
    gap: 8,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  chipDivider: {
    width: 1,
    height: 22,
  },
  customDurationOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  customDurationCard: {
    width: 220,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 14,
  },
  customDurationTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  customDurationInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  customDurationTextInput: {
    fontSize: 24,
    fontWeight: "700",
    width: 56,
    textAlign: "center",
    padding: 0,
  },
  customDurationUnitLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  customDurationConfirm: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  customDurationConfirmText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  priorityButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  priorityButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  methodToggle: {
    flexDirection: "row",
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 14,
  },
  methodOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
  },
  methodText: {
    fontSize: 13,
    fontWeight: "600",
  },
  methodDivider: {
    width: 1,
    marginVertical: 8,
  },
  dueDateRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  dueDateIcon: {
    marginRight: 8,
  },
  dueDateChipsContent: {
    gap: 6,
    alignItems: "center",
  },
  dueDateChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  dueDateChipText: {
    fontSize: 12,
    fontWeight: "500",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
  },
  createButton: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  createButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
