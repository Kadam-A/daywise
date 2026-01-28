/**
 * DayTimeline - Visual timeline showing tasks and events for a day
 *
 * Features:
 * - Hourly markers
 * - Tasks colored by priority
 * - Calendar events in gray
 * - Current time indicator (red line)
 */

import React, { useMemo, useEffect, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { Text, Surface } from "react-native-paper";
import { Task, CalendarEvent } from "@/lib/types";
import { format, isToday, isSameDay, parseISO } from "date-fns";

interface DayTimelineProps {
  tasks: Task[];
  calendarEvents: CalendarEvent[];
  date: Date;
  onTaskPress: (task: Task) => void;
  startHour?: number;
  endHour?: number;
}

const HOUR_HEIGHT = 60; // pixels per hour
const PRIORITY_COLORS = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

export default function DayTimeline({
  tasks,
  calendarEvents,
  date,
  onTaskPress,
  startHour = 6,
  endHour = 22,
}: DayTimelineProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Filter items for this day
  const dayTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (!task.scheduled_start) return false;
      return isSameDay(parseISO(task.scheduled_start), date);
    });
  }, [tasks, date]);

  const dayEvents = useMemo(() => {
    return calendarEvents.filter((event) => {
      return isSameDay(parseISO(event.start_time), date);
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
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ height: totalHeight + 20 }}
      >
        <View style={styles.timelineContainer}>
          {/* Hour markers */}
          <View style={styles.hoursColumn}>
            {hours.map((hour) => (
              <View
                key={hour}
                style={[styles.hourRow, { height: HOUR_HEIGHT }]}
              >
                <Text style={styles.hourText}>{formatHour(hour)}</Text>
              </View>
            ))}
          </View>

          {/* Events column */}
          <View style={styles.eventsColumn}>
            {/* Hour grid lines */}
            {hours.map((hour) => (
              <View
                key={hour}
                style={[
                  styles.hourLine,
                  { top: (hour - startHour) * HOUR_HEIGHT },
                ]}
              />
            ))}

            {/* Calendar events (gray) */}
            {dayEvents.map((event) => {
              const { top, height } = getItemStyle(
                event.start_time,
                event.end_time
              );
              return (
                <View
                  key={event.id}
                  style={[
                    styles.eventBlock,
                    styles.calendarEvent,
                    { top, height },
                  ]}
                >
                  <Text style={styles.calendarEventText} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <Text style={styles.calendarEventTime}>
                    {format(parseISO(event.start_time), "h:mm a")}
                  </Text>
                </View>
              );
            })}

            {/* Tasks (colored by priority) */}
            {dayTasks.map((task) => {
              if (!task.scheduled_start || !task.scheduled_end) return null;
              const { top, height } = getItemStyle(
                task.scheduled_start,
                task.scheduled_end
              );
              const priorityColor = PRIORITY_COLORS[task.priority] || "#3b82f6";

              return (
                <Pressable
                  key={task.id}
                  onPress={() => onTaskPress(task)}
                  style={[
                    styles.eventBlock,
                    styles.taskBlock,
                    {
                      top,
                      height,
                      backgroundColor: `${priorityColor}15`,
                      borderLeftColor: priorityColor,
                    },
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
                      numberOfLines={height > 50 ? 2 : 1}
                    >
                      {task.title}
                    </Text>
                  </View>
                  {height > 40 && (
                    <Text style={styles.taskTime}>
                      {format(parseISO(task.scheduled_start), "h:mm a")}
                    </Text>
                  )}
                </Pressable>
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
          </View>
        </View>
      </ScrollView>

      {/* Empty state */}
      {dayTasks.length === 0 && dayEvents.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No events scheduled</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    overflow: "hidden",
  },
  scrollView: {
    flex: 1,
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
    color: "#94a3b8",
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
    backgroundColor: "#f1f5f9",
  },
  eventBlock: {
    position: "absolute",
    left: 4,
    right: 4,
    borderRadius: 8,
    padding: 8,
    overflow: "hidden",
  },
  calendarEvent: {
    backgroundColor: "#f1f5f9",
    borderLeftWidth: 3,
    borderLeftColor: "#94a3b8",
  },
  calendarEventText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#64748b",
  },
  calendarEventTime: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
  },
  taskBlock: {
    borderLeftWidth: 3,
  },
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
    color: "#64748b",
    marginTop: 2,
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
    backgroundColor: "#ef4444",
    marginLeft: -5,
  },
  currentTimeLine: {
    flex: 1,
    height: 2,
    backgroundColor: "#ef4444",
  },
  emptyState: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
    color: "#94a3b8",
  },
});
