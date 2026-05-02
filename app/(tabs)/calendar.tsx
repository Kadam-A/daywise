/**
 * Calendar Screen
 *
 * Week and Month calendar views with task visualization
 */

import { View, StyleSheet, ScrollView, Pressable, Animated as RNAnimated } from "react-native";
import QuickAddSheet from "@/components/QuickAddSheet";
import {
  Text,
  SegmentedButtons,
  ActivityIndicator,
} from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useState, useCallback, useRef, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { safeUpdateCalendarEvent } from "@/lib/google-calendar";
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
import CalendarMonthView from "@/components/CalendarMonthView";
import CalendarDayList from "@/components/CalendarDayList";
import GoogleEventSheet from "@/components/GoogleEventSheet";
import DayTimeline from "@/components/DayTimeline";
import WeekTimeline, { DayCount } from "@/components/WeekTimeline";
import ErrorState from "@/components/ErrorState";
import { useAppColors } from "@/contexts/ThemeContext";
import { useGuidedTour } from "@/contexts/GuidedTourContext";
import { trackTaskRescheduled } from "@/lib/analytics";
import TourTooltip from "@/components/TourTooltip";
import TourPulseDot from "@/components/TourPulseDot";

const COLORS = {
  primary: "#4A90E2",
  secondary: "#7C6FBF",
  background: "#F8F9FB",
  surface: "#FFFFFF",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  success: "#5FBF73",
  warning: "#F5A962",
  error: "#E25555",
  border: "#E5E7EB",
};

type ViewMode = "day" | "week" | "month";

export default function CalendarScreen() {
  const appColors = useAppColors();
  const { tourStep, advanceTour, skipTour: _skipTour } = useGuidedTour();
  const skipTour = useCallback(() => _skipTour(tourStep), [_skipTour, tourStep]);
  // Ref so useFocusEffect can read tourStep without it as a dependency
  const tourStepRef = useRef(tourStep);
  useEffect(() => { tourStepRef.current = tourStep; }, [tourStep]);
  const params = useLocalSearchParams<{ date?: string; view?: string }>();
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentWeek, setCurrentWeek] = useState(
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [weekDayCount, setWeekDayCount] = useState<DayCount>(7);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // Undo toast state for drag-and-drop reschedule
  const [undoInfo, setUndoInfo] = useState<{
    task: Task;
    oldStart: string;
    oldEnd: string;
    oldDueDate: string | null;
    timeoutId?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const undoOpacity = useRef(new RNAnimated.Value(0)).current;

  // Load data on focus; apply navigation params (date/view) if provided.
  // tourStep intentionally excluded from deps — use ref to avoid re-running
  // the effect (and re-loading data) on every tour step change.
  useFocusEffect(
    useCallback(() => {
      loadData();
      if (params.date) {
        const target = new Date(params.date);
        setSelectedDate(target);
        setCurrentWeek(startOfWeek(target, { weekStartsOn: 1 }));
        setCurrentMonth(startOfMonth(target));
      }
      if (params.view === "day" || params.view === "week" || params.view === "month") {
        setViewMode(params.view);
      } else if (tourStepRef.current === "tour_calendar_views") {
        // Start in day view during tour so the Week tab pulse dot is visible
        setViewMode("day");
      }
    }, [params.date, params.view])
  );


  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get tasks
      const { data: tasksData, error: tasksError } = await supabase
        .from("tasks")
        .select("*")
        .in("status", ["scheduled", "pending_schedule"])
        .order("scheduled_start", { ascending: true, nullsFirst: false });

      if (tasksError) {
        throw new Error("Failed to load tasks. Please check your connection.");
      }
      setTasks(tasksData || []);

      // Get calendar events (next 60 days)
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7); // Include past week
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 60);

      const events = await getLocalCalendarEvents(startDate, endDate);
      setCalendarEvents(events);
    } catch (err) {
      console.error("[Calendar] Error loading data:", err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrevious = () => {
    if (viewMode === "day") {
      setSelectedDate(subDays(selectedDate, 1));
    } else if (viewMode === "week") {
      setCurrentWeek(subDays(currentWeek, weekDayCount));
    } else {
      setCurrentMonth(subMonths(currentMonth, 1));
    }
  };

  const handleNext = () => {
    if (viewMode === "day") {
      setSelectedDate(addDays(selectedDate, 1));
    } else if (viewMode === "week") {
      setCurrentWeek(addDays(currentWeek, weekDayCount));
    } else {
      setCurrentMonth(addMonths(currentMonth, 1));
    }
  };

  const handleToday = () => {
    const today = new Date();
    setSelectedDate(today);
    if (weekDayCount === 3) {
      setCurrentWeek(subDays(today, 1)); // Center today in 3-day view
    } else {
      setCurrentWeek(startOfWeek(today, { weekStartsOn: 1 }));
    }
    setCurrentMonth(startOfMonth(today));
  };

  const handleDayCountChange = (count: DayCount) => {
    if (count === 3) {
      // Switch to 3-day: center on the first day of the current week view
      setCurrentWeek(addDays(currentWeek, 1));
    } else {
      // Switch to 7-day: snap to Monday of the week containing currentWeek
      setCurrentWeek(startOfWeek(currentWeek, { weekStartsOn: 1 }));
    }
    setWeekDayCount(count);
  };

  const handleTaskPress = (task: Task) => {
    router.push(`/task/${task.id}`);
  };

  const handleTaskReschedule = async (task: Task, newStart: string, newEnd: string) => {
    const newDueDate = format(new Date(newStart), "yyyy-MM-dd");

    // Optimistic UI update
    setTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? { ...t, scheduled_start: newStart, scheduled_end: newEnd, due_date: newDueDate }
          : t
      )
    );

    // Show undo toast
    if (undoInfo?.timeoutId) clearTimeout(undoInfo.timeoutId);
    const timeoutId = setTimeout(() => {
      RNAnimated.timing(undoOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setUndoInfo(null));
    }, 4000);

    setUndoInfo({
      task: { ...task, scheduled_start: newStart, scheduled_end: newEnd, due_date: newDueDate },
      oldStart: task.scheduled_start!,
      oldEnd: task.scheduled_end!,
      oldDueDate: task.due_date || null,
      timeoutId,
    });
    RNAnimated.timing(undoOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();

    // Update Supabase
    try {
      await supabase
        .from("tasks")
        .update({
          scheduled_start: newStart,
          scheduled_end: newEnd,
          due_date: newDueDate,
        })
        .eq("id", task.id);

      trackTaskRescheduled('drag'); // fire-and-forget

      // Update Google Calendar if connected
      if (task.google_event_id) {
        await safeUpdateCalendarEvent(
          task.google_event_id,
          task.title,
          task.description,
          newStart,
          newEnd
        );
      }
    } catch (err) {
      console.error("[Calendar] Reschedule error:", err);
      // Revert on error
      setTasks(prev =>
        prev.map(t =>
          t.id === task.id
            ? { ...t, scheduled_start: task.scheduled_start, scheduled_end: task.scheduled_end, due_date: task.due_date }
            : t
        )
      );
    }
  };

  const handleUndo = async () => {
    if (!undoInfo) return;
    if (undoInfo.timeoutId) clearTimeout(undoInfo.timeoutId);

    const { task, oldStart, oldEnd, oldDueDate } = undoInfo;

    // Revert UI
    setTasks(prev =>
      prev.map(t =>
        t.id === task.id
          ? { ...t, scheduled_start: oldStart, scheduled_end: oldEnd, due_date: oldDueDate }
          : t
      )
    );

    RNAnimated.timing(undoOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setUndoInfo(null));

    // Revert Supabase
    try {
      await supabase
        .from("tasks")
        .update({
          scheduled_start: oldStart,
          scheduled_end: oldEnd,
          due_date: oldDueDate,
        })
        .eq("id", task.id);

      if (task.google_event_id) {
        await safeUpdateCalendarEvent(
          task.google_event_id,
          task.title,
          task.description,
          oldStart,
          oldEnd
        );
      }
    } catch (err) {
      console.error("[Calendar] Undo error:", err);
    }
  };

  const getHeaderTitle = () => {
    if (viewMode === "day") {
      return format(selectedDate, "EEEE, MMM d");
    } else if (viewMode === "week") {
      if (weekDayCount === 3) {
        const endDate = addDays(currentWeek, 2);
        return `${format(currentWeek, "MMM d")} – ${format(endDate, "MMM d")}`;
      }
      return format(currentWeek, "MMMM yyyy");
    }
    return format(currentMonth, "MMMM yyyy");
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={["top"]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={appColors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={["top"]}>
        <View style={styles.errorContainer}>
          <ErrorState
            title="Couldn't load calendar"
            message={error}
            onRetry={loadData}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={["top"]}>
      {/* Navigation */}
      <View style={[styles.navigation, { backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
        <View style={styles.navRow}>
          <Pressable style={[styles.navArrow, { backgroundColor: appColors.background }]} onPress={handlePrevious}>
            <MaterialCommunityIcons name="chevron-left" size={24} color={appColors.textPrimary} />
          </Pressable>
          <Pressable onPress={handleToday}>
            <Text style={[styles.navTitle, { color: appColors.textPrimary }]}>{getHeaderTitle()}</Text>
          </Pressable>
          <Pressable style={[styles.navArrow, { backgroundColor: appColors.background }]} onPress={handleNext}>
            <MaterialCommunityIcons name="chevron-right" size={24} color={appColors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.navActions}>
          <Pressable style={[styles.todayPill, { backgroundColor: appColors.primaryLight }]} onPress={handleToday}>
            <View style={[styles.todayDot, { backgroundColor: appColors.primary }]} />
            <Text style={[styles.todayPillText, { color: appColors.textPrimary }]}>Today</Text>
          </Pressable>
          <View style={{ position: 'relative', flex: 1 }}>
          {tourStep === "tour_calendar_views" && (
            <View style={{ position: 'absolute', top: -4, left: '50%', marginLeft: -4, zIndex: 10 }}>
              <TourPulseDot visible color={appColors.primary} size={8} />
            </View>
          )}
          <SegmentedButtons
            value={viewMode}
            onValueChange={(value) => {
              const next = value as ViewMode;
              // Sync date state so position is preserved when switching views
              if (next === "day") {
                // Entering day view: jump to first day of the current week view
                setSelectedDate(viewMode === "week" ? currentWeek : selectedDate);
              } else if (next === "week") {
                // Entering week view: snap to the week containing the current day/month position
                const anchor = viewMode === "day" ? selectedDate : currentMonth;
                const monday = startOfWeek(anchor, { weekStartsOn: 1 });
                if (weekDayCount === 3) {
                  setCurrentWeek(addDays(monday, 1));
                } else {
                  setCurrentWeek(monday);
                }
              } else if (next === "month") {
                // Entering month view: show the month containing the current week/day
                const anchor = viewMode === "day" ? selectedDate : currentWeek;
                setCurrentMonth(startOfMonth(anchor));
              }
              setViewMode(next);
              if (tourStep === "tour_calendar_views") advanceTour("tour_calendar_drag");
            }}
            buttons={[
              { value: "day", label: "Day", style: { borderColor: appColors.border } },
              { value: "week", label: "Week", style: { borderColor: appColors.border } },
              { value: "month", label: "Month", style: { borderColor: appColors.border } },
            ]}
            style={styles.viewToggle}
            density="small"
            theme={{
              colors: {
                secondaryContainer: appColors.primaryLight,
                onSecondaryContainer: appColors.primary,
                onSurface: appColors.textSecondary,
                outline: appColors.border,
              },
            }}
          />
          </View>
        </View>
      </View>

      {/* Day Timeline View - NOT inside ScrollView to avoid nesting issues */}
      {viewMode === "day" && (
        <View style={styles.dayTimelineWrapper}>
          <DayTimeline
            key={`day-${selectedDate.toISOString()}`}
            tasks={tasks}
            calendarEvents={calendarEvents}
            date={selectedDate}
            onTaskPress={handleTaskPress}
            onTaskReschedule={handleTaskReschedule}
            onEventPress={setSelectedCalendarEvent}
            autoScrollToNow={true}
          />
        </View>
      )}

      {/* Week Timeline View */}
      {viewMode === "week" && (
        <View style={styles.weekTimelineWrapper}>
          <WeekTimeline
            key={`week-${currentWeek.toISOString()}-${weekDayCount}`}
            weekStart={currentWeek}
            tasks={tasks}
            calendarEvents={calendarEvents}
            onTaskPress={handleTaskPress}
            onTaskReschedule={handleTaskReschedule}
            onEventPress={setSelectedCalendarEvent}
            dayCount={weekDayCount}
            onDayCountChange={handleDayCountChange}
          />
        </View>
      )}

      {/* Month Calendar View */}
      {viewMode === "month" && (
        <ScrollView style={styles.content}>
          <View style={styles.calendarContainer}>
            <CalendarMonthView
              month={currentMonth}
              tasks={tasks}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          </View>
          <View style={styles.dayListContainer}>
            <CalendarDayList
              date={selectedDate}
              tasks={tasks}
              calendarEvents={calendarEvents}
              onTaskPress={handleTaskPress}
              onEventPress={setSelectedCalendarEvent}
            />
          </View>
        </ScrollView>
      )}

      {/* Undo toast for drag-and-drop reschedule */}
      {undoInfo && (
        <RNAnimated.View style={[
          styles.undoToast,
          { opacity: undoOpacity },
          tourStep !== null && { bottom: 240, zIndex: 1001 },
        ]}>
          <MaterialCommunityIcons name="calendar-check" size={18} color="#FFFFFF" />
          <Text style={styles.undoToastText} numberOfLines={1}>
            Moved to {format(new Date(undoInfo.task.scheduled_start!), "h:mm a")}
          </Text>
          <Pressable onPress={handleUndo} style={styles.undoButton}>
            <Text style={styles.undoButtonText}>Undo</Text>
          </Pressable>
        </RNAnimated.View>
      )}

      {/* FAB */}
      <Pressable style={styles.fabWrapper} onPress={() => setShowQuickAdd(true)}>
        <View style={[styles.fab, { backgroundColor: appColors.primary, shadowColor: appColors.primary }]}>
          <MaterialCommunityIcons name="plus" size={28} color="#FFFFFF" />
        </View>
      </Pressable>

      {/* Quick Add Sheet */}
      <QuickAddSheet
        visible={showQuickAdd}
        onDismiss={() => setShowQuickAdd(false)}
        onCreated={() => { setShowQuickAdd(false); loadData(); }}
        preselectedDate={viewMode === "month" ? selectedDate : undefined}
      />

      <GoogleEventSheet
        event={selectedCalendarEvent}
        onDismiss={() => setSelectedCalendarEvent(null)}
        onUpdated={loadData}
      />

      {/* Tour Tooltips */}
      <TourTooltip
        visible={tourStep === "tour_calendar_views"}
        icon="calendar-blank-outline"
        iconColor={appColors.primary}
        title="Your complete schedule"
        body="Every task sits at its scheduled slot. Day shows a timeline, Week gives a 7-day overview. Tap Week to try it."
        ctaLabel="Got it"
        onCta={() => {
          setViewMode("week");
          advanceTour("tour_calendar_drag");
        }}
        onSkip={skipTour}
        showSkip
      />
      <TourTooltip
        visible={tourStep === "tour_calendar_drag"}
        icon="cursor-move"
        iconColor={appColors.secondary}
        title="Drag to reschedule"
        body="Press and hold any task block, then drag it to a new time. An undo toast lets you reverse it instantly."
        ctaLabel="Got it"
        position="top"
        topOffset={60}
        onCta={() => {
          advanceTour("tour_settings_intro");
          router.push("/(tabs)/settings");
        }}
        onSkip={skipTour}
        showSkip
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  header: {
    padding: 24,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: COLORS.surface,
  },
  title: {
    fontWeight: "bold",
    color: COLORS.textPrimary,
  },
  navigation: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  navArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.background,
  },
  navTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.textPrimary,
    minWidth: 150,
    textAlign: "center",
  },
  navActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    marginTop: 12,
  },
  todayPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.background,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  todayDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
  },
  todayPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textPrimary,
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
    paddingBottom: 80,
  },
  dayTimelineWrapper: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 10,
  },
  weekTimelineWrapper: {
    flex: 1,
    marginHorizontal: 8,
    marginTop: 12,
    marginBottom: 10,
  },
  undoToast: {
    position: "absolute",
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1A1D23",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  undoToastText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: "#FFFFFF",
  },
  undoButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
  },
  undoButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  fabWrapper: {
    position: "absolute",
    right: 20,
    bottom: 24,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
});
