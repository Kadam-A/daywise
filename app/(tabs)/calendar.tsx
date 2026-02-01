/**
 * Calendar Screen
 *
 * Week and Month calendar views with task visualization
 */

import { View, StyleSheet, ScrollView } from "react-native";
import {
  Text,
  SegmentedButtons,
  IconButton,
  ActivityIndicator,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import {
  format,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  startOfWeek,
  startOfMonth,
} from "date-fns";
import { Task, CalendarEvent } from "@/lib/types";
import { getLocalCalendarEvents } from "@/lib/google-calendar";
import CalendarWeekView from "@/components/CalendarWeekView";
import CalendarMonthView from "@/components/CalendarMonthView";
import CalendarDayList from "@/components/CalendarDayList";
import DayTimeline from "@/components/DayTimeline";

type ViewMode = "day" | "week" | "month";

export default function CalendarScreen() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentWeek, setCurrentWeek] = useState(
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));

  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Load data on focus
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      setLoading(true);

      // Get tasks
      const { data: tasksData, error } = await supabase
        .from("tasks")
        .select("*")
        .in("status", ["scheduled", "pending_schedule"])
        .order("scheduled_start", { ascending: true, nullsFirst: false });

      if (error) throw error;
      setTasks(tasksData || []);

      // Get calendar events (next 60 days)
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7); // Include past week
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 60);

      const events = await getLocalCalendarEvents(startDate, endDate);
      setCalendarEvents(events);
    } catch (error) {
      console.error("[Calendar] Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePrevious = () => {
    if (viewMode === "day") {
      setSelectedDate(subDays(selectedDate, 1));
    } else if (viewMode === "week") {
      setCurrentWeek(subWeeks(currentWeek, 1));
    } else {
      setCurrentMonth(subMonths(currentMonth, 1));
    }
  };

  const handleNext = () => {
    if (viewMode === "day") {
      setSelectedDate(addDays(selectedDate, 1));
    } else if (viewMode === "week") {
      setCurrentWeek(addWeeks(currentWeek, 1));
    } else {
      setCurrentMonth(addMonths(currentMonth, 1));
    }
  };

  const handleToday = () => {
    const today = new Date();
    setSelectedDate(today);
    setCurrentWeek(startOfWeek(today, { weekStartsOn: 1 }));
    setCurrentMonth(startOfMonth(today));
  };

  const handleTaskPress = (task: Task) => {
    router.push(`/task/${task.id}`);
  };

  const getHeaderTitle = () => {
    if (viewMode === "day") {
      return format(selectedDate, "EEEE, MMM d");
    } else if (viewMode === "week") {
      return format(currentWeek, "MMMM yyyy");
    }
    return format(currentMonth, "MMMM yyyy");
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.title}>
          Calendar
        </Text>
      </View>

      {/* Navigation */}
      <View style={styles.navigation}>
        <View style={styles.navRow}>
          <IconButton
            icon="chevron-left"
            size={24}
            onPress={handlePrevious}
          />
          <Text style={styles.navTitle}>{getHeaderTitle()}</Text>
          <IconButton icon="chevron-right" size={24} onPress={handleNext} />
        </View>

        <View style={styles.navActions}>
          <IconButton
            icon="calendar-today"
            size={20}
            onPress={handleToday}
            style={styles.todayButton}
          />
          <SegmentedButtons
            value={viewMode}
            onValueChange={(value) => setViewMode(value as ViewMode)}
            buttons={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
            style={styles.viewToggle}
            density="small"
          />
        </View>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={viewMode === "day" ? styles.dayViewContent : undefined}>
        {/* Day Timeline View */}
        {viewMode === "day" && (
          <View style={styles.dayTimelineContainer}>
            <DayTimeline
              key={`day-${selectedDate.toISOString()}`}
              tasks={tasks}
              calendarEvents={calendarEvents}
              date={selectedDate}
              onTaskPress={handleTaskPress}
              autoScrollToNow={true}
            />
          </View>
        )}

        {/* Week/Month Calendar View */}
        {viewMode !== "day" && (
          <>
            <View style={styles.calendarContainer}>
              {viewMode === "week" ? (
                <CalendarWeekView
                  weekStart={currentWeek}
                  tasks={tasks}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                />
              ) : (
                <CalendarMonthView
                  month={currentMonth}
                  tasks={tasks}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                />
              )}
            </View>

            {/* Day List */}
            <View style={styles.dayListContainer}>
              <CalendarDayList
                date={selectedDate}
                tasks={tasks}
                calendarEvents={calendarEvents}
                onTaskPress={handleTaskPress}
              />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    padding: 24,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: "#ffffff",
  },
  title: {
    fontWeight: "bold",
  },
  navigation: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1e293b",
    minWidth: 150,
    textAlign: "center",
  },
  navActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    marginTop: 8,
  },
  todayButton: {
    margin: 0,
  },
  viewToggle: {
    flex: 1,
    marginLeft: 12,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  calendarContainer: {
    marginBottom: 16,
  },
  dayListContainer: {
    flex: 1,
  },
  dayViewContent: {
    flexGrow: 1,
  },
  dayTimelineContainer: {
    flex: 1,
    minHeight: 500,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    overflow: "hidden",
  },
});
