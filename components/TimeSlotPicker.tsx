import { useAppColors } from "@/contexts/ThemeContext";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { format, isToday } from "date-fns";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  GestureResponderEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Task, TimeSlot } from "../lib/types";

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

const HOUR_HEIGHT = 72;
const START_HOUR = 7;
const END_HOUR = 22;
const HOUR_LABEL_WIDTH = 52;
const SNAP_MINUTES = 30;
const GOOGLE_BLUE = "#4285F4";
const TOTAL_HOURS = END_HOUR - START_HOUR;

function hourLabel(h: number): string {
  if (h === START_HOUR) return `${h} AM`;
  if (h === 12) return "12 PM";
  if (h === END_HOUR) return `${h - 12} PM`;
  return h < 12 ? `${h}` : `${h - 12}`;
}

function fmt12(h: number, m: number) {
  const period = h >= 12 ? "PM" : "AM";
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${display}:${String(m).padStart(2, "0")} ${period}`;
}

export default function TimeSlotPicker({
  task,
  busySlots,
  onSelectSlot,
  preselectedDate,
}: TimeSlotPickerProps) {
  const appColors = useAppColors();
  const insets = useSafeAreaInsets();
  const durationMinutes = task?.duration_minutes ?? 60;
  const scrollRef = useRef<ScrollView>(null);
  const dateScrollRef = useRef<ScrollView>(null);
  const selectionScale = useRef(new Animated.Value(0.85)).current;
  const selectionOpacity = useRef(new Animated.Value(0)).current;

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const dayOptions = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return { date: d, dayLabel: format(d, "EEE"), numLabel: format(d, "d") };
    });
  }, []);

  const [selectedDate, setSelectedDate] = useState<Date>(
    preselectedDate ?? new Date(),
  );
  const [selectedSlot, setSelectedSlot] = useState<{
    hour: number;
    minute: number;
  } | null>(null);
  const [now, setNow] = useState(new Date());

  const isCustomDate = !dayOptions.some(
    (d) => d.date.toDateString() === selectedDate.toDateString(),
  );

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Reset selection on date change
  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate.toDateString()]);

  // Scroll date strip to show the selected chip on mount
  useEffect(() => {
    const idx = dayOptions.findIndex(
      (d) => d.date.toDateString() === selectedDate.toDateString(),
    );
    const chipIdx = idx !== -1 ? idx : dayOptions.length; // custom chip sits after the 7 regular ones
    const CHIP_STEP = 48 + 7; // chip width + gap
    setTimeout(
      () =>
        dateScrollRef.current?.scrollTo({
          x: chipIdx * CHIP_STEP,
          animated: false,
        }),
      100,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll timeline to ~1 hour before current time (or 8 AM fallback)
  useEffect(() => {
    const scrollToHour = isToday(selectedDate)
      ? Math.max(START_HOUR, now.getHours() - 1)
      : 8;
    const y = (scrollToHour - START_HOUR) * HOUR_HEIGHT;
    setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 80);
  }, [selectedDate.toDateString()]);

  // Animate selection block in when slot changes
  useEffect(() => {
    if (selectedSlot) {
      selectionScale.setValue(0.88);
      selectionOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(selectionScale, {
          toValue: 1,
          damping: 20,
          stiffness: 260,
          useNativeDriver: true,
        }),
        Animated.timing(selectionOpacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [selectedSlot?.hour, selectedSlot?.minute]);

  // Current time position
  const nowPosition = useMemo(() => {
    if (!isToday(selectedDate)) return null;
    const mins = now.getHours() * 60 + now.getMinutes();
    const offset = mins - START_HOUR * 60;
    if (offset < 0 || offset > TOTAL_HOURS * 60) return null;
    return (offset / 60) * HOUR_HEIGHT;
  }, [now, selectedDate]);

  // Block position/height for any time range
  const blockGeometry = (startISO: string, endISO: string) => {
    const s = new Date(startISO);
    const e = new Date(endISO);
    const startMins = s.getHours() * 60 + s.getMinutes();
    const endMins = e.getHours() * 60 + e.getMinutes();
    const clampedStart = Math.max(startMins, START_HOUR * 60);
    const clampedEnd = Math.min(endMins, END_HOUR * 60);
    const top = ((clampedStart - START_HOUR * 60) / 60) * HOUR_HEIGHT;
    const height = Math.max(
      ((clampedEnd - clampedStart) / 60) * HOUR_HEIGHT,
      24,
    );
    return { top, height };
  };

  // Busy slots for selected day
  const dayBusy = useMemo(() => {
    return busySlots.filter((b) => {
      const d = new Date(b.start);
      return d.toDateString() === selectedDate.toDateString();
    });
  }, [busySlots, selectedDate.toDateString()]);

  // Overlap check
  const overlapsbusy = (hour: number, minute: number) => {
    const start = new Date(selectedDate);
    start.setHours(hour, minute, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    return dayBusy.some((b) => {
      const bs = new Date(b.start);
      const be = new Date(b.end);
      return start < be && end > bs;
    });
  };

  const handleTimelineTap = (e: GestureResponderEvent) => {
    const tapY = e.nativeEvent.locationY;
    const rawMins = (tapY / HOUR_HEIGHT) * 60;
    const snapped = Math.round(rawMins / SNAP_MINUTES) * SNAP_MINUTES;
    const totalMins = START_HOUR * 60 + snapped;
    const hour = Math.floor(totalMins / 60);
    const minute = totalMins % 60;

    if (hour < START_HOUR || hour >= END_HOUR) return;

    const candidate = new Date(selectedDate);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate < new Date()) return;
    if (overlapsbusy(hour, minute)) return;

    setSelectedSlot({ hour, minute });
  };

  const handleConfirm = () => {
    if (!selectedSlot) return;
    const start = new Date(selectedDate);
    start.setHours(selectedSlot.hour, selectedSlot.minute, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    onSelectSlot({
      start: start.toISOString(),
      end: end.toISOString(),
      score: 70,
      reason: "Manually selected time",
    });
  };

  const openDatePicker = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: selectedDate,
        mode: "date",
        minimumDate: new Date(),
        onChange: (_, date) => {
          if (date) setSelectedDate(date);
        },
      });
    }
  };

  // Selected slot geometry
  const selectedGeometry = selectedSlot
    ? (() => {
        const startMins = selectedSlot.hour * 60 + selectedSlot.minute;
        const top = ((startMins - START_HOUR * 60) / 60) * HOUR_HEIGHT;
        const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT, 24);
        return { top, height };
      })()
    : null;

  const endH = selectedSlot
    ? Math.floor(
        (selectedSlot.hour * 60 + selectedSlot.minute + durationMinutes) / 60,
      )
    : 0;
  const endM = selectedSlot
    ? (selectedSlot.hour * 60 + selectedSlot.minute + durationMinutes) % 60
    : 0;

  const hours = Array.from(
    { length: TOTAL_HOURS + 1 },
    (_, i) => START_HOUR + i,
  );

  return (
    <View style={styles.container}>
      {/* ── Date strip — outer View constrains height so the horizontal ScrollView can't inflate ── */}
      <View style={styles.dateStripWrapper}>
        <ScrollView
          ref={dateScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dateStripContent}
          style={styles.dateStrip}
        >
          {dayOptions.map((day, i) => {
            const isSel =
              selectedDate.toDateString() === day.date.toDateString();
            const isDayToday = isToday(day.date);
            return (
              <Pressable
                key={i}
                onPress={() => {
                  setSelectedDate(day.date);
                }}
                style={[
                  styles.dateChip,
                  {
                    backgroundColor: isSel
                      ? appColors.primary
                      : appColors.chipBg,
                  },
                  isDayToday &&
                    !isSel && {
                      borderColor: appColors.primary,
                      borderWidth: 1.5,
                    },
                ]}
              >
                <Text
                  style={[
                    styles.dateChipDay,
                    {
                      color: isSel
                        ? "rgba(255,255,255,0.75)"
                        : appColors.textTertiary,
                    },
                  ]}
                >
                  {day.dayLabel.toUpperCase()}
                </Text>
                <Text
                  style={[
                    styles.dateChipNum,
                    {
                      color: isSel
                        ? "#fff"
                        : isDayToday
                          ? appColors.primary
                          : appColors.textPrimary,
                    },
                  ]}
                >
                  {day.numLabel}
                </Text>
              </Pressable>
            );
          })}

          {/* Custom date chip when outside 7-day window */}
          {isCustomDate && (
            <Pressable
              style={[styles.dateChip, { backgroundColor: appColors.primary }]}
              onPress={openDatePicker}
            >
              <Text
                style={[
                  styles.dateChipDay,
                  { color: "rgba(255,255,255,0.75)" },
                ]}
              >
                {format(selectedDate, "EEE").toUpperCase()}
              </Text>
              <Text style={[styles.dateChipNum, { color: "#fff" }]}>
                {format(selectedDate, "d")}
              </Text>
            </Pressable>
          )}

          {/* Calendar icon to open date picker */}
          <Pressable
            onPress={Platform.OS === "android" ? openDatePicker : undefined}
            style={[
              styles.dateChip,
              styles.calChip,
              { backgroundColor: appColors.chipBg },
            ]}
          >
            <MaterialCommunityIcons
              name="calendar-month-outline"
              size={18}
              color={appColors.textTertiary}
            />
          </Pressable>
        </ScrollView>
      </View>

      {/* ── Timeline ── */}
      <ScrollView
        ref={scrollRef}
        style={styles.timeline}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        <View
          style={[
            styles.timelineInner,
            { height: (TOTAL_HOURS + 1) * HOUR_HEIGHT },
          ]}
        >
          {/* Hour label column */}
          <View style={styles.hourColumn} pointerEvents="none">
            {hours.map((h) => (
              <View
                key={h}
                style={[styles.hourLabelRow, { height: HOUR_HEIGHT }]}
              >
                <Text
                  style={[
                    styles.hourLabel,
                    {
                      color:
                        h === 12 ? appColors.primary : appColors.textTertiary,
                    },
                    h === 12 && { fontWeight: "700" },
                  ]}
                >
                  {hourLabel(h)}
                </Text>
              </View>
            ))}
          </View>

          {/* Right column: tappable timeline */}
          <Pressable
            style={[
              styles.timelineContent,
              { height: (TOTAL_HOURS + 1) * HOUR_HEIGHT },
            ]}
            onPress={handleTimelineTap}
          >
            {/* Hour grid lines */}
            {hours.map((h, i) => (
              <View
                key={h}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: i * HOUR_HEIGHT,
                }}
              >
                {/* Full-hour line */}
                <View
                  style={[
                    styles.hourLine,
                    { backgroundColor: appColors.border },
                  ]}
                />
                {/* Half-hour tick */}
                {i < TOTAL_HOURS && (
                  <View
                    style={[
                      styles.halfHourLine,
                      {
                        top: HOUR_HEIGHT / 2,
                        backgroundColor: appColors.border + "60",
                      },
                    ]}
                  />
                )}
              </View>
            ))}

            {/* Busy blocks */}
            {dayBusy.map((b, i) => {
              const g = blockGeometry(b.start, b.end);
              if (
                g.top + g.height < 0 ||
                g.top > (TOTAL_HOURS + 1) * HOUR_HEIGHT
              )
                return null;
              const isGCal = !b.hasOwnProperty("priority");
              const blockColor = isGCal ? GOOGLE_BLUE : appColors.textSecondary;
              return (
                <View
                  key={i}
                  pointerEvents="none"
                  style={[
                    styles.busyBlock,
                    {
                      top: g.top + 2,
                      height: g.height - 4,
                      backgroundColor: blockColor + "18",
                      borderLeftColor: blockColor,
                    },
                  ]}
                >
                  <Text
                    style={[styles.busyTitle, { color: blockColor }]}
                    numberOfLines={1}
                  >
                    {b.title}
                  </Text>
                  {g.height >= 40 && (
                    <Text
                      style={[styles.busyTime, { color: blockColor + "99" }]}
                    >
                      {format(new Date(b.start), "h:mm")}–
                      {format(new Date(b.end), "h:mm a")}
                    </Text>
                  )}
                </View>
              );
            })}

            {/* Selected slot */}
            {selectedGeometry && selectedSlot && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.selectedBlock,
                  {
                    top: selectedGeometry.top + 2,
                    height: selectedGeometry.height - 4,
                    backgroundColor: appColors.primary + "22",
                    borderColor: appColors.primary,
                  },
                  {
                    transform: [{ scaleY: selectionScale }],
                    opacity: selectionOpacity,
                  },
                ]}
              >
                <View
                  style={[
                    styles.selectedPill,
                    { backgroundColor: appColors.primary },
                  ]}
                />
                <View style={{ flex: 1, justifyContent: "center" }}>
                  <Text
                    style={[styles.selectedTitle, { color: appColors.primary }]}
                    numberOfLines={1}
                  >
                    {task?.title ?? "New task"}
                  </Text>
                  {selectedGeometry.height >= 44 && (
                    <Text
                      style={[
                        styles.selectedTime,
                        { color: appColors.primary + "CC" },
                      ]}
                    >
                      {fmt12(selectedSlot.hour, selectedSlot.minute)} –{" "}
                      {fmt12(endH, endM)}
                    </Text>
                  )}
                </View>
                <MaterialCommunityIcons
                  name="check-circle"
                  size={16}
                  color={appColors.primary}
                  style={{ marginRight: 8 }}
                />
              </Animated.View>
            )}

            {/* Current time indicator */}
            {nowPosition !== null && (
              <View
                pointerEvents="none"
                style={[styles.nowLine, { top: nowPosition }]}
              >
                <View
                  style={[styles.nowDot, { backgroundColor: appColors.error }]}
                />
                <View
                  style={[styles.nowBar, { backgroundColor: appColors.error }]}
                />
              </View>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* ── Footer ── */}
      <View
        style={[styles.footer, { borderTopColor: appColors.border + "60" }]}
      >
        {!selectedSlot ? (
          <View
            style={[
              styles.noSelectionRow,
              { backgroundColor: appColors.chipBg },
            ]}
          >
            <MaterialCommunityIcons
              name="gesture-tap"
              size={16}
              color={appColors.textTertiary}
            />
            <Text
              style={[
                styles.noSelectionText,
                { color: appColors.textTertiary },
              ]}
            >
              Tap a free slot above · {durationMinutes} min
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={handleConfirm}
            style={[styles.confirmBtn, { backgroundColor: appColors.primary }]}
          >
            <View style={styles.confirmBtnInner}>
              <View>
                <Text style={styles.confirmBtnLabel}>Schedule</Text>
                <Text style={styles.confirmBtnTime}>
                  {format(selectedDate, "EEE, MMM d")} ·{" "}
                  {fmt12(selectedSlot.hour, selectedSlot.minute)} –{" "}
                  {fmt12(endH, endM)}
                </Text>
              </View>
              <View style={styles.confirmArrow}>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={18}
                  color="#fff"
                />
              </View>
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Date strip
  dateStripWrapper: {
    height: 58,
    flexShrink: 0,
    marginTop: 6,
    marginBottom: 6,
  },
  dateStrip: { flex: 1 },
  dateStripContent: {
    paddingHorizontal: 2,
    gap: 7,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
  },
  dateChip: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
  },
  dateChipDay: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  dateChipNum: { fontSize: 16, fontWeight: "700", lineHeight: 20 },
  calChip: { width: 40, height: 48 },

  // ── Timeline
  timeline: { flex: 1 },
  timelineInner: { flexDirection: "row" },

  // Hour labels (left column)
  hourColumn: { width: HOUR_LABEL_WIDTH, flexShrink: 0 },
  hourLabelRow: { justifyContent: "flex-start", paddingTop: 5 },
  hourLabel: {
    fontSize: 11,
    fontWeight: "500",
    textAlign: "right",
    paddingRight: 10,
  },

  // Tappable content area
  timelineContent: { flex: 1, position: "relative" },

  // Grid lines
  hourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    top: 0,
  },
  halfHourLine: {
    position: "absolute",
    left: 8,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },

  // Busy blocks
  busyBlock: {
    position: "absolute",
    left: 4,
    right: 4,
    borderRadius: 8,
    borderLeftWidth: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
    justifyContent: "center",
  },
  busyTitle: { fontSize: 11, fontWeight: "700" },
  busyTime: { fontSize: 10, marginTop: 1 },

  // Selected block
  selectedBlock: {
    position: "absolute",
    left: 4,
    right: 4,
    borderRadius: 10,
    borderWidth: 1.5,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
  },
  selectedPill: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
    marginRight: 8,
    marginLeft: 2,
    marginVertical: 4,
  },
  selectedTitle: { fontSize: 12, fontWeight: "700" },
  selectedTime: { fontSize: 10, marginTop: 1 },

  // Now indicator
  nowLine: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 10,
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: -4,
    marginRight: 2,
  },
  nowBar: { flex: 1, height: 1.5 },

  // Footer
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    paddingBottom: 6,
    flexShrink: 0,
  },

  noSelectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    borderRadius: 14,
  },
  noSelectionText: { fontSize: 13, fontWeight: "500" },

  confirmBtn: {
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  confirmBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  confirmBtnLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    opacity: 0.8,
    marginBottom: 2,
  },
  confirmBtnTime: { color: "#fff", fontSize: 15, fontWeight: "700" },
  confirmArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
});
