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
import { Task, CalendarEvent } from "@/lib/types";
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
  calendarEvents?: CalendarEvent[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarMonthView({
  month,
  tasks,
  calendarEvents = [],
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

  // Count tasks and events per day, capped at 3 dots total
  const getDaySources = (date: Date): { taskCount: number; eventCount: number } => {
    const taskCount = tasks.filter(t => t.scheduled_start && isSameDay(parseISO(t.scheduled_start), date)).length;
    const eventCount = calendarEvents.filter(e => !e.all_day && isSameDay(parseISO(e.start_time), date)).length;
    // Cap: tasks fill first, events fill remaining slots up to 3 total
    const cappedTasks = Math.min(taskCount, 3);
    const cappedEvents = Math.min(eventCount, 3 - cappedTasks);
    return { taskCount: cappedTasks, eventCount: cappedEvents };
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
            const { taskCount, eventCount } = getDaySources(day);
            const totalDots = taskCount + eventCount;

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

                {totalDots > 0 && (
                  <View style={styles.dotsContainer}>
                    {Array.from({ length: taskCount }, (_, i) => (
                      <View
                        key={`t${i}`}
                        style={[
                          styles.dot,
                          { backgroundColor: isSelected ? "#FFFFFF" : (!isCurrentMonth ? COLORS.textTertiary : COLORS.primary) },
                        ]}
                      />
                    ))}
                    {Array.from({ length: eventCount }, (_, i) => (
                      <View
                        key={`e${i}`}
                        style={[
                          styles.dot,
                          { backgroundColor: isSelected ? "#FFFFFF" : (!isCurrentMonth ? COLORS.textTertiary : "#4285F4") },
                        ]}
                      />
                    ))}
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
