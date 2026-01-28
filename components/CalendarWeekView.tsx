/**
 * CalendarWeekView - 7-day calendar grid with task dots
 *
 * Features:
 * - Swipe navigation (handled by parent)
 * - Dots indicate tasks scheduled that day
 * - Current day highlighted
 * - Tap day to select
 */

import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "react-native-paper";
import { Task } from "@/lib/types";
import {
  format,
  isSameDay,
  isToday,
  startOfWeek,
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
  // Generate 7 days starting from weekStart
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Count tasks per day
  const getTaskCount = (date: Date): number => {
    return tasks.filter((task) => {
      if (!task.scheduled_start) return false;
      return isSameDay(parseISO(task.scheduled_start), date);
    }).length;
  };

  return (
    <View style={styles.container}>
      {days.map((day) => {
        const isSelected = isSameDay(day, selectedDate);
        const isCurrentDay = isToday(day);
        const taskCount = getTaskCount(day);

        return (
          <Pressable
            key={day.toISOString()}
            style={[
              styles.dayCell,
              isSelected && styles.dayCellSelected,
              isCurrentDay && !isSelected && styles.dayCellToday,
            ]}
            onPress={() => onSelectDate(day)}
          >
            <Text
              style={[
                styles.dayName,
                isSelected && styles.dayNameSelected,
                isCurrentDay && !isSelected && styles.dayNameToday,
              ]}
            >
              {format(day, "EEE")}
            </Text>
            <Text
              style={[
                styles.dayNumber,
                isSelected && styles.dayNumberSelected,
                isCurrentDay && !isSelected && styles.dayNumberToday,
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
                      isSelected && styles.dotSelected,
                    ]}
                  />
                ))
              ) : taskCount > 3 ? (
                <>
                  <View style={[styles.dot, isSelected && styles.dotSelected]} />
                  <View style={[styles.dot, isSelected && styles.dotSelected]} />
                  <Text
                    style={[
                      styles.moreText,
                      isSelected && styles.moreTextSelected,
                    ]}
                  >
                    +{taskCount - 2}
                  </Text>
                </>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 8,
    gap: 4,
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 10,
  },
  dayCellSelected: {
    backgroundColor: "#2563eb",
  },
  dayCellToday: {
    backgroundColor: "#eff6ff",
  },
  dayName: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 4,
  },
  dayNameSelected: {
    color: "#ffffff",
  },
  dayNameToday: {
    color: "#2563eb",
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1e293b",
  },
  dayNumberSelected: {
    color: "#ffffff",
  },
  dayNumberToday: {
    color: "#2563eb",
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
    backgroundColor: "#2563eb",
  },
  dotSelected: {
    backgroundColor: "#ffffff",
  },
  moreText: {
    fontSize: 9,
    color: "#2563eb",
    fontWeight: "600",
  },
  moreTextSelected: {
    color: "#ffffff",
  },
});
