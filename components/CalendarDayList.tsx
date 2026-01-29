/**
 * CalendarDayList - Task list for selected day
 *
 * Shows tasks scheduled for a specific date with quick info
 */

import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text, Card, Chip } from "react-native-paper";
import { Task, CalendarEvent } from "@/lib/types";
import { format, isSameDay, parseISO, isToday, isTomorrow } from "date-fns";

interface CalendarDayListProps {
  date: Date;
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  onTaskPress: (task: Task) => void;
}

const PRIORITY_COLORS = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

export default function CalendarDayList({
  date,
  tasks,
  calendarEvents,
  onTaskPress,
}: CalendarDayListProps) {
  // Filter items for selected date
  const dayTasks = tasks.filter((task) => {
    if (!task.scheduled_start) return false;
    return isSameDay(parseISO(task.scheduled_start), date);
  });

  const dayEvents = calendarEvents.filter((event) => {
    return isSameDay(parseISO(event.start_time), date);
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

  return (
    <View style={styles.container}>
      <Text style={styles.dateLabel}>{getDateLabel()}</Text>

      {isEmpty ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No tasks or events</Text>
          <Text style={styles.emptySubtext}>
            Add a task to get started
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {/* Calendar Events */}
          {sortedEvents.map((event) => (
            <View key={event.id} style={styles.eventItem}>
              <View style={styles.eventTime}>
                <Text style={styles.eventTimeText}>
                  {format(parseISO(event.start_time), "h:mm a")}
                </Text>
              </View>
              <View style={[styles.eventContent, styles.calendarEventContent]}>
                <View style={styles.calendarIndicator} />
                <View style={styles.eventInfo}>
                  <Text style={styles.calendarEventTitle} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <Text style={styles.calendarEventMeta}>
                    {format(parseISO(event.start_time), "h:mm a")} -{" "}
                    {format(parseISO(event.end_time), "h:mm a")}
                  </Text>
                </View>
              </View>
            </View>
          ))}

          {/* Tasks */}
          {sortedTasks.map((task) => {
            const priorityColor =
              PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;

            return (
              <Pressable
                key={task.id}
                style={styles.eventItem}
                onPress={() => onTaskPress(task)}
              >
                <View style={styles.eventTime}>
                  <Text style={styles.eventTimeText}>
                    {task.scheduled_start
                      ? format(parseISO(task.scheduled_start), "h:mm a")
                      : "—"}
                  </Text>
                </View>
                <View
                  style={[
                    styles.eventContent,
                    styles.taskContent,
                    { borderLeftColor: priorityColor },
                  ]}
                >
                  <View style={styles.eventInfo}>
                    <View style={styles.taskHeader}>
                      <View
                        style={[
                          styles.priorityDot,
                          { backgroundColor: priorityColor },
                        ]}
                      />
                      <Text style={styles.taskTitle} numberOfLines={1}>
                        {task.title}
                      </Text>
                    </View>
                    <View style={styles.taskMeta}>
                      <Text style={styles.taskMetaText}>
                        {task.duration_minutes} min
                      </Text>
                      {task.scheduled_start && task.scheduled_end && (
                        <Text style={styles.taskMetaText}>
                          {format(parseISO(task.scheduled_start), "h:mm")} -{" "}
                          {format(parseISO(task.scheduled_end), "h:mm a")}
                        </Text>
                      )}
                    </View>
                  </View>
                  <Chip
                    compact
                    style={[styles.statusChip, { backgroundColor: `${priorityColor}15` }]}
                    textStyle={{ color: priorityColor, fontSize: 10 }}
                  >
                    {task.priority}
                  </Chip>
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
    color: "#1e293b",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  list: {
    gap: 8,
  },
  eventItem: {
    flexDirection: "row",
    gap: 12,
  },
  eventTime: {
    width: 60,
    paddingTop: 12,
  },
  eventTimeText: {
    fontSize: 12,
    color: "#64748b",
    textAlign: "right",
  },
  eventContent: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  calendarEventContent: {
    borderLeftWidth: 3,
    borderLeftColor: "#94a3b8",
    backgroundColor: "#f8fafc",
  },
  calendarIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#94a3b8",
  },
  eventInfo: {
    flex: 1,
  },
  calendarEventTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#64748b",
  },
  calendarEventMeta: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  taskContent: {
    borderLeftWidth: 3,
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1e293b",
    flex: 1,
  },
  taskMeta: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  taskMetaText: {
    fontSize: 12,
    color: "#64748b",
  },
  statusChip: {
    height: "auto",
    paddingVertical: 2,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "500",
    color: "#64748b",
  },
  emptySubtext: {
    fontSize: 14,
    color: "#94a3b8",
    marginTop: 4,
  },
});
