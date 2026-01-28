/**
 * Home Screen
 *
 * Shows user's tasks with NextUpCard and DayTimeline
 */

import { View, StyleSheet, ScrollView, RefreshControl, Pressable } from "react-native";
import { Text, Card, FAB, Chip, ActivityIndicator } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useCallback, useMemo } from "react";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { format, isToday, isTomorrow, isPast, parseISO } from "date-fns";
import { Task, CalendarEvent } from "@/lib/types";
import {
  isGoogleCalendarConnected,
  fetchGoogleCalendarEvents,
  getLocalCalendarEvents,
} from "@/lib/google-calendar";
import NextUpCard from "@/components/NextUpCard";
import DayTimeline from "@/components/DayTimeline";

// Collapsible section component
function CollapsibleSection({
  title,
  count,
  isExpanded,
  onToggle,
  variant = "default",
  children,
}: {
  title: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  variant?: "default" | "warning";
  children: React.ReactNode;
}) {
  return (
    <View style={styles.collapsibleSection}>
      <Pressable style={styles.collapsibleHeader} onPress={onToggle}>
        <View style={styles.collapsibleTitleRow}>
          <Text
            style={[
              styles.collapsibleTitle,
              variant === "warning" && styles.warningTitle,
            ]}
          >
            {title}
          </Text>
          <View
            style={[
              styles.countBadge,
              variant === "warning" && styles.warningBadge,
            ]}
          >
            <Text
              style={[
                styles.countText,
                variant === "warning" && styles.warningCountText,
              ]}
            >
              {count}
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={24}
          color={variant === "warning" ? "#ef4444" : "#64748b"}
        />
      </Pressable>
      {isExpanded && <View style={styles.collapsibleContent}>{children}</View>}
    </View>
  );
}

export default function HomeScreen() {
  const [displayName, setDisplayName] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overdueExpanded, setOverdueExpanded] = useState(true);
  const [pendingExpanded, setPendingExpanded] = useState(true);

  // Refresh data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      // Get user name
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name")
        .single();

      if (profile?.display_name) {
        setDisplayName(profile.display_name.split(" ")[0]); // First name only
      }

      // Get tasks
      const { data: tasksData, error } = await supabase
        .from("tasks")
        .select("*")
        .order("scheduled_start", { ascending: true, nullsFirst: false });

      if (error) throw error;
      setTasks(tasksData || []);

      // Load calendar events (sync if connected, otherwise load from cache)
      await loadCalendarEvents();
    } catch (error) {
      console.error("[Home] Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadCalendarEvents = async () => {
    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 14);

      const isConnected = await isGoogleCalendarConnected();

      if (isConnected) {
        // Sync with Google Calendar
        try {
          const events = await fetchGoogleCalendarEvents(startDate, endDate);
          setCalendarEvents(events);
        } catch (syncError) {
          console.warn("[Home] Calendar sync failed, using cache:", syncError);
          // Fall back to cached events
          const cachedEvents = await getLocalCalendarEvents(startDate, endDate);
          setCalendarEvents(cachedEvents);
        }
      } else {
        // Not connected, use any cached events
        const cachedEvents = await getLocalCalendarEvents(startDate, endDate);
        setCalendarEvents(cachedEvents);
      }
    } catch (error) {
      console.error("[Home] Error loading calendar events:", error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, []);

  // Group tasks
  const todayTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.scheduled_start &&
          isToday(new Date(t.scheduled_start)) &&
          t.status === "scheduled"
      ),
    [tasks]
  );

  const upcomingTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.scheduled_start &&
          !isToday(new Date(t.scheduled_start)) &&
          t.status === "scheduled"
      ),
    [tasks]
  );

  const pendingTasks = useMemo(
    () => tasks.filter((t) => t.status === "pending_schedule"),
    [tasks]
  );

  const overdueTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.due_date &&
          isPast(new Date(t.due_date)) &&
          t.status !== "completed"
      ),
    [tasks]
  );

  // Get next upcoming task (for NextUpCard)
  const nextTask = useMemo(() => {
    const now = new Date();
    const scheduledTasks = tasks
      .filter((t) => t.scheduled_start && t.status === "scheduled")
      .sort(
        (a, b) =>
          new Date(a.scheduled_start!).getTime() -
          new Date(b.scheduled_start!).getTime()
      );

    // Find the first task that hasn't ended yet
    return (
      scheduledTasks.find((t) => {
        const endTime = t.scheduled_end
          ? new Date(t.scheduled_end)
          : new Date(t.scheduled_start!);
        return endTime >= now;
      }) || null
    );
  }, [tasks]);

  // Filter today's calendar events
  const todayEvents = useMemo(
    () =>
      calendarEvents.filter((e) => isToday(parseISO(e.start_time))),
    [calendarEvents]
  );

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "#ef4444";
      case "medium":
        return "#f59e0b";
      default:
        return "#22c55e";
    }
  };

  const handleMarkDone = async (task: Task) => {
    try {
      await supabase
        .from("tasks")
        .update({ status: "completed" })
        .eq("id", task.id);
      loadData();
    } catch (error) {
      console.error("[Home] Error marking task done:", error);
    }
  };

  const handleReschedule = (task: Task) => {
    router.push(`/task/${task.id}`);
  };

  const handleTaskPress = (task: Task) => {
    router.push(`/task/${task.id}`);
  };

  const formatTaskTime = (start: string | null | undefined, end: string | null | undefined) => {
    if (!start) return "Not scheduled";
    const startDate = new Date(start);
    const timeStr = format(startDate, "h:mm a");
    if (isToday(startDate)) return `Today at ${timeStr}`;
    if (isTomorrow(startDate)) return `Tomorrow at ${timeStr}`;
    return format(startDate, "MMM d 'at' h:mm a");
  };

  const TaskCard = ({ task }: { task: Task }) => (
    <Card
      style={styles.taskCard}
      mode="outlined"
      onPress={() => router.push(`/task/${task.id}`)}
    >
      <Card.Content style={styles.taskContent}>
        <View style={styles.taskHeader}>
          <View style={[styles.priorityDot, { backgroundColor: getPriorityColor(task.priority) }]} />
          <Text variant="titleMedium" style={styles.taskTitle} numberOfLines={1}>
            {task.title}
          </Text>
        </View>
        <View style={styles.taskMeta}>
          <Text variant="bodySmall" style={styles.taskTime}>
            {formatTaskTime(task.scheduled_start, task.scheduled_end)}
          </Text>
          <Chip compact textStyle={styles.chipText} style={styles.durationChip}>
            {task.duration_minutes}m
          </Chip>
        </View>
      </Card.Content>
    </Card>
  );

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
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.title}>
          {getGreeting()}{displayName ? `, ${displayName}` : ""}
        </Text>
        <Text variant="bodyMedium" style={styles.date}>
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </Text>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Next Up Card */}
        {nextTask && (
          <View style={styles.section}>
            <NextUpCard
              task={nextTask}
              onMarkDone={() => handleMarkDone(nextTask)}
              onReschedule={() => handleReschedule(nextTask)}
              onPress={() => handleTaskPress(nextTask)}
            />
          </View>
        )}

        {/* Today's Timeline */}
        {(todayTasks.length > 0 || todayEvents.length > 0) && (
          <View style={styles.section}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Today's Schedule
            </Text>
            <DayTimeline
              tasks={todayTasks}
              calendarEvents={todayEvents}
              date={new Date()}
              onTaskPress={handleTaskPress}
            />
          </View>
        )}

        {/* Overdue Tasks - Collapsible */}
        {overdueTasks.length > 0 && (
          <CollapsibleSection
            title="Overdue"
            count={overdueTasks.length}
            isExpanded={overdueExpanded}
            onToggle={() => setOverdueExpanded(!overdueExpanded)}
            variant="warning"
          >
            {overdueTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </CollapsibleSection>
        )}

        {/* Pending Schedule - Collapsible */}
        {pendingTasks.length > 0 && (
          <CollapsibleSection
            title="Needs Scheduling"
            count={pendingTasks.length}
            isExpanded={pendingExpanded}
            onToggle={() => setPendingExpanded(!pendingExpanded)}
          >
            {pendingTasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </CollapsibleSection>
        )}

        {/* Upcoming Tasks */}
        {upcomingTasks.length > 0 && (
          <View style={styles.section}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Upcoming ({upcomingTasks.length})
            </Text>
            {upcomingTasks.slice(0, 5).map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
            {upcomingTasks.length > 5 && (
              <Pressable
                style={styles.viewMoreButton}
                onPress={() => router.push("/(tabs)/calendar")}
              >
                <Text style={styles.viewMoreText}>
                  View all in Calendar
                </Text>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={16}
                  color="#2563eb"
                />
              </Pressable>
            )}
          </View>
        )}

        {/* Empty State */}
        {tasks.length === 0 && (
          <Card style={styles.emptyCard}>
            <Card.Content style={styles.emptyContent}>
              <Text variant="titleLarge" style={styles.emptyTitle}>
                No tasks yet
              </Text>
              <Text variant="bodyMedium" style={styles.emptyText}>
                Create your first task and let AI find the best time for it.
              </Text>
            </Card.Content>
          </Card>
        )}

        {/* Spacer for FAB */}
        <View style={{ height: 80 }} />
      </ScrollView>

      <FAB
        icon="plus"
        style={styles.fab}
        onPress={() => router.push("/(tabs)/add-task")}
        label="Add Task"
      />
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
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  title: {
    fontWeight: "bold",
    marginBottom: 4,
  },
  date: {
    color: "#64748b",
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    marginBottom: 12,
    fontWeight: "600",
  },
  collapsibleSection: {
    marginBottom: 16,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    overflow: "hidden",
  },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  collapsibleTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  collapsibleTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1e293b",
  },
  warningTitle: {
    color: "#ef4444",
  },
  countBadge: {
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  warningBadge: {
    backgroundColor: "#fef2f2",
  },
  countText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748b",
  },
  warningCountText: {
    color: "#ef4444",
  },
  collapsibleContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  viewMoreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 4,
  },
  viewMoreText: {
    color: "#2563eb",
    fontWeight: "500",
  },
  taskCard: {
    marginBottom: 8,
    backgroundColor: "#ffffff",
  },
  taskContent: {
    paddingVertical: 12,
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  taskTitle: {
    flex: 1,
    fontWeight: "500",
  },
  taskMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  taskTime: {
    color: "#64748b",
  },
  durationChip: {
    height: 24,
  },
  chipText: {
    fontSize: 12,
  },
  emptyCard: {
    marginTop: 40,
    backgroundColor: "#ffffff",
  },
  emptyContent: {
    alignItems: "center",
    padding: 32,
  },
  emptyTitle: {
    marginBottom: 8,
    fontWeight: "600",
  },
  emptyText: {
    color: "#64748b",
    textAlign: "center",
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 16,
  },
});
