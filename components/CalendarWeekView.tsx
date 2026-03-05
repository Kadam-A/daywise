/**
 * CalendarWeekView - 7-day calendar grid with task dots + task previews
 *
 * Features:
 * - Swipe navigation (handled by parent)
 * - Dots indicate tasks scheduled that day
 * - Up to 2 task title previews per day
 * - Current day highlighted
 * - Tap day to select
 */

import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "react-native-paper";
import { Task } from "@/lib/types";
import { useAppColors } from "@/contexts/ThemeContext";
import {
  format,
  isSameDay,
  isToday,
  addDays,
  parseISO,
} from "date-fns";

interface CalendarWeekViewProps {
  weekStart: Date;
  tasks: Task[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

export default function CalendarWeekView({
  weekStart,
  tasks,
  selectedDate,
  onSelectDate,
}: CalendarWeekViewProps) {
  const COLORS = useAppColors();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const getTasksForDay = (date: Date): Task[] => {
    return tasks
      .filter((task) => {
        if (!task.scheduled_start) return false;
        return isSameDay(parseISO(task.scheduled_start), date);
      })
      .sort((a, b) => {
        if (!a.scheduled_start || !b.scheduled_start) return 0;
        return new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime();
      });
  };

  const getPriorityColor = (priority: string) => {
    if (priority === "high") return COLORS.priorityHigh;
    if (priority === "medium") return COLORS.priorityMedium;
    return COLORS.priorityLow;
  };

  return (
    <View style={[styles.container, { backgroundColor: COLORS.surface }]}>
      {days.map((day) => {
        const isSelected = isSameDay(day, selectedDate);
        const isCurrentDay = isToday(day);
        const dayTasks = getTasksForDay(day);
        const taskCount = dayTasks.length;
        const previewTasks = dayTasks.slice(0, 2);
        const moreCount = taskCount - 2;

        return (
          <Pressable
            key={day.toISOString()}
            style={[
              styles.dayCell,
              isSelected && { backgroundColor: COLORS.primary },
              isCurrentDay && !isSelected && { backgroundColor: `${COLORS.primary}15` },
            ]}
            onPress={() => onSelectDate(day)}
          >
            <Text
              style={[
                styles.dayName,
                { color: COLORS.textSecondary },
                isSelected && { color: "#FFFFFF" },
                isCurrentDay && !isSelected && { color: COLORS.primary },
              ]}
            >
              {format(day, "EEE")}
            </Text>
            <Text
              style={[
                styles.dayNumber,
                { color: COLORS.textPrimary },
                isSelected && { color: "#FFFFFF" },
                isCurrentDay && !isSelected && { color: COLORS.primary },
              ]}
            >
              {format(day, "d")}
            </Text>

            {/* Task dots */}
            <View style={styles.dotsContainer}>
              {taskCount > 0 && taskCount <= 3 ? (
                Array.from({ length: taskCount }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      { backgroundColor: COLORS.primary },
                      isSelected && { backgroundColor: "#FFFFFF" },
                    ]}
                  />
                ))
              ) : taskCount > 3 ? (
                <>
                  <View style={[styles.dot, { backgroundColor: COLORS.primary }, isSelected && { backgroundColor: "#FFFFFF" }]} />
                  <View style={[styles.dot, { backgroundColor: COLORS.primary }, isSelected && { backgroundColor: "#FFFFFF" }]} />
                  <Text
                    style={[
                      styles.moreText,
                      { color: COLORS.primary },
                      isSelected && { color: "#FFFFFF" },
                    ]}
                  >
                    +{taskCount - 2}
                  </Text>
                </>
              ) : null}
            </View>

            {/* Task title previews */}
            {previewTasks.length > 0 && (
              <View style={styles.previewContainer}>
                {previewTasks.map((task) => (
                  <View key={task.id} style={styles.previewRow}>
                    <View style={[styles.previewDot, { backgroundColor: isSelected ? "#FFFFFF" : getPriorityColor(task.priority) }]} />
                    <Text
                      style={[styles.previewTitle, { color: COLORS.textTertiary }, isSelected && { color: "rgba(255,255,255,0.8)" }]}
                      numberOfLines={1}
                    >
                      {task.title}
                    </Text>
                  </View>
                ))}
                {moreCount > 0 && (
                  <Text style={[styles.previewMore, { color: COLORS.textTertiary }, isSelected && { color: "rgba(255,255,255,0.7)" }]}>
                    +{moreCount} more
                  </Text>
                )}
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 8,
    gap: 4,
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 100,
  },
  dayName: {
    fontSize: 12,
    marginBottom: 4,
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: "600",
  },
  dotsContainer: {
    flexDirection: "row",
    marginTop: 6,
    gap: 3,
    height: 8,
    alignItems: "center",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  moreText: {
    fontSize: 9,
    fontWeight: "600",
  },
  previewContainer: {
    marginTop: 6,
    width: "100%",
    paddingHorizontal: 4,
    gap: 2,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  previewDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  previewTitle: {
    flex: 1,
    fontSize: 8,
  },
  previewMore: {
    fontSize: 8,
    textAlign: "center",
    marginTop: 1,
  },
});
