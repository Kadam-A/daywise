/**
 * SchedulingModal - Shows AI recommendations or manual time picker
 *
 * For SMART scheduling:
 * - Displays top recommendation with score and reason
 * - "Show other times" reveals alternatives
 *
 * For MANUAL scheduling:
 * - Shows TimeSlotPicker component
 */

import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Text,
  Button,
  ActivityIndicator,
  Surface,
  ProgressBar,
  IconButton,
} from "react-native-paper";
import { TimeSlot, Task, SchedulingFactor } from "../lib/types";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import TimeSlotPicker from "./TimeSlotPicker";
import { useAppColors } from "@/contexts/ThemeContext";
import { useGuidedTour } from "@/contexts/GuidedTourContext";
import TourTooltip from "@/components/TourTooltip";
import { addDays, endOfDay, format } from "date-fns";
import DateTimePicker from "@react-native-community/datetimepicker";

interface SchedulingModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectSlot: (slot: TimeSlot) => void;
  task: Task | null;
  slots: TimeSlot[];
  isLoading: boolean;
  error: string | null;
  schedulingMethod: "SMART" | "MANUAL" | null;
  busySlots?: { start: string; end: string; title: string }[];
  onMethodChosen?: (method: "SMART" | "MANUAL") => void;
  preselectedDate?: Date;
  isPro?: boolean;
  onPaywall?: () => void;
}

export default function SchedulingModal({
  visible,
  onClose,
  onSelectSlot,
  task,
  slots,
  isLoading,
  error,
  schedulingMethod,
  busySlots = [],
  onMethodChosen,
  preselectedDate,
  isPro = false,
  onPaywall,
}: SchedulingModalProps) {
  const appColors = useAppColors();
  const insets = useSafeAreaInsets();
  const { tourStep, advanceTour, skipTour: _skipTour } = useGuidedTour();
  const skipTour = useCallback(() => _skipTour(tourStep), [_skipTour, tourStep]);
  const [showAlternatives, setShowAlternatives] = useState(false);
  // Local dismissed flags so tooltip hides without advancing tour step
  const [aiTooltipDismissed, setAiTooltipDismissed] = useState(false);
  const [manualTooltipDismissed, setManualTooltipDismissed] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);

  // Due date picker for tasks without one (shown before AI scheduling)
  const [needsDueDate, setNeedsDueDate] = useState(false);
  const [tempDueDate, setTempDueDate] = useState<Date>(endOfDay(addDays(new Date(), 1)));
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Reset dismissed flags whenever slots reload (new scheduling session)
  React.useEffect(() => {
    setAiTooltipDismissed(false);
  }, [slots.length]);

  React.useEffect(() => {
    setManualTooltipDismissed(false);
  }, [visible]);

  // Auto-select top slot when alternatives list opens
  React.useEffect(() => {
    if (showAlternatives && slots.length > 0) {
      setSelectedSlot(slots[0]);
    }
  }, [showAlternatives]);

  const topSlot = slots[0];
  const alternativeSlots = slots.slice(1);

  const handleConfirm = () => {
    if (selectedSlot) {
      onSelectSlot(selectedSlot);
    } else if (topSlot) {
      onSelectSlot(topSlot);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const formatTimeRange = (start: string, end: string) => {
    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Surface style={[styles.modal, { backgroundColor: appColors.surface }]} elevation={5}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: appColors.border }]}>
            <Text variant="titleLarge" style={[styles.title, { color: appColors.textPrimary }]}>
              {schedulingMethod === null
                ? "Schedule Task"
                : schedulingMethod === "SMART"
                ? "I Found Your Best Time"
                : "Select a Time"}
            </Text>
            <IconButton icon="close" size={24} onPress={onClose} iconColor={appColors.textSecondary} style={{ margin: 0 }} />
          </View>

          {/* Due Date Picker (shown for overdue / no due date tasks before AI scheduling) */}
          {needsDueDate && !isLoading && (
            <View style={styles.dueDateContainer}>
              {/* Icon + title */}
              <View style={[styles.dueDateIconCircle, { backgroundColor: `${appColors.primary}15` }]}>
                <MaterialCommunityIcons name="calendar-clock" size={32} color={appColors.primary} />
              </View>
              <Text style={[styles.dueDateTitle, { color: appColors.textPrimary }]}>
                Set a new deadline
              </Text>
              <Text style={[styles.dueDateSubtitle, { color: appColors.textSecondary }]}>
                AI needs a deadline to find the best time
              </Text>

              {/* Selected date display */}
              <Pressable
                style={[styles.dueDateDisplay, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]}
                onPress={() => setShowDatePicker(true)}
              >
                <MaterialCommunityIcons name="calendar" size={20} color={appColors.primary} />
                <Text style={[styles.dueDateDisplayText, { color: appColors.textPrimary }]}>
                  {format(tempDueDate, "EEEE, MMM d")}
                </Text>
                <MaterialCommunityIcons name="pencil-outline" size={16} color={appColors.textTertiary} />
              </Pressable>

              {showDatePicker && (
                <DateTimePicker
                  value={tempDueDate}
                  mode="date"
                  minimumDate={new Date()}
                  onChange={(_event: any, date?: Date) => {
                    setShowDatePicker(Platform.OS === "ios");
                    if (date) setTempDueDate(endOfDay(date));
                  }}
                />
              )}

              {/* Quick options */}
              <View style={styles.dueDateQuickRow}>
                {[
                  { label: "Today", date: endOfDay(new Date()), icon: "weather-sunny" as const },
                  { label: "Tomorrow", date: endOfDay(addDays(new Date(), 1)), icon: "weather-partly-cloudy" as const },
                  { label: "In 3 days", date: endOfDay(addDays(new Date(), 3)), icon: "calendar-range" as const },
                  { label: "This week", date: endOfDay(addDays(new Date(), 7)), icon: "calendar-week" as const },
                ].map((opt) => {
                  const isSelected = format(tempDueDate, "yyyy-MM-dd") === format(opt.date, "yyyy-MM-dd");
                  return (
                    <Pressable
                      key={opt.label}
                      style={[
                        styles.dueDateOption,
                        { borderColor: appColors.border },
                        isSelected && { borderColor: appColors.primary, backgroundColor: `${appColors.primary}10` },
                      ]}
                      onPress={() => setTempDueDate(opt.date)}
                    >
                      <MaterialCommunityIcons
                        name={opt.icon}
                        size={18}
                        color={isSelected ? appColors.primary : appColors.textTertiary}
                      />
                      <Text style={[
                        styles.dueDateOptionText,
                        { color: appColors.textSecondary },
                        isSelected && { color: appColors.primary, fontWeight: "700" },
                      ]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* CTA */}
              <Pressable
                style={[styles.dueDateConfirmBtn, { backgroundColor: appColors.primary }]}
                onPress={() => {
                  setNeedsDueDate(false);
                  if (task) {
                    task.due_date = tempDueDate.toISOString();
                  }
                  onMethodChosen?.("SMART");
                }}
              >
                <MaterialCommunityIcons name="brain" size={20} color="#FFFFFF" />
                <Text style={styles.dueDateConfirmText}>Find Best Time</Text>
              </Pressable>
            </View>
          )}

          {/* Method Choice UI */}
          {schedulingMethod === null && !needsDueDate && !isLoading && (
            <View style={styles.methodChoiceContainer}>
              <Text style={[styles.methodChoiceSubtitle, { color: appColors.textSecondary }]}>
                How would you like to schedule?
              </Text>

              <Pressable
                style={[
                  styles.methodCard,
                  isPro
                    ? { backgroundColor: `${appColors.primary}10` }
                    : { backgroundColor: appColors.inputBg, opacity: 0.8 },
                ]}
                onPress={() => {
                  if (!isPro) { onPaywall?.(); return; }
                  // Overdue or no due date — always ask for a new deadline
                  if (task && (!task.due_date || new Date(task.due_date) < new Date())) {
                    setTempDueDate(endOfDay(addDays(new Date(), 1)));
                    setNeedsDueDate(true);
                    return;
                  }
                  onMethodChosen?.("SMART");
                }}
              >
                <View style={[styles.methodCardIcon, { backgroundColor: isPro ? `${appColors.primary}20` : appColors.chipBg }]}>
                  <MaterialCommunityIcons name="brain" size={28} color={isPro ? appColors.primary : appColors.textTertiary} />
                </View>
                <View style={styles.methodCardContent}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[styles.methodCardTitle, { color: isPro ? appColors.textPrimary : appColors.textSecondary }]}>AI Smart Schedule</Text>
                    {!isPro && (
                      <View style={[styles.proBadge, { backgroundColor: appColors.aiPurple ?? "#7C6FBF" }]}>
                        <MaterialCommunityIcons name="crown" size={10} color="#fff" />
                        <Text style={styles.proBadgeText}>Pro</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.methodCardDesc, { color: appColors.textSecondary }]}>
                    {isPro ? "Find the best time based on your habits and calendar" : "Upgrade to Pro to use AI scheduling"}
                  </Text>
                </View>
                {isPro
                  ? <MaterialCommunityIcons name="chevron-right" size={24} color={appColors.textTertiary} />
                  : <MaterialCommunityIcons name="lock-outline" size={20} color={appColors.textTertiary} />
                }
              </Pressable>

              <Pressable
                style={[styles.methodCard, { backgroundColor: appColors.inputBg }]}
                onPress={() => onMethodChosen?.("MANUAL")}
              >
                <View style={[styles.methodCardIcon, { backgroundColor: appColors.chipBg }]}>
                  <MaterialCommunityIcons name="calendar-cursor" size={28} color={appColors.textSecondary} />
                </View>
                <View style={styles.methodCardContent}>
                  <Text style={[styles.methodCardTitle, { color: appColors.textPrimary }]}>Pick a Time</Text>
                  <Text style={[styles.methodCardDesc, { color: appColors.textSecondary }]}>
                    Choose a specific date and time yourself
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={appColors.textTertiary} />
              </Pressable>
            </View>
          )}

          {/* Loading State */}
          {isLoading && (
            <View style={[styles.content, styles.loadingContainer]}>
              <ActivityIndicator size="large" color={appColors.primary} />
              <Text style={[styles.loadingText, { color: appColors.textSecondary }]}>
                {schedulingMethod === "SMART"
                  ? "Finding your perfect time..."
                  : "Checking your schedule..."}
              </Text>
            </View>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <View style={[styles.content, styles.errorContainer]}>
              <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>
              <Button mode="outlined" onPress={onClose} style={styles.errorButton}>
                Try Again
              </Button>
            </View>
          )}

          {/* MANUAL Scheduling UI - NOT in ScrollView since TimeSlotPicker has its own */}
          {schedulingMethod === "MANUAL" && !isLoading && !error && (
            <View style={[styles.manualContent, { paddingBottom: insets.bottom + 16 }]}>
              <TimeSlotPicker
                task={task}
                busySlots={busySlots}
                onSelectSlot={onSelectSlot}
                preselectedDate={preselectedDate}
              />
            </View>
          )}

          {/* SMART Scheduling UI - uses ScrollView for alternatives list */}
          {schedulingMethod === "SMART" && !isLoading && !error && (
            <ScrollView
              style={styles.content}
              contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
              showsVerticalScrollIndicator={false}
            >
              {topSlot ? (
                <>
                {/* Top Recommendation */}
                {!showAlternatives && (
                  <View style={styles.topRecommendation}>
                    <Text style={[styles.dateText, { color: appColors.textSecondary }]}>{formatDate(topSlot.start)}</Text>
                    <Text style={[styles.timeText, { color: appColors.textPrimary }]}>
                      {formatTimeRange(topSlot.start, topSlot.end)}
                    </Text>

                    {/* Score Bar */}
                    <View style={styles.scoreContainer}>
                      <ProgressBar
                        progress={topSlot.score / 100}
                        color={appColors.success}
                        style={styles.scoreBar}
                      />
                      <Text style={[styles.scoreText, { color: appColors.success }]}>{topSlot.score}% match</Text>
                    </View>

                    {/* AI Reason */}
                    {topSlot.reason && (
                      <Text style={[styles.reasonText, { color: appColors.textSecondary }]}>"{topSlot.reason}"</Text>
                    )}

                    {/* Scheduling Factors - Why this time? */}
                    {topSlot.factors && topSlot.factors.length > 0 && (
                      <View style={[styles.factorsContainer, { backgroundColor: appColors.inputBg }]}>
                        <Text style={[styles.factorsTitle, { color: appColors.textPrimary }]}>Why this time works for you:</Text>
                        {topSlot.factors.map((factor, idx) => (
                          <View key={idx} style={styles.factorRow}>
                            <MaterialCommunityIcons
                              name={(factor.icon as any) || (factor.impact > 0 ? "check-circle" : "alert-circle")}
                              size={18}
                              color={factor.impact > 0 ? appColors.success : appColors.warning}
                              style={styles.factorIcon}
                            />
                            <Text style={[
                              styles.factorText,
                              { color: factor.impact > 0 ? appColors.success : appColors.warning }
                            ]}>
                              {factor.description}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Action Buttons */}
                    <View style={styles.buttonRow}>
                      <Button
                        mode="contained"
                        onPress={handleConfirm}
                        style={styles.confirmButton}
                        icon="check"
                        buttonColor={appColors.primary}
                      >
                        Perfect!
                      </Button>
                      {alternativeSlots.length > 0 && (
                        <Button
                          mode="outlined"
                          onPress={() => setShowAlternatives(true)}
                          style={styles.alternativeButton}
                          textColor={appColors.primary}
                        >
                          Show other times
                        </Button>
                      )}
                    </View>
                  </View>
                )}

                {/* Alternative Slots */}
                {showAlternatives && (
                  <View style={styles.alternativesContainer}>
                    <Button
                      mode="text"
                      onPress={() => setShowAlternatives(false)}
                      icon="arrow-left"
                      style={styles.backButton}
                      textColor={appColors.primary}
                    >
                      Back to top pick
                    </Button>

                    {slots.map((slot, index) => (
                      <Pressable
                        key={index}
                        onPress={() => setSelectedSlot(slot)}
                        style={[
                          styles.slotCard,
                          { backgroundColor: appColors.inputBg, borderColor: "transparent" },
                          selectedSlot === slot && { borderColor: appColors.primary, backgroundColor: appColors.primaryLight },
                          index === 0 && { borderColor: appColors.success, backgroundColor: appColors.successLight },
                        ]}
                      >
                        <View style={styles.slotHeader}>
                          <Text style={[styles.slotDate, { color: appColors.textSecondary }]}>{formatDate(slot.start)}</Text>
                          {index === 0 && (
                            <View style={[styles.topBadge, { backgroundColor: appColors.success }]}>
                              <Text style={[styles.topBadgeText, { color: appColors.surface }]}>Top Pick</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.slotTime, { color: appColors.textPrimary }]}>
                          {formatTimeRange(slot.start, slot.end)}
                        </Text>
                        <View style={styles.slotScoreRow}>
                          <ProgressBar
                            progress={slot.score / 100}
                            color={index === 0 ? appColors.success : appColors.primary}
                            style={styles.slotScoreBar}
                          />
                          <Text style={[styles.slotScore, { color: appColors.textSecondary }]}>{slot.score}%</Text>
                        </View>
                        {slot.reason && <Text style={[styles.slotReason, { color: appColors.textSecondary }]}>{slot.reason}</Text>}
                        {slot.factors && slot.factors.length > 0 && (
                          <View style={[styles.slotFactors, { borderTopColor: appColors.border }]}>
                            {slot.factors.slice(0, 2).map((factor, fidx) => (
                              <View key={fidx} style={styles.slotFactorRow}>
                                <MaterialCommunityIcons
                                  name={(factor.icon as any) || "circle-small"}
                                  size={14}
                                  color={factor.impact > 0 ? appColors.success : appColors.warning}
                                />
                                <Text style={[styles.slotFactorText, { color: appColors.textSecondary }]}>{factor.description}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </Pressable>
                    ))}

                    <Button
                      mode="contained"
                      onPress={handleConfirm}
                      disabled={!selectedSlot}
                      style={styles.selectButton}
                      buttonColor={appColors.primary}
                    >
                      {selectedSlot
                        ? `Schedule at ${formatTime(selectedSlot.start)}`
                        : "Select a time"}
                    </Button>
                  </View>
                )}
                </>
              ) : (
                <View style={styles.emptyContainer}>
                  <Text style={[styles.emptyTitle, { color: appColors.textPrimary }]}>No available times found</Text>
                  <Text style={[styles.emptyText, { color: appColors.textSecondary }]}>
                    Try extending your deadline or adjusting your work hours in settings.
                  </Text>
                  <Button mode="outlined" onPress={onClose} textColor={appColors.primary}>
                    Close
                  </Button>
                </View>
              )}
            </ScrollView>
          )}
        </Surface>
      </View>

      {/* Tour tooltip: AI slots loaded */}
      <TourTooltip
        visible={tourStep === "tour_scheduling_ai" && schedulingMethod === "SMART" && !isLoading && slots.length > 0 && !aiTooltipDismissed}
        icon="star-outline"
        iconColor={appColors.primary}
        title="Your best time slots"
        body="I ranked these by your focus patterns and deadline. The top slot is your energy peak. Don't like it? Tap 'Show other times' to see all options."
        ctaLabel="Got it — I'll pick one"
        onCta={() => setAiTooltipDismissed(true)}
        onSkip={() => setAiTooltipDismissed(true)}
        showSkip
        position="top"
      />

      {/* Tour tooltip: manual method choice */}
      <TourTooltip
        visible={tourStep === "tour_manual_schedule" && schedulingMethod === "MANUAL" && !isLoading && !manualTooltipDismissed}
        icon="clock-edit-outline"
        iconColor={appColors.secondary}
        title="Your day, laid out"
        body="Scroll through and you'll see your existing tasks already blocking those times. Pick any free slot for this one."
        position="top"
        ctaLabel="Got it"
        onCta={() => setManualTooltipDismissed(true)}
        onSkip={() => setManualTooltipDismissed(true)}
        showSkip
        showUpArrow
      />
    </Modal>
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
    height: "75%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  title: {
    fontWeight: "600",
    margin: 0,
  },
  content: {
    padding: 20,
  },
  manualContent: {
    flex: 1,
    paddingTop: 0,
    paddingHorizontal: 20,
    paddingBottom: 0,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 16,
  },
  errorContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  errorText: {
    textAlign: "center",
    marginBottom: 16,
  },
  errorButton: {
    marginTop: 8,
  },
  topRecommendation: {
    alignItems: "center",
    paddingVertical: 20,
  },
  dateText: {
    fontSize: 18,
    marginBottom: 4,
  },
  timeText: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 16,
  },
  scoreContainer: {
    width: "100%",
    marginBottom: 16,
  },
  scoreBar: {
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  scoreText: {
    textAlign: "right",
    fontWeight: "600",
  },
  reasonText: {
    fontSize: 16,
    fontStyle: "italic",
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  factorsContainer: {
    width: "100%",
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
  },
  factorsTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
  },
  factorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  factorIcon: {
    marginRight: 10,
    marginTop: 1,
  },
  factorText: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  buttonRow: {
    width: "100%",
    gap: 12,
    marginBottom: 24,
  },
  confirmButton: {
    marginBottom: 8,
  },
  alternativeButton: {},
  alternativesContainer: {
    paddingBottom: 40,
  },
  backButton: {
    alignSelf: "flex-start",
    marginBottom: 12,
  },
  slotCard: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
  },
  slotHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  slotDate: {
    fontSize: 14,
  },
  topBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  topBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  slotTime: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 8,
  },
  slotScoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  slotScoreBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
  slotScore: {
    fontSize: 14,
    fontWeight: "600",
    width: 40,
  },
  slotReason: {
    fontSize: 14,
    fontStyle: "italic",
  },
  slotFactors: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  slotFactorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  slotFactorText: {
    fontSize: 12,
    marginLeft: 4,
    flex: 1,
  },
  selectButton: {
    marginTop: 8,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyText: {
    textAlign: "center",
    marginBottom: 20,
  },
  // Method choice styles
  methodChoiceContainer: {
    padding: 24,
    gap: 16,
  },
  methodChoiceSubtitle: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: 4,
  },
  methodCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 18,
    borderRadius: 16,
    gap: 14,
  },
  methodCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  methodCardContent: {
    flex: 1,
  },
  methodCardTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 3,
  },
  methodCardDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  proBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  proBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
  },
  // Due date picker styles
  dueDateContainer: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  dueDateIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  dueDateTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  dueDateSubtitle: {
    fontSize: 14,
    marginBottom: 24,
  },
  dueDateDisplay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    width: "100%",
    marginBottom: 20,
  },
  dueDateDisplayText: {
    fontSize: 17,
    fontWeight: "600",
    flex: 1,
  },
  dueDateQuickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginBottom: 28,
    width: "100%",
  },
  dueDateOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  dueDateOptionText: {
    fontSize: 14,
    fontWeight: "500",
  },
  dueDateConfirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    width: "100%",
  },
  dueDateConfirmText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});
