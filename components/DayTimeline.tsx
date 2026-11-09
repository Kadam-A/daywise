/**
 * DayTimeline - Visual timeline showing tasks and events for a day
 *
 * Features:
 * - Hourly markers
 * - Tasks colored by priority
 * - Calendar events in gray
 * - Current time indicator (red line)
 * - Drag-and-drop rescheduling with gesture handler + reanimated
 */

import React, { useMemo, useEffect, useState, useRef, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, Platform, GestureResponderEvent } from "react-native";
import { Text, Surface } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Task, CalendarEvent } from "@/lib/types";
import { useAppColors } from "@/contexts/ThemeContext";
import { format, isToday, isSameDay, parseISO, startOfDay, endOfDay, isPast, addMinutes } from "date-fns";
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

// Static defaults for StyleSheet.create (overridden dynamically via appColors in component)
const STATIC_COLORS = {
  primary: "#4A90E2",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  background: "#F8F9FB",
  surface: "#FFFFFF",
  border: "#E5E7EB",
  error: "#E25555",
  warning: "#F5A962",
  success: "#5FBF73",
};

const GOOGLE_BLUE = "#4285F4";

interface DayTimelineProps {
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  date: Date;
  onTaskPress: (task: Task) => void;
  onTaskReschedule?: (task: Task, newStart: string, newEnd: string) => void;
  onEventPress?: (event: CalendarEvent) => void;
  onEmptySlotPress?: (time: Date) => void;
  startHour?: number;
  endHour?: number;
  autoScrollToNow?: boolean;
}

const HOUR_HEIGHT = 60; // pixels per hour
const SNAP_MINUTES = 15; // snap to 15-min intervals
const SNAP_PX = (SNAP_MINUTES / 60) * HOUR_HEIGHT; // 15px per snap
const STATIC_PRIORITY_COLORS: Record<string, string> = {
  high: STATIC_COLORS.error,
  medium: STATIC_COLORS.warning,
  low: STATIC_COLORS.success,
};

// === DraggableTaskBlock sub-component ===

interface DraggableTaskBlockProps {
  task: Task;
  top: number;
  height: number;
  priorityColor: string;
  startHour: number;
  endHour: number;
  date: Date;
  onPress: () => void;
  onReschedule?: (task: Task, newStart: string, newEnd: string) => void;
  allTasks: Task[];
  allEvents: CalendarEvent[];
}

function DraggableTaskBlock({
  task,
  top: originalTop,
  height,
  priorityColor,
  startHour,
  endHour,
  date,
  onPress,
  onReschedule,
  allTasks,
  allEvents,
}: DraggableTaskBlockProps) {
  const appColors = useAppColors();
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const zIndex = useSharedValue(1);
  const ghostOpacity = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const lastSnapY = useSharedValue(0);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const triggerMediumHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const settleBack = useCallback(() => {
    translateY.value = withTiming(0, { duration: 150 });
    scale.value = withTiming(1, { duration: 150 });
    zIndex.value = 1;
    ghostOpacity.value = withTiming(0, { duration: 150 });
    isDragging.value = false;
  }, []);

  const shakeAndReset = useCallback((fromY: number) => {
    translateY.value = withSequence(
      withTiming(fromY + 8, { duration: 50 }),
      withTiming(fromY - 8, { duration: 50 }),
      withTiming(fromY + 4, { duration: 50 }),
      withTiming(0, { duration: 150 })
    );
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
    (finalTranslateY: number) => {
      if (!onReschedule || !task.scheduled_start || !task.scheduled_end) return;

      const totalOffsetMinutes = (finalTranslateY / HOUR_HEIGHT) * 60;
      const snappedMinutes =
        Math.round(totalOffsetMinutes / SNAP_MINUTES) * SNAP_MINUTES;

      // Dropped in same position — settle back gracefully
      if (snappedMinutes === 0) {
        settleBack();
        return;
      }

      const oldStart = parseISO(task.scheduled_start);
      const newStart = addMinutes(oldStart, snappedMinutes);
      const newEnd = addMinutes(parseISO(task.scheduled_end), snappedMinutes);
      const newStartISO = newStart.toISOString();
      const newEndISO = newEnd.toISOString();

      // Validate: not in past
      if (isPast(newStart)) {
        shakeAndReset(finalTranslateY);
        return;
      }

      // Validate: no overlap with other tasks or calendar events
      if (checkOverlap(newStartISO, newEndISO)) {
        shakeAndReset(finalTranslateY);
        return;
      }

      // Valid drop — commit
      settleBack();
      onReschedule(task, newStartISO, newEndISO);
    },
    [onReschedule, task, settleBack, shakeAndReset, checkOverlap]
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

      // Check for snap crossing for haptic
      const snapped = Math.round(e.translationY / SNAP_PX) * SNAP_PX;
      if (snapped !== lastSnapY.value) {
        lastSnapY.value = snapped;
        runOnJS(triggerHaptic)();
      }
    })
    .onEnd((e) => {
      if (!isDragging.value) return;
      // Snap to nearest 15-min interval
      const snapped = Math.round(e.translationY / SNAP_PX) * SNAP_PX;
      translateY.value = withTiming(snapped, { duration: 100 });
      runOnJS(handleDrop)(snapped);
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
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    zIndex: zIndex.value,
    opacity: isDragging.value ? 0.92 : 1,
  }));

  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostOpacity.value,
  }));

  // Snap indicator line position
  const snapLineStyle = useAnimatedStyle(() => {
    if (!isDragging.value) return { opacity: 0 };
    const snapped = Math.round(translateY.value / SNAP_PX) * SNAP_PX;
    return {
      opacity: 1,
      top: originalTop + snapped,
    };
  });

  if (!onReschedule) {
    // No drag-and-drop — render as plain Pressable
    return (
      <Pressable
        onPress={onPress}
        style={[
          styles.eventBlock,
          styles.taskBlock,
          {
            top: originalTop,
            height,
            backgroundColor: `${priorityColor}15`,
          },
        ]}
      >
        <View style={styles.taskContent}>
          <View
            style={[styles.priorityDot, { backgroundColor: priorityColor }]}
          />
          <Text
            style={[styles.taskText, { color: priorityColor }]}
            numberOfLines={1}
          >
            {task.title}
          </Text>
          {task.scheduled_start && task.scheduled_end && (
            <Text style={[styles.taskTime, { color: appColors.textSecondary }]}>
              {format(parseISO(task.scheduled_start), "h:mm")}–{format(parseISO(task.scheduled_end), "h:mm a")}
            </Text>
          )}
        </View>
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
        <View style={styles.taskContent}>
          <View
            style={[styles.priorityDot, { backgroundColor: priorityColor, opacity: 0.4 }]}
          />
          <Text
            style={[styles.taskText, { color: priorityColor, opacity: 0.4 }]}
            numberOfLines={1}
          >
            {task.title}
          </Text>
        </View>
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
              backgroundColor: `${priorityColor}15`,
            },
            animatedStyle,
          ]}
        >
          <View style={styles.taskContent}>
            <View
              style={[
                styles.priorityDot,
                { backgroundColor: priorityColor },
              ]}
            />
            <Text
              style={[styles.taskText, { color: priorityColor }]}
              numberOfLines={1}
            >
              {task.title}
            </Text>
            {task.scheduled_start && task.scheduled_end && (
              <Text style={styles.taskTime}>
                {format(parseISO(task.scheduled_start), "h:mm")}–{format(parseISO(task.scheduled_end), "h:mm a")}
              </Text>
            )}
          </View>
        </Animated.View>
      </GestureDetector>
    </>
  );
}

// === Main DayTimeline component ===

export default function DayTimeline({
  tasks,
  calendarEvents,
  date,
  onTaskPress,
  onTaskReschedule,
  onEventPress,
  onEmptySlotPress,
  startHour = 0,
  endHour = 23,
  autoScrollToNow = false,
}: DayTimelineProps) {
  const appColors = useAppColors();

  const handleEmptyTap = useCallback((e: GestureResponderEvent) => {
    if (!onEmptySlotPress) return;
    const tapY = e.nativeEvent.locationY;
    const rawMins = (tapY / HOUR_HEIGHT) * 60;
    const snapped = Math.round(rawMins / 30) * 30;
    const totalMins = startHour * 60 + snapped;
    const hour = Math.floor(totalMins / 60);
    const minute = totalMins % 60;
    if (hour < startHour || hour >= endHour) return;
    const tapped = new Date(date);
    tapped.setHours(hour, minute, 0, 0);
    if (tapped < new Date()) return;
    onEmptySlotPress(tapped);
  }, [onEmptySlotPress, date, startHour, endHour]);
  const getPriorityColor = (priority: string) =>
    priority === "high" ? appColors.priorityHigh : priority === "medium" ? appColors.priorityMedium : appColors.priorityLow;
  const [currentTime, setCurrentTime] = useState(new Date());
  const scrollViewRef = useRef<ScrollView>(null);

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Calculate initial scroll position for current time
  const initialScrollOffset = useMemo(() => {
    if (!autoScrollToNow || !isToday(date)) return 0;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startOffset = nowMinutes - startHour * 60;

    if (startOffset > 0 && nowMinutes <= endHour * 60) {
      // Center the current time in the viewport (offset by ~half screen height)
      return Math.max(0, (startOffset / 60) * HOUR_HEIGHT - 280);
    }
    return 0;
  }, [autoScrollToNow, date, startHour, endHour]);

  // Auto-scroll to current time when component mounts
  useEffect(() => {
    if (!autoScrollToNow || !isToday(date) || initialScrollOffset === 0) return;

    // Try scrolling multiple times to ensure it works
    const scroll = () => {
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollTo({ y: initialScrollOffset, animated: true });
      }
    };

    const t1 = setTimeout(scroll, 100);
    const t2 = setTimeout(scroll, 300);
    const t3 = setTimeout(scroll, 600);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [autoScrollToNow, date, initialScrollOffset]);

  // Check if an item overlaps a given day
  const overlapsDay = (itemStart: string, itemEnd: string) => {
    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);
    const start = parseISO(itemStart);
    const end = parseISO(itemEnd);
    return start <= dayEnd && end >= dayStart;
  };

  // Filter items for this day — includes overlapping tasks and pending tasks by due date
  const dayTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (task.scheduled_start && task.scheduled_end) {
        return overlapsDay(task.scheduled_start, task.scheduled_end);
      }
      if (task.scheduled_start) {
        return isSameDay(parseISO(task.scheduled_start), date);
      }
      if (task.status === "pending_schedule" && task.due_date) {
        return isSameDay(parseISO(task.due_date), date);
      }
      return false;
    });
  }, [tasks, date]);

  const dayEvents = useMemo(() => {
    return calendarEvents.filter((event) => {
      return overlapsDay(event.start_time, event.end_time);
    });
  }, [calendarEvents, date]);

  // Generate hour markers
  const hours = useMemo(() => {
    const result = [];
    for (let h = startHour; h <= endHour; h++) {
      result.push(h);
    }
    return result;
  }, [startHour, endHour]);

  // Calculate position and height for an item
  const getItemStyle = (startTime: string, endTime: string) => {
    const start = parseISO(startTime);
    const end = parseISO(endTime);

    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const duration = endMinutes - startMinutes;

    const startOffset = startMinutes - startHour * 60;
    const top = (startOffset / 60) * HOUR_HEIGHT;
    const height = Math.max((duration / 60) * HOUR_HEIGHT, 30); // Minimum 30px

    return { top, height };
  };

  // Current time indicator position
  const currentTimePosition = useMemo(() => {
    if (!isToday(date)) return null;

    const now = currentTime;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startOffset = nowMinutes - startHour * 60;

    if (startOffset < 0 || nowMinutes > endHour * 60) return null;

    return (startOffset / 60) * HOUR_HEIGHT;
  }, [currentTime, date, startHour, endHour]);

  const formatHour = (hour: number) => {
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${displayHour} ${period}`;
  };

  const totalHeight = (endHour - startHour + 1) * HOUR_HEIGHT;

  return (
    <View style={[styles.container, { backgroundColor: appColors.surface }]}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={{ minHeight: totalHeight + 20 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        <View style={[styles.timelineContainer, { height: totalHeight }]}>
          {/* Hour markers */}
          <View style={styles.hoursColumn}>
            {hours.map((hour) => (
              <View
                key={hour}
                style={[styles.hourRow, { height: HOUR_HEIGHT }]}
              >
                <Text style={[styles.hourText, { color: appColors.textTertiary }]}>{formatHour(hour)}</Text>
              </View>
            ))}
          </View>

          {/* Events column — tappable background for tap-to-create */}
          <Pressable style={[styles.eventsColumn, { height: totalHeight }]} onPress={handleEmptyTap}>
            {/* Hour grid lines */}
            {hours.map((hour) => (
              <View
                key={hour}
                style={[
                  styles.hourLine,
                  { top: (hour - startHour) * HOUR_HEIGHT, backgroundColor: appColors.border },
                ]}
              />
            ))}

            {/* Calendar events (Google blue accent) */}
            {dayEvents.map((event) => {
              const { top, height } = getItemStyle(
                event.start_time,
                event.end_time
              );
              return (
                <Pressable
                  key={event.id}
                  onPress={() => onEventPress?.(event)}
                  style={[
                    styles.eventBlock,
                    styles.calendarEvent,
                    { top, height, backgroundColor: GOOGLE_BLUE + "12", borderLeftColor: GOOGLE_BLUE },
                  ]}
                >
                  <Text style={[styles.calendarEventText, { color: GOOGLE_BLUE }]} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <Text style={[styles.calendarEventTime, { color: GOOGLE_BLUE + "AA" }]}>
                    {format(parseISO(event.start_time), "h:mm a")}
                  </Text>
                </Pressable>
              );
            })}

            {/* Tasks (colored by priority) — draggable */}
            {dayTasks.map((task) => {
              if (!task.scheduled_start || !task.scheduled_end) return null;
              const { top, height } = getItemStyle(
                task.scheduled_start,
                task.scheduled_end
              );
              const priorityColor = getPriorityColor(task.priority);

              return (
                <DraggableTaskBlock
                  key={task.id}
                  task={task}
                  top={top}
                  height={height}
                  priorityColor={priorityColor}
                  startHour={startHour}
                  endHour={endHour}
                  date={date}
                  onPress={() => onTaskPress(task)}
                  onReschedule={onTaskReschedule}
                  allTasks={dayTasks}
                  allEvents={dayEvents}
                />
              );
            })}

            {/* Current time indicator */}
            {currentTimePosition !== null && (
              <View
                style={[styles.currentTimeIndicator, { top: currentTimePosition }]}
              >
                <View style={styles.currentTimeDot} />
                <View style={styles.currentTimeLine} />
              </View>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* Empty state */}
      {dayTasks.length === 0 && dayEvents.length === 0 && (
        <View style={styles.emptyState}>
          <View style={[styles.emptyStateIconWrapper, { backgroundColor: appColors.primaryLight }]}>
            <MaterialCommunityIcons
              name={isToday(date) ? "white-balance-sunny" : "calendar-blank-outline"}
              size={32}
              color={appColors.primary}
            />
          </View>
          <Text style={[styles.emptyStateTitle, { color: appColors.textPrimary }]}>
            {isToday(date) ? "Your day is wide open" : "Nothing scheduled"}
          </Text>
          <Text style={[styles.emptyStateText, { color: appColors.textTertiary }]}>
            {isToday(date) ? "A perfect time to plan something" : "Nothing on the calendar"}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: STATIC_COLORS.surface,
    borderRadius: 16,
    overflow: "hidden",
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
  timelineContainer: {
    flexDirection: "row",
    paddingTop: 10,
  },
  hoursColumn: {
    width: 55,
    paddingRight: 8,
  },
  hourRow: {
    justifyContent: "flex-start",
  },
  hourText: {
    fontSize: 12,
    color: STATIC_COLORS.textTertiary,
    textAlign: "right",
    marginTop: -6,
  },
  eventsColumn: {
    flex: 1,
    position: "relative",
    marginRight: 8,
  },
  hourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: STATIC_COLORS.border,
  },
  eventBlock: {
    position: "absolute",
    left: 4,
    right: 4,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    overflow: "hidden",
  },
  calendarEvent: {
    backgroundColor: STATIC_COLORS.background,
  },
  calendarEventText: {
    fontSize: 13,
    fontWeight: "500",
    color: STATIC_COLORS.textSecondary,
  },
  calendarEventTime: {
    fontSize: 11,
    color: STATIC_COLORS.textTertiary,
    marginTop: 2,
  },
  taskBlock: {},
  taskContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  priorityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  taskText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  taskTime: {
    fontSize: 11,
    color: STATIC_COLORS.textSecondary,
    flexShrink: 0,
  },
  ghostBlock: {
    backgroundColor: "#F3F4F6",
    borderStyle: "dashed",
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
  },
  snapLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: STATIC_COLORS.primary,
    zIndex: 50,
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
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: STATIC_COLORS.error,
    marginLeft: -5,
  },
  currentTimeLine: {
    flex: 1,
    height: 2,
    backgroundColor: STATIC_COLORS.error,
  },
  emptyState: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  emptyStateIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#EBF4FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: STATIC_COLORS.textPrimary,
    marginBottom: 4,
  },
  emptyStateText: {
    fontSize: 14,
    color: STATIC_COLORS.textTertiary,
    textAlign: "center",
  },
});
