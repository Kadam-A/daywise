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
    <View style={styles.container}>
      {/* Weekday headers */}
      <View style={styles.weekdayHeader}>
        {WEEKDAYS.map((day) => (
          <View key={day} style={styles.weekdayCell}>
            <Text style={styles.weekdayText}>{day}</Text>
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
                  isSelected && styles.dayCellSelected,
                  isCurrentDay && !isSelected && styles.dayCellToday,
                ]}
                onPress={() => onSelectDate(day)}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    !isCurrentMonth && styles.dayNumberOutside,
                    isSelected && styles.dayNumberSelected,
                    isCurrentDay && !isSelected && styles.dayNumberToday,
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
                            isSelected && styles.dotSelected,
                            !isCurrentMonth && styles.dotOutside,
                          ]}
                        />
                      ))
                    ) : (
                      <>
                        <View
                          style={[
                            styles.dot,
                            isSelected && styles.dotSelected,
                            !isCurrentMonth && styles.dotOutside,
                          ]}
                        />
                        <View
                          style={[
                            styles.dot,
                            isSelected && styles.dotSelected,
                            !isCurrentMonth && styles.dotOutside,
                          ]}
                        />
                        <View
                          style={[
                            styles.dot,
                            isSelected && styles.dotSelected,
                            !isCurrentMonth && styles.dotOutside,
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
    backgroundColor: "#ffffff",
    borderRadius: 12,
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
    color: "#94a3b8",
  },
  weekRow: {
    flexDirection: "row",
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    margin: 2,
  },
  dayCellSelected: {
    backgroundColor: "#2563eb",
  },
  dayCellToday: {
    backgroundColor: "#eff6ff",
  },
  dayNumber: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1e293b",
  },
  dayNumberOutside: {
    color: "#cbd5e1",
  },
  dayNumberSelected: {
    color: "#ffffff",
  },
  dayNumberToday: {
    color: "#2563eb",
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
    backgroundColor: "#2563eb",
  },
  dotSelected: {
    backgroundColor: "#ffffff",
  },
  dotOutside: {
    backgroundColor: "#cbd5e1",
  },
});
