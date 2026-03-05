/**
 * CalendarDayList - Task list for selected day
 *
 * Shows tasks scheduled for a specific date with quick info
 */

import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Task, CalendarEvent } from "@/lib/types";
import { useAppColors } from "@/contexts/ThemeContext";
import { format, isSameDay, parseISO, isToday, isTomorrow, startOfDay, endOfDay } from "date-fns";

// Static defaults for StyleSheet.create (overridden dynamically in component)
const COLORS = {
  primary: "#4A90E2",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  background: "#F8F9FB",
  surface: "#FFFFFF",
  border: "#E5E7EB",
};

// Priority-based styling - soft backgrounds (matching home page)
const PRIORITY_STYLES = {
  high: { bg: "#FEF2F2", accent: "#E25555", pillBg: "#FECACA", pillText: "#991B1B" },
  medium: { bg: "#FFFBEB", accent: "#F5A962", pillBg: "#FEF3C7", pillText: "#92400E" },
  low: { bg: "#F0FDF4", accent: "#5FBF73", pillBg: "#D1FAE5", pillText: "#065F46" },
};

interface CalendarDayListProps {
  date: Date;
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  onTaskPress: (task: Task) => void;
}

export default function CalendarDayList({
  date,
  tasks,
  calendarEvents,
  onTaskPress,
}: CalendarDayListProps) {
  const COLORS = useAppColors();

  // Check if an item overlaps the selected date
  const overlapsDay = (itemStart: string, itemEnd: string) => {
    const ds = startOfDay(date);
    const de = endOfDay(date);
    const start = parseISO(itemStart);
    const end = parseISO(itemEnd);
    return start <= de && end >= ds;
  };

  // Filter items for selected date — includes overlapping and pending tasks by due date
  const dayTasks = tasks.filter((task) => {
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

  const dayEvents = calendarEvents.filter((event) => {
    return overlapsDay(event.start_time, event.end_time);
  });

  // Sort by start time
  const sortedTasks = [...dayTasks].sort((a, b) => {
    const timeA = a.scheduled_start ? new Date(a.scheduled_start).getTime() : 0;
    const timeB = b.scheduled_start ? new Date(b.scheduled_start).getTime() : 0;
    return timeA - timeB;
  });

  const sortedEvents = [...dayEvents].sort(
    (a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  const getDateLabel = () => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, "EEEE, MMMM d");
  };

  const isEmpty = sortedTasks.length === 0 && sortedEvents.length === 0;

  // Dynamic priority styles based on theme
  const getPriorityStyle = (priority: string) => {
    switch (priority) {
      case "high": return { bg: `${COLORS.error}15`, accent: COLORS.error, pillBg: `${COLORS.error}25`, pillText: COLORS.error };
      case "medium": return { bg: `${COLORS.warning}15`, accent: COLORS.warning, pillBg: `${COLORS.warning}25`, pillText: COLORS.warning };
      default: return { bg: `${COLORS.success}15`, accent: COLORS.success, pillBg: `${COLORS.success}25`, pillText: COLORS.success };
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.dateLabel, { color: COLORS.textPrimary }]}>{getDateLabel()}</Text>

      {isEmpty ? (
        <View style={[styles.emptyState, { backgroundColor: COLORS.background }]}>
          <View style={[styles.emptyIconWrapper, { backgroundColor: COLORS.primaryLight }]}>
            <MaterialCommunityIcons
              name={isToday(date) ? "white-balance-sunny" : "calendar-blank-outline"}
              size={32}
              color={COLORS.primary}
            />
          </View>
          <Text style={[styles.emptyText, { color: COLORS.textPrimary }]}>
            {isToday(date) ? "Your day is clear!" : "Nothing scheduled"}
          </Text>
          <Text style={[styles.emptySubtext, { color: COLORS.textTertiary }]}>
            {isToday(date)
              ? "A perfect day to tackle something new"
              : "Tap + to add a task for this day"}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {/* Calendar Events */}
          {sortedEvents.map((event) => (
            <View key={event.id} style={styles.eventItem}>
              <View style={styles.eventTime}>
                <Text style={[styles.eventTimeText, { color: COLORS.textSecondary }]}>
                  {format(parseISO(event.start_time), "h:mm a")}
                </Text>
              </View>
              <View style={[styles.eventContent, { backgroundColor: COLORS.background }]}>
                <View style={[styles.calendarIndicator, { backgroundColor: COLORS.textTertiary }]} />
                <View style={styles.eventInfo}>
                  <Text style={[styles.calendarEventTitle, { color: COLORS.textSecondary }]} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <Text style={[styles.calendarEventMeta, { color: COLORS.textTertiary }]}>
                    {format(parseISO(event.start_time), "h:mm a")} -{" "}
                    {format(parseISO(event.end_time), "h:mm a")}
                  </Text>
                </View>
              </View>
            </View>
          ))}

          {/* Tasks */}
          {sortedTasks.map((task) => {
            const pStyle = getPriorityStyle(task.priority);
            const showPriorityPill = task.priority === "high" || task.priority === "medium";

            return (
              <Pressable
                key={task.id}
                style={styles.eventItem}
                onPress={() => onTaskPress(task)}
              >
                <View style={styles.eventTime}>
                  <Text style={[styles.eventTimeText, { color: COLORS.textSecondary }]}>
                    {task.scheduled_start
                      ? format(parseISO(task.scheduled_start), "h:mm a")
                      : "—"}
                  </Text>
                </View>
                <View style={[styles.taskCard, { backgroundColor: pStyle.bg }]}>
                  <View style={styles.taskCardTop}>
                    <Text style={[styles.taskTitle, { color: COLORS.textPrimary }]} numberOfLines={1}>
                      {task.title}
                    </Text>
                    {showPriorityPill && (
                      <View style={[styles.priorityPill, { backgroundColor: pStyle.pillBg }]}>
                        <Text style={[styles.priorityPillText, { color: pStyle.pillText }]}>
                          {task.priority}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.taskMetaText, { color: COLORS.textSecondary }]}>
                    {task.duration_minutes} min
                    {task.scheduled_end && ` · until ${format(parseISO(task.scheduled_end), "h:mm a")}`}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  list: {
    gap: 10,
  },
  eventItem: {
    flexDirection: "row",
    gap: 12,
  },
  eventTime: {
    width: 60,
    paddingTop: 14,
  },
  eventTimeText: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.textSecondary,
    textAlign: "right",
  },
  // Calendar events (external)
  eventContent: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  calendarEventContent: {
    backgroundColor: COLORS.background,
  },
  calendarIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.textTertiary,
  },
  eventInfo: {
    flex: 1,
  },
  calendarEventTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  calendarEventMeta: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  // Task cards with soft colored backgrounds
  taskCard: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
  },
  taskCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
    flex: 1,
  },
  priorityPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  priorityPillText: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  taskMetaText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    backgroundColor: COLORS.background,
    borderRadius: 14,
  },
  emptyIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#EBF4FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 4,
  },
});
