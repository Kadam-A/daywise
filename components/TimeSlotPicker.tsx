/**
 * TimeSlotPicker - Manual time slot selection
 *
 * Shows a full 24-hour day (12AM–11PM) with available/busy time slots.
 * User can pick any available slot for their task.
 */

import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ScrollView as ScrollViewType,
} from "react-native";
import { Text, Button } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { addMonths, subMonths, format, startOfMonth, isBefore, startOfDay } from "date-fns";
import { Task, TimeSlot } from "../lib/types";
import { useAppColors } from "@/contexts/ThemeContext";
import CalendarMonthView from "@/components/CalendarMonthView";
import {
  formatHour,
  formatTimeRange,
  generateHourSlots,
  HourSlot,
} from "@/lib/timeslot-utils";

interface BusySlot {
  start: string;
  end: string;
  title: string;
}

interface TimeSlotPickerProps {
  task: Task | null;
  busySlots: BusySlot[];
  onSelectSlot: (slot: TimeSlot) => void;
  preselectedDate?: Date;
}

interface DayOption {
  date: Date;
  label: string;
  shortLabel: string;
}

const SLOT_HEIGHT = 58;

export default function TimeSlotPicker({
  task,
  busySlots,
  onSelectSlot,
  preselectedDate,
}: TimeSlotPickerProps) {
  const appColors = useAppColors();
  const [selectedDate, setSelectedDate] = useState<Date>(preselectedDate ?? new Date());
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number>(0);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showMonthView, setShowMonthView] = useState(false);
  const [monthViewDate, setMonthViewDate] = useState<Date>(startOfMonth(new Date()));
  const timeScrollRef = useRef<ScrollViewType>(null);
  const dateScrollRef = useRef<ScrollViewType>(null);

  // Generate next 7 days
  const dayOptions: DayOption[] = useMemo(() => {
    const days: DayOption[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);

      const isToday = i === 0;
      const isTomorrow = i === 1;

      days.push({
        date,
        label: isToday
          ? "Today"
          : isTomorrow
          ? "Tomorrow"
          : date.toLocaleDateString("en-US", { weekday: "long" }),
        shortLabel: date.toLocaleDateString("en-US", { weekday: "short" }),
      });
    }

    return days;
  }, []);

  // Generate hour slots for selected day — full 24 hours (12AM through 11PM)
  const hourSlots: HourSlot[] = useMemo(() => {
    const taskDuration = task?.duration_minutes || 60;
    return generateHourSlots(selectedDate, busySlots, taskDuration);
  }, [selectedDate, busySlots, task?.duration_minutes]);

  // Auto-scroll date carousel to selected date
  useEffect(() => {
    const idx = dayOptions.findIndex(
      (d) => d.date.toDateString() === selectedDate.toDateString()
    );
    if (idx > 0 && dateScrollRef.current) {
      const CHIP_WIDTH = 76; // minWidth 60 + padding
      const GAP = 8;
      const x = Math.max(0, idx * (CHIP_WIDTH + GAP) - CHIP_WIDTH);
      setTimeout(() => dateScrollRef.current?.scrollTo({ x, animated: true }), 100);
    }
  }, []);

  // Auto-scroll to first available slot
  useEffect(() => {
    const firstAvailableIndex = hourSlots.findIndex(
      (slot) => slot.status === "available"
    );

    if (firstAvailableIndex > 0 && timeScrollRef.current) {
      setTimeout(() => {
        timeScrollRef.current?.scrollTo({
          y: firstAvailableIndex * SLOT_HEIGHT,
          animated: true,
        });
      }, 100);
    }
  }, [hourSlots]);

  const handleSelectSlot = () => {
    if (selectedHour === null || !task) return;

    const start = new Date(selectedDate);
    start.setHours(selectedHour, selectedMinute, 0, 0);

    // If the selected time is in the past (e.g. picked 10:00 at 10:30), clamp to now
    const now = new Date();
    if (start < now) {
      start.setTime(now.getTime());
    }

    const end = new Date(start.getTime() + task.duration_minutes * 60_000);

    const slot: TimeSlot = {
      start: start.toISOString(),
      end: end.toISOString(),
      score: 70,
      reason: "Manually selected time",
    };

    onSelectSlot(slot);
  };

  const handleDatePickerChange = (event: any, date?: Date) => {
    setShowDatePicker(false);
    if (date) {
      setSelectedDate(date);
      setSelectedHour(null);
      setSelectedMinute(0);
    }
  };

  // Check if selected date is in the quick options
  const isCustomDate = !dayOptions.some(
    (day) => day.date.toDateString() === selectedDate.toDateString()
  );

  const formatCustomDate = (date: Date): string =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const buttonLabel =
    selectedHour !== null && task
      ? `Schedule at ${formatTimeRange(selectedHour, selectedDate, task.duration_minutes, selectedMinute)}`
      : "Select a time slot";

  return (
    <View style={styles.container}>
      {/* Date Selection */}
      <View style={styles.dateSectionHeader}>
        <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>Select Date</Text>
        <Pressable
          onPress={() => setShowMonthView((v) => !v)}
          style={[styles.monthViewToggle, { backgroundColor: showMonthView ? appColors.primaryLight : appColors.chipBg }]}
        >
          <MaterialCommunityIcons
            name={showMonthView ? "view-list" : "calendar-month-outline"}
            size={16}
            color={showMonthView ? appColors.primary : appColors.textTertiary}
          />
        </Pressable>
      </View>

      {showMonthView ? (
        <ScrollView style={styles.monthViewContainer} showsVerticalScrollIndicator={false}>
          {/* Month navigation */}
          <View style={styles.monthNav}>
            <Pressable
              onPress={() => setMonthViewDate((d) => subMonths(d, 1))}
              disabled={isBefore(subMonths(monthViewDate, 1), startOfMonth(new Date()))}
              style={({ pressed }) => [styles.monthNavBtn, pressed && { opacity: 0.6 }]}
            >
              <MaterialCommunityIcons
                name="chevron-left"
                size={22}
                color={isBefore(subMonths(monthViewDate, 1), startOfMonth(new Date())) ? appColors.textTertiary : appColors.textPrimary}
              />
            </Pressable>
            <Text style={[styles.monthNavLabel, { color: appColors.textPrimary }]}>
              {format(monthViewDate, "MMMM yyyy")}
            </Text>
            <Pressable
              onPress={() => setMonthViewDate((d) => addMonths(d, 1))}
              style={({ pressed }) => [styles.monthNavBtn, pressed && { opacity: 0.6 }]}
            >
              <MaterialCommunityIcons name="chevron-right" size={22} color={appColors.textPrimary} />
            </Pressable>
          </View>
          <CalendarMonthView
            month={monthViewDate}
            tasks={busySlots.map((b) => ({ scheduled_start: b.start } as Task))}
            selectedDate={selectedDate}
            onSelectDate={(date) => {
              if (isBefore(startOfDay(date), startOfDay(new Date()))) return;
              setSelectedDate(date);
              setSelectedHour(null);
            }}
          />
        </ScrollView>
      ) : (
        <>
          <ScrollView
            ref={dateScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dateScroll}
            contentContainerStyle={styles.dateScrollContent}
          >
            {dayOptions.map((day, index) => {
              const isSelected = selectedDate.toDateString() === day.date.toDateString();
              return (
                <Pressable
                  key={index}
                  onPress={() => { setSelectedDate(day.date); setSelectedHour(null); }}
                  style={[
                    styles.dateChip,
                    { backgroundColor: appColors.chipBg },
                    isSelected && { backgroundColor: appColors.primary },
                  ]}
                >
                  <Text style={[styles.dateChipDay, { color: appColors.textSecondary }, isSelected && styles.dateChipTextSelected]}>
                    {day.shortLabel}
                  </Text>
                  <Text style={[styles.dateChipDate, { color: appColors.textPrimary }, isSelected && styles.dateChipTextSelected]}>
                    {day.date.getDate()}
                  </Text>
                </Pressable>
              );
            })}

            {isCustomDate && (
              <Pressable
                onPress={() => setShowDatePicker(true)}
                style={[styles.dateChip, { backgroundColor: appColors.primary }]}
              >
                <Text style={[styles.dateChipDay, styles.dateChipTextSelected]}>
                  {selectedDate.toLocaleDateString("en-US", { weekday: "short" })}
                </Text>
                <Text style={[styles.dateChipDate, styles.dateChipTextSelected]}>
                  {formatCustomDate(selectedDate)}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => setShowDatePicker(true)}
              style={[styles.dateChip, styles.moreChip, { backgroundColor: appColors.chipBg }]}
            >
              <MaterialCommunityIcons name="calendar" size={20} color={appColors.textTertiary} />
              <Text style={[styles.moreChipText, { color: appColors.textTertiary }]}>More</Text>
            </Pressable>
          </ScrollView>

          {showDatePicker && (
            <DateTimePicker
              value={selectedDate}
              mode="date"
              minimumDate={new Date()}
              onChange={handleDatePickerChange}
            />
          )}
        </>
      )}

      {/* Time Selection — hidden while month picker is open */}
      {!showMonthView && <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>Select Time</Text>}
      {!showMonthView && <Text style={[styles.durationHint, { color: appColors.textSecondary }]}>
        Task duration: {task?.duration_minutes || 60} min
      </Text>}

      {!showMonthView && <ScrollView
        ref={timeScrollRef}
        style={[styles.timeScroll, { backgroundColor: appColors.surface }]}
        contentContainerStyle={[styles.timeScrollContent, { backgroundColor: appColors.surface }]}
        showsVerticalScrollIndicator={true}
      >
        {hourSlots.map((slot) => {
          const isSelected = selectedHour === slot.hour;
          const isDisabled = slot.status === "busy";

          return (
            <Pressable
              key={slot.hour}
              onPress={() => {
                if (isDisabled) return;
                const now = new Date();
                const firstValidMinute = [0, 15, 30, 45].find((m) => {
                  const t = new Date(selectedDate);
                  t.setHours(slot.hour, m, 0, 0);
                  return t >= now && !slot.busyMinutes.includes(m);
                }) ?? 0;
                setSelectedHour(slot.hour);
                setSelectedMinute(firstValidMinute);
              }}
              disabled={isDisabled}
              style={[
                styles.timeSlot,
                { backgroundColor: appColors.inputBg },
                isSelected && [styles.timeSlotSelected, { borderColor: appColors.primary, backgroundColor: appColors.primaryLight }],
                isDisabled && styles.timeSlotDisabled,
              ]}
            >
              <View style={styles.timeSlotLeft}>
                <View
                  style={[
                    styles.statusDot,
                    slot.status === "available"
                      ? { backgroundColor: appColors.success }
                      : { backgroundColor: appColors.error },
                  ]}
                />
                <View>
                  <Text
                    style={[
                      styles.timeSlotText,
                      { color: appColors.textPrimary },
                      isSelected && { color: appColors.primary, fontWeight: "600" },
                      isDisabled && { color: appColors.textTertiary },
                    ]}
                  >
                    {slot.label}
                  </Text>
                  {/* Conflicts — show each task name + time range within this hour */}
                  {!isSelected && slot.partialConflicts.map((c, i) => {
                    const fmtMin = (min: number) => min === 0 ? "00" : String(min).padStart(2, "0");
                    const startH = slot.hour;
                    const endH = c.endMin === 60 ? slot.hour + 1 : slot.hour;
                    const endMin = c.endMin === 60 ? 0 : c.endMin;
                    const fmt12 = (h: number, m: number) => {
                      const p = h >= 12 ? "pm" : "am";
                      const d = h > 12 ? h - 12 : h === 0 ? 12 : h;
                      return `${d}:${fmtMin(m)}${p}`;
                    };
                    return (
                      <Text key={i} style={[styles.partialConflictText, { color: appColors.error }]} numberOfLines={1}>
                        {fmt12(startH, c.startMin)}–{fmt12(endH, endMin)} · {c.title}
                      </Text>
                    );
                  })}
                  {/* Runs past midnight warning */}
                  {slot.bleeds && slot.status === "available" && (
                    <Text style={[styles.bleedsNote, { color: appColors.warning }]}>
                      Runs past midnight
                    </Text>
                  )}
                  {/* Minute chips — shown only on selected slot */}
                  {isSelected && (
                    <View style={styles.minuteRow}>
                      {[0, 15, 30, 45].map((m) => {
                        const candidateTime = new Date(selectedDate);
                        candidateTime.setHours(slot.hour, m, 0, 0);
                        const isMinutePast = candidateTime < new Date();
                        const isMinuteBusy = slot.busyMinutes.includes(m);
                        const isMinuteDisabled = isMinutePast || isMinuteBusy;
                        return (
                          <Pressable
                            key={m}
                            onPress={(e) => { e.stopPropagation?.(); if (!isMinuteDisabled) setSelectedMinute(m); }}
                            disabled={isMinuteDisabled}
                            style={[
                              styles.minuteChip,
                              { backgroundColor: appColors.surface },
                              selectedMinute === m && { backgroundColor: appColors.primary },
                              isMinuteDisabled && { opacity: 0.3 },
                            ]}
                          >
                            <Text style={[
                              styles.minuteChipText,
                              { color: appColors.textSecondary },
                              selectedMinute === m && { color: "#fff", fontWeight: "600" },
                            ]}>
                              :{String(m).padStart(2, "0")}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
              {slot.status === "available" && slot.partialConflicts.length === 0 && (
                <Text style={[styles.statusText, { color: appColors.success }]}>Free</Text>
              )}
              {slot.status === "busy" && slot.busyReason === "Past" && (
                <Text style={[styles.statusText, { color: appColors.textTertiary }]}>Past</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>}

      {/* Footer */}
      <View style={[styles.footer, { backgroundColor: appColors.surface, borderTopColor: appColors.border }]}>
        {showMonthView ? (
          <Pressable
            style={[styles.monthConfirmBtn, { backgroundColor: appColors.primary }]}
            onPress={() => setShowMonthView(false)}
          >
            <Text style={styles.monthConfirmText}>
              View times for {format(selectedDate, "EEE, d MMM")}
            </Text>
            <MaterialCommunityIcons name="arrow-right" size={16} color="#fff" />
          </Pressable>
        ) : (
          <Button
            mode="contained"
            onPress={handleSelectSlot}
            disabled={selectedHour === null}
            style={styles.confirmButton}
          >
            {buttonLabel}
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  dateSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    flexShrink: 0,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  monthViewToggle: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  monthViewContainer: {
    flex: 1,
  },
  monthConfirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    width: "100%",
  },
  monthConfirmText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  monthNavBtn: {
    padding: 4,
  },
  monthNavLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  dateScroll: {
    marginBottom: 16,
    flexGrow: 0,
    flexShrink: 0,
  },
  dateScrollContent: {
    gap: 8,
  },
  dateChip: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    minWidth: 60,
  },
  dateChipDay: {
    fontSize: 12,
    marginBottom: 4,
  },
  dateChipDate: {
    fontSize: 18,
    fontWeight: "bold",
  },
  dateChipTextSelected: {
    color: "#fff",
  },
  moreChip: {
    justifyContent: "center",
    gap: 4,
  },
  moreChipText: {
    fontSize: 12,
  },
  durationHint: {
    fontSize: 14,
    marginBottom: 8,
    flexShrink: 0,
  },
  timeScroll: {
    flex: 1,
  },
  timeScrollContent: {
    paddingBottom: 8,
  },
  timeSlot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
  },
  timeSlotSelected: {
    borderWidth: 2,
  },
  timeSlotDisabled: {
    opacity: 0.5,
  },
  timeSlotLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  timeSlotText: {
    fontSize: 16,
    fontWeight: "500",
  },
  partialConflictText: {
    fontSize: 11,
    marginTop: 3,
    opacity: 0.8,
  },
  bleedsNote: {
    fontSize: 11,
    marginTop: 2,
  },
  minuteRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  minuteChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  minuteChipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  statusText: {
    fontSize: 14,
  },
  footer: {
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    flexShrink: 0,
  },
  confirmButton: {},
});
