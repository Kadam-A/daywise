/**
 * WeekTimeline - TickTick-style multi-column week timeline
 *
 * Features:
 * - 7 day columns side by side
 * - Hourly markers on the left
 * - Tasks colored by priority
 * - Calendar events in gray
 * - Current time indicator (red line)
 * - Auto-scroll to current time
 */

import React, { useMemo, useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Task, CalendarEvent } from "@/lib/types";
import { useAppColors } from "@/contexts/ThemeContext";
import {
  format,
  isToday,
  isSameDay,
  parseISO,
  addDays,
  addMinutes,
  startOfDay,
  endOfDay,
  isPast,
} from "date-fns";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

export type DayCount = 3 | 7;

const GOOGLE_BLUE = "#4285F4";

interface WeekTimelineProps {
  weekStart: Date;
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  onTaskPress: (task: Task) => void;
  onTaskReschedule?: (task: Task, newStart: string, newEnd: string) => void;
  onEventPress?: (event: CalendarEvent) => void;
  dayCount: DayCount;
  onDayCountChange: (count: DayCount) => void;
  startHour?: number;
  endHour?: number;
}

const HOUR_HEIGHT = 50;
const HOUR_COLUMN_WIDTH = 40;
const DAY_HEADER_HEIGHT = 52;
const MIN_BLOCK_HEIGHT = 24;

const SNAP_MINUTES = 15;
const SNAP_PX = (SNAP_MINUTES / 60) * HOUR_HEIGHT;

/**
 * Returns a time range string sized for the block height, or null if too small.
 *  >= 36px  → full   "3:00–4:30 PM" / "3:00–4:30"
 *  >= 26px  → compact "3–4:30p"   (drop :00 on whole hours, single-char am/pm)
 *  <  26px  → null   (don't show — block too small)
 */
function formatBlockTime(
  startISO: string,
  endISO: string,
  blockHeight: number,
  is3Day: boolean,
): string | null {
  if (blockHeight < 26) return null;

  const s = parseISO(startISO);
  const e = parseISO(endISO);

  if (blockHeight >= 36) {
    // Full format
    return is3Day
      ? `${format(s, "h:mm")}–${format(e, "h:mm a")}`
      : `${format(s, "h:mm")}–${format(e, "h:mm")}`;
  }

  // Compact format: drop :00 on whole hours, single-char am/pm
  const fmtCompact = (d: Date) => {
    const m = d.getMinutes();
    return m === 0 ? `${format(d, "h")}` : `${format(d, "h:mm")}`;
  };
  const suffix = format(e, "a").charAt(0).toLowerCase(); // "a" or "p"
  return `${fmtCompact(s)}–${fmtCompact(e)}${suffix}`;
}

// === DraggableWeekTaskBlock sub-component ===

interface DraggableWeekTaskBlockProps {
  task: Task;
  top: number;
  height: number;
  priorityColor: string;
  dayCount: DayCount;
  dayIndex: number;
  days: Date[];
  columnWidth: number;
  onPress: () => void;
  onReschedule?: (task: Task, newStart: string, newEnd: string) => void;
  allTasks: Task[];
  allEvents: CalendarEvent[];
}

function DraggableWeekTaskBlock({
  task,
  top: originalTop,
  height,
  priorityColor,
  dayCount,
  dayIndex,
  days,
  columnWidth,
  onPress,
  onReschedule,
  allTasks,
  allEvents,
}: DraggableWeekTaskBlockProps) {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const scale = useSharedValue(1);
  const zIndex = useSharedValue(1);
  const ghostOpacity = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const lastSnapY = useSharedValue(0);
  const lastDayOffset = useSharedValue(0);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const triggerMediumHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const settleBack = useCallback(() => {
    translateY.value = withTiming(0, { duration: 150 });
    translateX.value = withTiming(0, { duration: 150 });
    scale.value = withTiming(1, { duration: 150 });
    zIndex.value = 1;
    ghostOpacity.value = withTiming(0, { duration: 150 });
    isDragging.value = false;
  }, []);

  const shakeAndReset = useCallback((fromY: number) => {
    translateY.value = withSequence(
      withTiming(fromY + 6, { duration: 50 }),
      withTiming(fromY - 6, { duration: 50 }),
      withTiming(fromY + 3, { duration: 50 }),
      withTiming(0, { duration: 150 })
    );
    translateX.value = withTiming(0, { duration: 150 });
    scale.value = withTiming(1, { duration: 150 });
    zIndex.value = 1;
    ghostOpacity.value = withTiming(0, { duration: 150 });
    isDragging.value = false;
  }, []);

  const checkOverlap = useCallback((newStartISO: string, newEndISO: string) => {
    const ns = new Date(newStartISO).getTime();
    const ne = new Date(newEndISO).getTime();
    for (const t of allTasks) {
      if (t.id === task.id || !t.scheduled_start || !t.scheduled_end) continue;
      const ts = new Date(t.scheduled_start).getTime();
      const te = new Date(t.scheduled_end).getTime();
      if (ns < te && ne > ts) return true;
    }
    for (const e of allEvents) {
      const es = new Date(e.start_time).getTime();
      const ee = new Date(e.end_time).getTime();
      if (ns < ee && ne > es) return true;
    }
    return false;
  }, [allTasks, allEvents, task.id]);

  const handleDrop = useCallback(
    (finalTranslateY: number, dayOffset: number) => {
      if (!onReschedule || !task.scheduled_start || !task.scheduled_end) return;

      const totalOffsetMinutes = (finalTranslateY / HOUR_HEIGHT) * 60;
      const snappedMinutes =
        Math.round(totalOffsetMinutes / SNAP_MINUTES) * SNAP_MINUTES;

      // Dropped in same position — settle back
      if (snappedMinutes === 0 && dayOffset === 0) {
        settleBack();
        return;
      }

      // Clamp target day to visible range
      const targetDayIndex = Math.max(0, Math.min(days.length - 1, dayIndex + dayOffset));

      // Compute new start: target day + original time-of-day + time offset
      const originalStart = parseISO(task.scheduled_start);
      const timeOfDayMinutes = originalStart.getHours() * 60 + originalStart.getMinutes();
      const newTimeMinutes = timeOfDayMinutes + snappedMinutes;

      const targetDay = startOfDay(days[targetDayIndex]);
      const newStart = addMinutes(targetDay, newTimeMinutes);
      const newEnd = addMinutes(newStart, task.duration_minutes);
      const newStartISO = newStart.toISOString();
      const newEndISO = newEnd.toISOString();

      if (isPast(newStart)) {
        shakeAndReset(finalTranslateY);
        return;
      }

      if (checkOverlap(newStartISO, newEndISO)) {
        shakeAndReset(finalTranslateY);
        return;
      }

      settleBack();
      onReschedule(task, newStartISO, newEndISO);
    },
    [onReschedule, task, days, dayIndex, settleBack, shakeAndReset, checkOverlap]
  );

  const longPress = Gesture.LongPress()
    .minDuration(500)
    .onStart(() => {
      if (!onReschedule) return;
      isDragging.value = true;
      scale.value = withSpring(1.03, { damping: 15 });
      zIndex.value = 100;
      ghostOpacity.value = withTiming(0.5, { duration: 200 });
      lastSnapY.value = 0;
      lastDayOffset.value = 0;
      runOnJS(triggerMediumHaptic)();
    });

  const pan = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (isDragging.value) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onUpdate((e) => {
      if (!isDragging.value) return;
      translateY.value = e.translationY;
      translateX.value = e.translationX;

      // Y snap haptic
      const snappedY = Math.round(e.translationY / SNAP_PX) * SNAP_PX;
      if (snappedY !== lastSnapY.value) {
        lastSnapY.value = snappedY;
        runOnJS(triggerHaptic)();
      }

      // Day column crossing haptic
      if (columnWidth > 0) {
        const currentDayOffset = Math.round(e.translationX / columnWidth);
        if (currentDayOffset !== lastDayOffset.value) {
          lastDayOffset.value = currentDayOffset;
          runOnJS(triggerHaptic)();
        }
      }
    })
    .onEnd((e) => {
      if (!isDragging.value) return;
      const snappedY = Math.round(e.translationY / SNAP_PX) * SNAP_PX;
      const dayOffset = columnWidth > 0 ? Math.round(e.translationX / columnWidth) : 0;
      // Clamp dayOffset so it doesn't go beyond visible days
      const clampedDayOffset = Math.max(-dayIndex, Math.min(days.length - 1 - dayIndex, dayOffset));

      translateY.value = withTiming(snappedY, { duration: 100 });
      translateX.value = withTiming(clampedDayOffset * columnWidth, { duration: 100 });
      runOnJS(handleDrop)(snappedY, clampedDayOffset);
    });

  const tap = Gesture.Tap().onEnd(() => {
    if (!isDragging.value) {
      runOnJS(onPress)();
    }
  });

  const composed = Gesture.Simultaneous(
    longPress,
    Gesture.Simultaneous(pan, tap)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    zIndex: zIndex.value,
    opacity: isDragging.value ? 0.92 : 1,
  }));

  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostOpacity.value,
  }));

  // Hide snap line when dragging across columns (it stays in the original column)
  const snapLineStyle = useAnimatedStyle(() => {
    if (!isDragging.value) return { opacity: 0 };
    const xOff = columnWidth > 0 ? Math.abs(translateX.value) / columnWidth : 0;
    if (xOff > 0.4) return { opacity: 0 };
    const snapped = Math.round(translateY.value / SNAP_PX) * SNAP_PX;
    return { opacity: 0.6, top: originalTop + snapped };
  });

  if (!onReschedule) {
    return (
      <Pressable
        onPress={onPress}
        style={[
          styles.eventBlock,
          styles.taskBlock,
          {
            top: originalTop,
            height,
            backgroundColor: `${priorityColor}20`,
          },
        ]}
      >
        <Text
          style={[styles.taskTitle, { color: priorityColor, fontSize: dayCount === 3 ? 12 : 10 }]}
          numberOfLines={1}
        >
          {task.title}
        </Text>
        {task.scheduled_start && task.scheduled_end &&
          (() => {
            const t = formatBlockTime(task.scheduled_start, task.scheduled_end, height, dayCount === 3);
            return t ? (
              <Text style={[styles.taskTime, { fontSize: dayCount === 3 ? 10 : 8 }]}>
                {t}
              </Text>
            ) : null;
          })()}
      </Pressable>
    );
  }

  return (
    <>
      {/* Ghost at original position */}
      <Animated.View
        style={[
          styles.eventBlock,
          styles.taskBlock,
          styles.ghostBlock,
          {
            top: originalTop,
            height,
          },
          ghostStyle,
        ]}
        pointerEvents="none"
      >
        <Text
          style={[styles.taskTitle, { color: priorityColor, opacity: 0.4, fontSize: dayCount === 3 ? 12 : 10 }]}
          numberOfLines={1}
        >
          {task.title}
        </Text>
      </Animated.View>

      {/* Snap indicator line */}
      <Animated.View
        style={[styles.snapLine, snapLineStyle]}
        pointerEvents="none"
      />

      {/* Draggable task block */}
      <GestureDetector gesture={composed}>
        <Animated.View
          style={[
            styles.eventBlock,
            styles.taskBlock,
            {
              top: originalTop,
              height,
              backgroundColor: `${priorityColor}20`,
            },
            animatedStyle,
          ]}
        >
          <Text
            style={[styles.taskTitle, { color: priorityColor, fontSize: dayCount === 3 ? 12 : 10 }]}
            numberOfLines={1}
          >
            {task.title}
          </Text>
          {task.scheduled_start && task.scheduled_end &&
            (() => {
              const t = formatBlockTime(task.scheduled_start, task.scheduled_end, height, dayCount === 3);
              return t ? (
                <Text style={[styles.taskTime, { fontSize: dayCount === 3 ? 10 : 8 }]}>
                  {t}
                </Text>
              ) : null;
            })()}
        </Animated.View>
      </GestureDetector>
    </>
  );
}

export default function WeekTimeline({
  weekStart,
  tasks,
  calendarEvents,
  onTaskPress,
  onTaskReschedule,
  onEventPress,
  dayCount,
  onDayCountChange,
  startHour = 0,
  endHour = 23,
}: WeekTimelineProps) {
  const COLORS = useAppColors();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [dayColumnWidth, setDayColumnWidth] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  // weekStart is the first day to display (Monday for 7-day, any day for 3-day)
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(weekStart, i)),
    [weekStart, dayCount]
  );

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Check if an event/task overlaps a given day (starts before day ends AND ends after day starts)
  const overlapsDay = (itemStart: string, itemEnd: string, day: Date) => {
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    const start = parseISO(itemStart);
    const end = parseISO(itemEnd);
    return start <= dayEnd && end >= dayStart;
  };

  // Pre-filter tasks by day — includes tasks that start on OR overlap the day,
  // plus pending_schedule tasks shown on their due date
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    days.forEach((day) => {
      const dayKey = format(day, "yyyy-MM-dd");
      map.set(
        dayKey,
        tasks.filter((t) => {
          if (t.scheduled_start && t.scheduled_end) {
            return overlapsDay(t.scheduled_start, t.scheduled_end, day);
          }
          if (t.scheduled_start) {
            return isSameDay(parseISO(t.scheduled_start), day);
          }
          // Show pending_schedule tasks on their due date
          if (t.status === "pending_schedule" && t.due_date) {
            return isSameDay(parseISO(t.due_date), day);
          }
          return false;
        })
      );
    });
    return map;
  }, [tasks, days]);

  // Pre-filter events by day — includes events that overlap the day
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    days.forEach((day) => {
      const dayKey = format(day, "yyyy-MM-dd");
      map.set(
        dayKey,
        calendarEvents.filter((e) =>
          overlapsDay(e.start_time, e.end_time, day)
        )
      );
    });
    return map;
  }, [calendarEvents, days]);

  // Hour markers
  const hours = useMemo(() => {
    const result = [];
    for (let h = startHour; h <= endHour; h++) {
      result.push(h);
    }
    return result;
  }, [startHour, endHour]);

  const totalHeight = (endHour - startHour + 1) * HOUR_HEIGHT;

  // Position calculation for an item
  const getItemPosition = (startTime: string, endTime: string) => {
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const duration = endMinutes - startMinutes;
    const startOffset = startMinutes - startHour * 60;
    const top = (startOffset / 60) * HOUR_HEIGHT;
    const height = Math.max((duration / 60) * HOUR_HEIGHT, MIN_BLOCK_HEIGHT);
    return { top, height };
  };

  // Current time indicator
  const currentTimePosition = useMemo(() => {
    // Check if any day this week is today
    const todayInWeek = days.some((d) => isToday(d));
    if (!todayInWeek) return null;

    const now = currentTime;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startOffset = nowMinutes - startHour * 60;
    if (startOffset < 0 || nowMinutes > endHour * 60) return null;
    return (startOffset / 60) * HOUR_HEIGHT;
  }, [currentTime, days, startHour, endHour]);

  // Auto-scroll to current time
  const initialScrollOffset = useMemo(() => {
    const todayInWeek = days.some((d) => isToday(d));
    if (!todayInWeek) return 0;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startOffset = nowMinutes - startHour * 60;

    if (startOffset > 0 && nowMinutes <= endHour * 60) {
      return Math.max(0, (startOffset / 60) * HOUR_HEIGHT - 200);
    }
    return 0;
  }, [days, startHour, endHour]);

  useEffect(() => {
    if (initialScrollOffset === 0) return;

    const scroll = () => {
      scrollViewRef.current?.scrollTo({
        y: initialScrollOffset,
        animated: true,
      });
    };

    const t1 = setTimeout(scroll, 100);
    const t2 = setTimeout(scroll, 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [initialScrollOffset]);

  const formatHour = (hour: number) => {
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour}${period}`;
  };

  const getPriorityColor = (priority: string) => {
    if (priority === "high") return COLORS.priorityHigh;
    if (priority === "medium") return COLORS.priorityMedium;
    return COLORS.priorityLow;
  };

  // Check if week has any tasks or events
  const hasContent = useMemo(() => {
    for (const [, dayTasks] of tasksByDay) {
      if (dayTasks.length > 0) return true;
    }
    for (const [, dayEvents] of eventsByDay) {
      if (dayEvents.length > 0) return true;
    }
    return false;
  }, [tasksByDay, eventsByDay]);

  return (
    <View style={[styles.container, { backgroundColor: COLORS.surface }]}>
      {/* Day header row */}
      <View
        style={[
          styles.dayHeaderRow,
          { borderBottomColor: COLORS.border, backgroundColor: COLORS.surface },
        ]}
      >
        {/* 3D / 7D toggle in the hour spacer area */}
        <Pressable
          style={styles.dayCountToggle}
          onPress={() => onDayCountChange(dayCount === 7 ? 3 : 7)}
        >
          <Text
            style={[
              styles.dayCountText,
              { color: COLORS.primary },
            ]}
          >
            {dayCount === 7 ? "3D" : "7D"}
          </Text>
        </Pressable>
        {days.map((day) => {
          const today = isToday(day);
          return (
            <View key={day.toISOString()} style={styles.dayHeaderCell}>
              <Text
                style={[
                  styles.dayName,
                  { color: today ? COLORS.primary : COLORS.textTertiary },
                ]}
              >
                {format(day, dayCount === 3 ? "EEEE" : "EEE")}
              </Text>
              <View
                style={[
                  styles.dayNumberCircle,
                  today && { backgroundColor: COLORS.primary },
                ]}
              >
                <Text
                  style={[
                    styles.dayNumberText,
                    { color: today ? "#FFFFFF" : COLORS.textPrimary },
                  ]}
                >
                  {format(day, "d")}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Scrollable timeline */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={{ minHeight: totalHeight + 20 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        <View style={[styles.timelineBody, { height: totalHeight }]}>
          {/* Hour markers column */}
          <View style={styles.hourColumn}>
            {hours.map((hour) => (
              <View
                key={hour}
                style={[styles.hourRow, { height: HOUR_HEIGHT }]}
              >
                <Text style={[styles.hourText, { color: COLORS.textTertiary }]}>
                  {formatHour(hour)}
                </Text>
              </View>
            ))}
          </View>

          {/* Day columns container */}
          <View
            style={styles.dayColumnsContainer}
            onLayout={(e) => setDayColumnWidth(e.nativeEvent.layout.width / dayCount)}
          >
            {days.map((day, dayIndex) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const dayTasks = tasksByDay.get(dayKey) || [];
              const dayEvents = eventsByDay.get(dayKey) || [];

              return (
                <View key={day.toISOString()} style={styles.dayColumn}>
                  {/* Hour grid lines */}
                  {hours.map((hour) => (
                    <View
                      key={hour}
                      style={[
                        styles.gridLine,
                        {
                          top: (hour - startHour) * HOUR_HEIGHT,
                          backgroundColor: COLORS.border,
                        },
                      ]}
                    />
                  ))}

                  {/* Column separator */}
                  {dayIndex < dayCount - 1 && (
                    <View
                      style={[
                        styles.columnSeparator,
                        { backgroundColor: COLORS.border },
                      ]}
                    />
                  )}

                  {/* Calendar events (Google blue accent) */}
                  {dayEvents.map((event) => {
                    const pos = getItemPosition(
                      event.start_time,
                      event.end_time
                    );
                    return (
                      <Pressable
                        key={event.id}
                        onPress={() => onEventPress?.(event)}
                        style={[
                          styles.eventBlock,
                          {
                            top: pos.top,
                            height: pos.height,
                            backgroundColor: GOOGLE_BLUE + "18",
                            borderLeftWidth: 2,
                            borderLeftColor: GOOGLE_BLUE,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.eventTitle,
                            { color: GOOGLE_BLUE, fontSize: dayCount === 3 ? 12 : 10 },
                          ]}
                          numberOfLines={dayCount === 3 ? 2 : 1}
                        >
                          {event.title}
                        </Text>
                      </Pressable>
                    );
                  })}

                  {/* Tasks — draggable */}
                  {dayTasks.map((task) => {
                    if (!task.scheduled_start || !task.scheduled_end)
                      return null;
                    const pos = getItemPosition(
                      task.scheduled_start,
                      task.scheduled_end
                    );
                    const priorityColor = getPriorityColor(task.priority);

                    return (
                      <DraggableWeekTaskBlock
                        key={task.id}
                        task={task}
                        top={pos.top}
                        height={pos.height}
                        priorityColor={priorityColor}
                        dayCount={dayCount}
                        dayIndex={dayIndex}
                        days={days}
                        columnWidth={dayColumnWidth}
                        onPress={() => onTaskPress(task)}
                        onReschedule={onTaskReschedule}
                        allTasks={tasks}
                        allEvents={calendarEvents}
                      />
                    );
                  })}
                </View>
              );
            })}

            {/* Current time indicator */}
            {currentTimePosition !== null && (
              <View
                style={[
                  styles.currentTimeIndicator,
                  { top: currentTimePosition },
                ]}
              >
                <View
                  style={[
                    styles.currentTimeDot,
                    { backgroundColor: COLORS.error },
                  ]}
                />
                <View
                  style={[
                    styles.currentTimeLine,
                    { backgroundColor: COLORS.error },
                  ]}
                />
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Empty state */}
      {!hasContent && (
        <View style={styles.emptyState}>
          <View
            style={[
              styles.emptyIconWrapper,
              { backgroundColor: `${COLORS.primary}15` },
            ]}
          >
            <MaterialCommunityIcons
              name="calendar-week"
              size={32}
              color={COLORS.primary}
            />
          </View>
          <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>
            No tasks this week
          </Text>
          <Text style={[styles.emptyText, { color: COLORS.textTertiary }]}>
            Tap + to add your first task
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  dayHeaderRow: {
    flexDirection: "row",
    height: DAY_HEADER_HEIGHT,
    borderBottomWidth: 1,
  },
  dayCountToggle: {
    width: HOUR_COLUMN_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCountText: {
    fontSize: 12,
    fontWeight: "700",
  },
  dayHeaderCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  dayName: {
    fontSize: 11,
    fontWeight: "500",
  },
  dayNumberCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNumberText: {
    fontSize: 14,
    fontWeight: "600",
  },
  scrollView: {
    flex: 1,
    ...Platform.select({
      web: {
        overflowY: "scroll" as any,
        maxHeight: "100%",
      },
      default: {},
    }),
  },
  timelineBody: {
    flexDirection: "row",
    paddingTop: 8,
  },
  hourColumn: {
    width: HOUR_COLUMN_WIDTH,
    paddingRight: 4,
  },
  hourRow: {
    justifyContent: "flex-start",
  },
  hourText: {
    fontSize: 10,
    textAlign: "right",
    marginTop: -5,
  },
  dayColumnsContainer: {
    flex: 1,
    flexDirection: "row",
    position: "relative",
  },
  dayColumn: {
    flex: 1,
    position: "relative",
  },
  columnSeparator: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  eventBlock: {
    position: "absolute",
    left: 1,
    right: 1,
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 2,
    overflow: "hidden",
  },
  taskBlock: {},
  ghostBlock: {
    backgroundColor: "#F3F4F6",
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  snapLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: "#4A90E2",
    zIndex: 50,
  },
  taskTitle: {
    fontSize: 10,
    fontWeight: "600",
  },
  taskTime: {
    fontSize: 8,
    marginTop: 1,
  },
  eventTitle: {
    fontSize: 10,
    fontWeight: "500",
  },
  currentTimeIndicator: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 10,
  },
  currentTimeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: -4,
  },
  currentTimeLine: {
    flex: 1,
    height: 1.5,
  },
  emptyState: {
    position: "absolute",
    top: DAY_HEADER_HEIGHT,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
});
