/**
 * Home Screen
 *
 * Shows user's tasks with NextUpCard and DayTimeline
 */

import { View, StyleSheet, ScrollView, RefreshControl, Pressable } from "react-native";
import { Text, Card, FAB, Chip, ActivityIndicator, ProgressBar, Searchbar } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useCallback, useMemo } from "react";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { format, isToday, isTomorrow, isPast, isFuture, parseISO, startOfDay, endOfDay, isBefore } from "date-fns";
import { Task, CalendarEvent } from "@/lib/types";
import {
  isGoogleCalendarConnected,
  fetchGoogleCalendarEvents,
  getLocalCalendarEvents,
} from "@/lib/google-calendar";
import NextUpCard from "@/components/NextUpCard";
import DayTimeline from "@/components/DayTimeline";
import { isRecurringInstance } from "@/lib/recurrence";

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
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Get all unique tags from tasks
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    tasks.forEach((task) => {
      if (task.tags) {
        task.tags.forEach((tag) => tagSet.add(tag));
      }
    });
    return Array.from(tagSet).sort();
  }, [tasks]);

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

      // Trigger auto-reschedule for any overdue tasks (handles offline reconnection)
      triggerAutoReschedule();

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

  // Trigger auto-reschedule Edge Function (fire and forget)
  const triggerAutoReschedule = async () => {
    try {
      await supabase.functions.invoke("auto-reschedule");
      console.log("[Home] Auto-reschedule triggered");
    } catch (error) {
      // Silent fail - cron job will handle it eventually
      console.log("[Home] Auto-reschedule trigger failed (will retry via cron)");
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

  // Filter out subtasks - only show parent tasks in main lists
  // Also apply tag filter and search query
  const parentTasks = useMemo(
    () =>
      tasks.filter((t) => {
        if (t.parent_task_id) return false; // Exclude subtasks
        if (selectedTag && (!t.tags || !t.tags.includes(selectedTag))) return false;
        // Apply search filter
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase();
          const matchesTitle = t.title.toLowerCase().includes(query);
          const matchesDescription = t.description?.toLowerCase().includes(query);
          const matchesTags = t.tags?.some((tag) => tag.toLowerCase().includes(query));
          if (!matchesTitle && !matchesDescription && !matchesTags) return false;
        }
        return true;
      }),
    [tasks, selectedTag, searchQuery]
  );

  // Check if we're in search mode
  const isSearching = searchQuery.trim().length > 0;

  // Get subtasks for a parent task
  const getSubtasks = (parentId: string) =>
    tasks.filter((t) => t.parent_task_id === parentId);

  // Get subtask progress for a parent task
  const getSubtaskProgress = (parentId: string) => {
    const subtasks = getSubtasks(parentId);
    if (subtasks.length === 0) return null;
    const completed = subtasks.filter((s) => s.status === "completed").length;
    return { completed, total: subtasks.length };
  };

  // Group tasks (using parent tasks only)

  // Overdue: tasks with due_date fully passed OR scheduled end time has passed
  const overdueTasks = useMemo(
    () => {
      const todayStart = startOfDay(new Date());

      return parentTasks.filter((t) => {
        if (t.status === "completed" || t.status === "cancelled") return false;

        // Due date has fully passed (due date is before today, not including today)
        // e.g., if due_date is Jan 28 and today is Jan 29, it's overdue
        if (t.due_date && isBefore(new Date(t.due_date), todayStart)) return true;

        // Scheduled time passed (task was scheduled but the scheduled END time has passed)
        if (t.scheduled_end && isPast(new Date(t.scheduled_end)) && t.status === "scheduled") return true;

        return false;
      });
    },
    [parentTasks]
  );

  // Get IDs of overdue tasks to exclude from other sections
  const overdueIds = useMemo(() => new Set(overdueTasks.map((t) => t.id)), [overdueTasks]);

  const todayTasks = useMemo(
    () =>
      parentTasks.filter(
        (t) =>
          t.scheduled_start &&
          isToday(new Date(t.scheduled_start)) &&
          t.status === "scheduled" &&
          !overdueIds.has(t.id) // Exclude overdue
      ),
    [parentTasks, overdueIds]
  );

  const upcomingTasks = useMemo(
    () =>
      parentTasks.filter(
        (t) =>
          t.scheduled_start &&
          isFuture(startOfDay(new Date(t.scheduled_start))) && // Must be in future (not today)
          !isToday(new Date(t.scheduled_start)) &&
          t.status === "scheduled" &&
          !overdueIds.has(t.id) // Exclude overdue
      ),
    [parentTasks, overdueIds]
  );

  const pendingTasks = useMemo(
    () => parentTasks.filter(
      (t) => t.status === "pending_schedule" && !overdueIds.has(t.id) // Exclude overdue
    ),
    [parentTasks, overdueIds]
  );

  // Get next upcoming task (for NextUpCard) - exclude subtasks and overdue
  const nextTask = useMemo(() => {
    const now = new Date();
    const scheduledTasks = parentTasks
      .filter((t) =>
        t.scheduled_start &&
        t.status === "scheduled" &&
        !overdueIds.has(t.id) // Exclude overdue tasks
      )
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
  }, [parentTasks, overdueIds]);

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

  const TaskCard = ({ task }: { task: Task }) => {
    const progress = getSubtaskProgress(task.id);

    return (
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
            {/* Recurring indicator */}
            {(task.is_recurring || isRecurringInstance(task)) && (
              <MaterialCommunityIcons
                name="repeat"
                size={16}
                color="#0369a1"
                style={styles.recurringIcon}
              />
            )}
          </View>

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <View style={styles.taskTags}>
              {task.tags.slice(0, 2).map((tag, index) => (
                <View key={tag} style={[styles.tagBadge, index > 0 && { marginLeft: 6 }]}>
                  <Text style={styles.tagBadgeText}>{tag}</Text>
                </View>
              ))}
              {task.tags.length > 2 && (
                <Text style={styles.moreTagsText}>+{task.tags.length - 2}</Text>
              )}
            </View>
          )}

          {/* Subtask progress indicator */}
          {progress && (
            <View style={styles.subtaskProgressContainer}>
              <ProgressBar
                progress={progress.completed / progress.total}
                color="#4caf50"
                style={styles.subtaskProgressBar}
              />
              <Text style={styles.subtaskProgressText}>
                {progress.completed}/{progress.total} subtasks
              </Text>
            </View>
          )}

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

      {/* Search Bar */}
      <Searchbar
        placeholder="Search tasks..."
        onChangeText={setSearchQuery}
        value={searchQuery}
        style={styles.searchBar}
        inputStyle={styles.searchInput}
      />

      {/* Tag Filter */}
      {allTags.length > 0 && !isSearching && (
        <View style={styles.tagFilterContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tagFilterContent}
          >
            <Pressable
              style={[styles.filterChip, selectedTag === null && styles.filterChipSelected]}
              onPress={() => setSelectedTag(null)}
            >
              <Text style={[styles.filterChipText, selectedTag === null && styles.filterChipTextSelected]}>
                All
              </Text>
            </Pressable>
            {allTags.map((tag) => (
              <Pressable
                key={tag}
                style={[styles.filterChip, selectedTag === tag && styles.filterChipSelected]}
                onPress={() => setSelectedTag(selectedTag === tag ? null : tag)}
              >
                <Text style={[styles.filterChipText, selectedTag === tag && styles.filterChipTextSelected]}>
                  {tag}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Search Results */}
        {isSearching ? (
          <View style={styles.section}>
            <Text variant="titleMedium" style={styles.sectionTitle}>
              Search Results ({parentTasks.length})
            </Text>
            {parentTasks.length === 0 ? (
              <View style={styles.searchEmptyState}>
                <MaterialCommunityIcons
                  name="magnify"
                  size={48}
                  color="#cbd5e1"
                />
                <Text style={styles.searchEmptyText}>
                  No tasks found for "{searchQuery}"
                </Text>
              </View>
            ) : (
              parentTasks.map((task) => <TaskCard key={task.id} task={task} />)
            )}
          </View>
        ) : (
          <>
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

            {/* Empty State - No Tasks */}
            {tasks.length === 0 && (
              <View style={styles.emptyStateContainer}>
                <MaterialCommunityIcons
                  name="clipboard-check-outline"
                  size={64}
                  color="#cbd5e1"
                />
                <Text variant="titleLarge" style={styles.emptyTitle}>
                  No tasks yet
                </Text>
                <Text variant="bodyMedium" style={styles.emptyText}>
                  Create your first task and let AI find the best time for it.
                </Text>
                <Pressable
                  style={styles.emptyActionButton}
                  onPress={() => router.push("/(tabs)/add-task")}
                >
                  <MaterialCommunityIcons name="plus" size={20} color="#ffffff" />
                  <Text style={styles.emptyActionText}>Create Task</Text>
                </Pressable>
              </View>
            )}

        {/* Empty State - No scheduled tasks today but has tasks */}
            {tasks.length > 0 && todayTasks.length === 0 && todayEvents.length === 0 && !nextTask && (
              <View style={styles.todayEmptyState}>
                <MaterialCommunityIcons
                  name="calendar-blank"
                  size={40}
                  color="#94a3b8"
                />
                <Text style={styles.todayEmptyText}>
                  Nothing scheduled for today
                </Text>
                <Text style={styles.todayEmptySubtext}>
                  {pendingTasks.length > 0
                    ? `You have ${pendingTasks.length} task${pendingTasks.length > 1 ? "s" : ""} waiting to be scheduled`
                    : "Add a task to get started"}
                </Text>
              </View>
            )}
          </>
        )}

        {/* Spacer for FAB and tab bar */}
        <View style={{ height: 100 }} />
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
  searchBar: {
    marginHorizontal: 16,
    marginVertical: 8,
    elevation: 0,
    backgroundColor: "#f1f5f9",
  },
  searchInput: {
    fontSize: 14,
  },
  searchEmptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  searchEmptyText: {
    marginTop: 12,
    color: "#64748b",
    fontSize: 15,
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
  recurringIcon: {
    marginLeft: 8,
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
    height: "auto",
    paddingVertical: 2,
  },
  chipText: {
    fontSize: 12,
  },
  subtaskProgressContainer: {
    marginBottom: 8,
  },
  subtaskProgressBar: {
    height: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  subtaskProgressText: {
    fontSize: 11,
    color: "#64748b",
  },
  // Tag filter styles
  tagFilterContainer: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  tagFilterContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f1f5f9",
    marginRight: 8,
  },
  filterChipSelected: {
    backgroundColor: "#2563eb",
  },
  filterChipText: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "500",
  },
  filterChipTextSelected: {
    color: "#ffffff",
  },
  // Task tag styles
  taskTags: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  tagBadge: {
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  tagBadgeText: {
    fontSize: 10,
    color: "#0369a1",
    fontWeight: "500",
  },
  moreTagsText: {
    fontSize: 11,
    color: "#64748b",
    marginLeft: 6,
  },
  emptyStateContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    marginTop: 16,
    marginBottom: 8,
    fontWeight: "600",
    color: "#1e293b",
  },
  emptyText: {
    color: "#64748b",
    textAlign: "center",
    marginBottom: 24,
  },
  emptyActionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2563eb",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  emptyActionText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 16,
  },
  todayEmptyState: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    marginBottom: 16,
  },
  todayEmptyText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: "500",
    color: "#64748b",
  },
  todayEmptySubtext: {
    marginTop: 4,
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 16,
  },
});
