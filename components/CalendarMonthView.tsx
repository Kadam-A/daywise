/**
 * CalendarMonthView - Full month calendar grid
 *
 * Features:
 * - Full month grid (6 weeks max)
 * - Dots indicate tasks scheduled that day
 * - Current day highlighted
 * - Tap day to select
 */

import React, { useMemo } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "react-native-paper";
import { Task } from "@/lib/types";
import { useAppColors } from "@/contexts/ThemeContext";
import {
  format,
  isSameDay,
  isToday,
  isSameMonth,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  parseISO,
} from "date-fns";

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

interface CalendarMonthViewProps {
  month: Date;
  tasks: Task[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarMonthView({
  month,
  tasks,
  selectedDate,
  onSelectDate,
}: CalendarMonthViewProps) {
  const COLORS = useAppColors();
  // Generate calendar grid (weeks x 7 days)
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const days: Date[] = [];
    let current = calendarStart;

    while (current <= calendarEnd) {
      days.push(current);
      current = addDays(current, 1);
    }

    // Split into weeks
    const weeks: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }

    return weeks;
  }, [month]);

  // Count tasks per day
  const getTaskCount = (date: Date): number => {
    return tasks.filter((task) => {
      if (!task.scheduled_start) return false;
      return isSameDay(parseISO(task.scheduled_start), date);
    }).length;
  };

  return (
    <View style={[styles.container, { backgroundColor: COLORS.surface }]}>
      {/* Weekday headers */}
      <View style={styles.weekdayHeader}>
        {WEEKDAYS.map((day) => (
          <View key={day} style={styles.weekdayCell}>
            <Text style={[styles.weekdayText, { color: COLORS.textTertiary }]}>{day}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      {calendarDays.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.weekRow}>
          {week.map((day) => {
            const isSelected = isSameDay(day, selectedDate);
            const isCurrentDay = isToday(day);
            const isCurrentMonth = isSameMonth(day, month);
            const taskCount = getTaskCount(day);

            return (
              <Pressable
                key={day.toISOString()}
                style={[
                  styles.dayCell,
                  isSelected && { backgroundColor: COLORS.primary },
                  isCurrentDay && !isSelected && { backgroundColor: COLORS.primaryLight },
                ]}
                onPress={() => onSelectDate(day)}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    { color: COLORS.textPrimary },
                    !isCurrentMonth && { color: COLORS.textTertiary },
                    isSelected && { color: "#FFFFFF" },
                    isCurrentDay && !isSelected && { color: COLORS.primary, fontWeight: "700" },
                  ]}
                >
                  {format(day, "d")}
                </Text>

                {/* Task dots */}
                {taskCount > 0 && (
                  <View style={styles.dotsContainer}>
                    {taskCount <= 3 ? (
                      Array.from({ length: taskCount }, (_, i) => (
                        <View
                          key={i}
                          style={[
                            styles.dot,
                            { backgroundColor: COLORS.primary },
                            isSelected && { backgroundColor: "#FFFFFF" },
                            !isCurrentMonth && { backgroundColor: COLORS.textTertiary },
                          ]}
                        />
                      ))
                    ) : (
                      <>
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: COLORS.primary },
                            isSelected && { backgroundColor: "#FFFFFF" },
                            !isCurrentMonth && { backgroundColor: COLORS.textTertiary },
                          ]}
                        />
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: COLORS.primary },
                            isSelected && { backgroundColor: "#FFFFFF" },
                            !isCurrentMonth && { backgroundColor: COLORS.textTertiary },
                          ]}
                        />
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: COLORS.primary },
                            isSelected && { backgroundColor: "#FFFFFF" },
                            !isCurrentMonth && { backgroundColor: COLORS.textTertiary },
                          ]}
                        />
                      </>
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 8,
  },
  weekdayHeader: {
    flexDirection: "row",
    marginBottom: 8,
  },
  weekdayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
  },
  weekdayText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textTertiary,
  },
  weekRow: {
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    margin: 2,
  },
  dayCellSelected: {
    backgroundColor: COLORS.primary,
  },
  dayCellToday: {
    backgroundColor: "#EBF4FF",
  },
  dayNumber: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.textPrimary,
  },
  dayNumberOutside: {
    color: COLORS.textTertiary,
  },
  dayNumberSelected: {
    color: COLORS.surface,
  },
  dayNumberToday: {
    color: COLORS.primary,
    fontWeight: "700",
  },
  dotsContainer: {
    flexDirection: "row",
    marginTop: 2,
    gap: 2,
    height: 6,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  dotSelected: {
    backgroundColor: COLORS.surface,
  },
  dotOutside: {
    backgroundColor: COLORS.textTertiary,
  },
});
