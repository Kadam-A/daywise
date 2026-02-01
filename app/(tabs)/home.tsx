/**
 * Home Screen - "Fluid Intelligence" Design
 *
 * AI-powered task dashboard with organic visual language
 * that feels alive and responsive to the user's day
 */

import { View, StyleSheet, ScrollView, RefreshControl, Pressable, Animated, Dimensions } from "react-native";
import { Text, FAB, ActivityIndicator, ProgressBar, Surface } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { format, isToday, isTomorrow, isPast, isFuture, parseISO, startOfDay, isBefore, differenceInMinutes, isWithinInterval } from "date-fns";
import { Task, CalendarEvent } from "@/lib/types";
import {
  isGoogleCalendarConnected,
  fetchGoogleCalendarEvents,
  getLocalCalendarEvents,
} from "@/lib/google-calendar";
import { isRecurringInstance } from "@/lib/recurrence";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Design System Constants
const COLORS = {
  // Primary gradient
  gradientStart: "#4A90E2",
  gradientEnd: "#7C6FBF",

  // Surfaces
  background: "#F8F9FB",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",

  // Text
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",

  // Priority
  priorityHigh: "#E25555",
  priorityMedium: "#F5A962",
  priorityLow: "#5FBF73",

  // States
  success: "#5FBF73",
  warning: "#F5A962",
  error: "#E25555",
  info: "#62C4D8",

  // AI accent
  aiPurple: "#7C6FBF",
  aiPurpleLight: "#E8E5F5",
};

// Animated Welcome Card with AI gradient
function WelcomeCard({ displayName, taskStats }: { displayName: string; taskStats: { today: number; completed: number; upcoming: number } }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  };

  const getMotivationalText = () => {
    if (taskStats.today === 0) return "Your day is clear. Time to add some goals!";
    if (taskStats.completed === taskStats.today) return "Amazing! All tasks completed today!";
    if (taskStats.completed > 0) return `${taskStats.completed} of ${taskStats.today} tasks done today`;
    return `${taskStats.today} task${taskStats.today > 1 ? "s" : ""} scheduled for today`;
  };

  return (
    <Animated.View style={[styles.welcomeCardWrapper, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <LinearGradient
        colors={[COLORS.gradientStart, COLORS.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.welcomeCard}
      >
        {/* Decorative circles */}
        <View style={styles.decorativeCircle1} />
        <View style={styles.decorativeCircle2} />

        <View style={styles.welcomeContent}>
          <Text style={styles.welcomeGreeting}>
            {getGreeting()}{displayName ? `, ${displayName}` : ""}
          </Text>
          <Text style={styles.welcomeDate}>
            {format(new Date(), "EEEE, MMMM d")}
          </Text>
          <View style={styles.welcomeStats}>
            <View style={styles.welcomeStatItem}>
              <Text style={styles.welcomeStatNumber}>{taskStats.today}</Text>
              <Text style={styles.welcomeStatLabel}>Today</Text>
            </View>
            <View style={styles.welcomeStatDivider} />
            <View style={styles.welcomeStatItem}>
              <Text style={styles.welcomeStatNumber}>{taskStats.completed}</Text>
              <Text style={styles.welcomeStatLabel}>Done</Text>
            </View>
            <View style={styles.welcomeStatDivider} />
            <View style={styles.welcomeStatItem}>
              <Text style={styles.welcomeStatNumber}>{taskStats.upcoming}</Text>
              <Text style={styles.welcomeStatLabel}>Upcoming</Text>
            </View>
          </View>
          <Text style={styles.welcomeMotivation}>{getMotivationalText()}</Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

// Enhanced Next Up Card with fluid design
function NextUpCardEnhanced({ task, onMarkDone, onPress }: { task: Task; onMarkDone: () => void; onPress: () => void }) {
  const { urgency, timeUntil, progress } = useMemo(() => {
    if (!task.scheduled_start || !task.scheduled_end) {
      return { urgency: "normal" as const, timeUntil: "Not scheduled", progress: 0 };
    }

    const now = new Date();
    const start = new Date(task.scheduled_start);
    const end = new Date(task.scheduled_end);
    const minutesUntil = differenceInMinutes(start, now);

    let urgency: "normal" | "soon" | "now" | "overdue";
    let timeUntil: string;
    let progress = 0;

    if (isPast(end)) {
      urgency = "overdue";
      timeUntil = "Overdue";
    } else if (isWithinInterval(now, { start, end })) {
      urgency = "now";
      const totalDuration = differenceInMinutes(end, start);
      const elapsed = differenceInMinutes(now, start);
      progress = elapsed / totalDuration;
      const minutesLeft = differenceInMinutes(end, now);
      timeUntil = `${minutesLeft}m left`;
    } else if (minutesUntil <= 60) {
      urgency = "soon";
      timeUntil = minutesUntil <= 0 ? "Starting now" : `in ${minutesUntil}m`;
    } else {
      urgency = "normal";
      const hours = Math.floor(minutesUntil / 60);
      timeUntil = `in ${hours}h ${minutesUntil % 60}m`;
    }

    return { urgency, timeUntil, progress };
  }, [task.scheduled_start, task.scheduled_end]);

  const urgencyStyles = {
    normal: { bg: "#EBF4FF", accent: COLORS.gradientStart, text: "#1E40AF" },
    soon: { bg: "#FFF7ED", accent: COLORS.warning, text: "#9A3412" },
    now: { bg: "#F0FDF4", accent: COLORS.success, text: "#166534" },
    overdue: { bg: "#FEF2F2", accent: COLORS.error, text: "#991B1B" },
  };

  const style = urgencyStyles[urgency];

  return (
    <Pressable onPress={onPress} style={styles.nextUpWrapper}>
      <View style={[styles.nextUpCard, { backgroundColor: style.bg }]}>
        {/* Status indicator line */}
        <View style={[styles.nextUpIndicator, { backgroundColor: style.accent }]} />

        <View style={styles.nextUpContent}>
          <View style={styles.nextUpHeader}>
            <View style={styles.nextUpLabelRow}>
              <MaterialCommunityIcons
                name={urgency === "now" ? "play-circle" : urgency === "soon" ? "clock-fast" : urgency === "overdue" ? "alert-circle" : "clock-outline"}
                size={16}
                color={style.accent}
              />
              <Text style={[styles.nextUpLabel, { color: style.accent }]}>
                {urgency === "now" ? "IN PROGRESS" : urgency === "soon" ? "COMING UP" : urgency === "overdue" ? "OVERDUE" : "NEXT UP"}
              </Text>
            </View>
            <Text style={[styles.nextUpTime, { color: style.text }]}>{timeUntil}</Text>
          </View>

          <Text style={[styles.nextUpTitle, { color: style.text }]} numberOfLines={2}>
            {task.title}
          </Text>

          {task.scheduled_start && task.scheduled_end && (
            <Text style={[styles.nextUpSchedule, { color: style.accent }]}>
              {format(new Date(task.scheduled_start), "h:mm a")} - {format(new Date(task.scheduled_end), "h:mm a")}
            </Text>
          )}

          {urgency === "now" && (
            <View style={styles.nextUpProgress}>
              <ProgressBar progress={progress} color={style.accent} style={styles.progressBar} />
              <Text style={[styles.progressText, { color: style.text }]}>{Math.round(progress * 100)}%</Text>
            </View>
          )}

          <View style={styles.nextUpActions}>
            <Pressable
              style={[styles.nextUpButton, { backgroundColor: style.accent }]}
              onPress={onMarkDone}
            >
              <MaterialCommunityIcons name="check" size={18} color="#FFFFFF" />
              <Text style={styles.nextUpButtonText}>Complete</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// Refined Task Card with subtle depth
function TaskCardRefined({ task, onPress, progress }: { task: Task; onPress: () => void; progress?: { completed: number; total: number } | null }) {
  const priorityColor = task.priority === "high" ? COLORS.priorityHigh : task.priority === "medium" ? COLORS.priorityMedium : COLORS.priorityLow;

  const formatTime = () => {
    if (!task.scheduled_start) return "Not scheduled";
    const start = new Date(task.scheduled_start);
    if (isToday(start)) return `Today at ${format(start, "h:mm a")}`;
    if (isTomorrow(start)) return `Tomorrow at ${format(start, "h:mm a")}`;
    return format(start, "MMM d 'at' h:mm a");
  };

  return (
    <Pressable onPress={onPress} style={styles.taskCardWrapper}>
      <View style={styles.taskCard}>
        {/* Priority indicator */}
        <View style={[styles.taskPriorityBar, { backgroundColor: priorityColor }]} />

        <View style={styles.taskCardContent}>
          <View style={styles.taskCardHeader}>
            <Text style={styles.taskCardTitle} numberOfLines={1}>{task.title}</Text>
            {(task.is_recurring || isRecurringInstance(task)) && (
              <MaterialCommunityIcons name="repeat" size={14} color={COLORS.aiPurple} />
            )}
          </View>

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <View style={styles.taskTagsRow}>
              {task.tags.slice(0, 2).map((tag) => (
                <View key={tag} style={styles.taskTag}>
                  <Text style={styles.taskTagText}>{tag}</Text>
                </View>
              ))}
              {task.tags.length > 2 && (
                <Text style={styles.taskTagMore}>+{task.tags.length - 2}</Text>
              )}
            </View>
          )}

          {/* Progress bar for parent tasks with subtasks */}
          {progress && (
            <View style={styles.taskProgressRow}>
              <ProgressBar
                progress={progress.completed / progress.total}
                color={COLORS.success}
                style={styles.taskProgressBar}
              />
              <Text style={styles.taskProgressText}>{progress.completed}/{progress.total}</Text>
            </View>
          )}

          <View style={styles.taskCardMeta}>
            <View style={styles.taskTimeRow}>
              <MaterialCommunityIcons name="clock-outline" size={14} color={COLORS.textTertiary} />
              <Text style={styles.taskTimeText}>{formatTime()}</Text>
            </View>
            <View style={styles.taskDurationBadge}>
              <Text style={styles.taskDurationText}>{task.duration_minutes}m</Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// Collapsible section with refined design
function CollapsibleSectionRefined({
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
  const isWarning = variant === "warning";

  return (
    <View style={styles.collapsibleWrapper}>
      <Pressable style={styles.collapsibleHeader} onPress={onToggle}>
        <View style={styles.collapsibleTitleRow}>
          {isWarning && (
            <View style={styles.warningDot} />
          )}
          <Text style={[styles.collapsibleTitle, isWarning && styles.warningText]}>
            {title}
          </Text>
          <View style={[styles.countBadge, isWarning && styles.warningBadge]}>
            <Text style={[styles.countText, isWarning && styles.warningCountText]}>{count}</Text>
          </View>
        </View>
        <MaterialCommunityIcons
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={22}
          color={isWarning ? COLORS.error : COLORS.textTertiary}
        />
      </Pressable>
      {isExpanded && (
        <View style={styles.collapsibleContent}>{children}</View>
      )}
    </View>
  );
}

// Section Header component
function SectionHeader({ title, count, onViewAll }: { title: string; count?: number; onViewAll?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count !== undefined && (
          <View style={styles.sectionCount}>
            <Text style={styles.sectionCountText}>{count}</Text>
          </View>
        )}
      </View>
      {onViewAll && (
        <Pressable onPress={onViewAll} style={styles.viewAllButton}>
          <Text style={styles.viewAllText}>View all</Text>
          <MaterialCommunityIcons name="arrow-right" size={16} color={COLORS.gradientStart} />
        </Pressable>
      )}
    </View>
  );
}

// Compact Agenda Task Item
function AgendaTaskItem({ task, onPress, onComplete }: { task: Task; onPress: () => void; onComplete: () => void }) {
  const priorityColor = task.priority === "high" ? COLORS.priorityHigh : task.priority === "medium" ? COLORS.priorityMedium : COLORS.priorityLow;
  const startTime = task.scheduled_start ? format(new Date(task.scheduled_start), "h:mm a") : "--:--";
  const endTime = task.scheduled_end ? format(new Date(task.scheduled_end), "h:mm a") : "";

  // Check if task is currently active
  const isActive = task.scheduled_start && task.scheduled_end &&
    isWithinInterval(new Date(), {
      start: new Date(task.scheduled_start),
      end: new Date(task.scheduled_end)
    });

  return (
    <Pressable onPress={onPress} style={[styles.agendaItem, isActive && styles.agendaItemActive]}>
      <View style={[styles.agendaTimeCol, isActive && styles.agendaTimeColActive]}>
        <Text style={[styles.agendaTime, isActive && styles.agendaTimeActive]}>{startTime}</Text>
        {endTime && <Text style={styles.agendaTimeEnd}>{endTime}</Text>}
      </View>
      <View style={[styles.agendaDot, { backgroundColor: priorityColor }]} />
      <View style={styles.agendaContent}>
        <Text style={styles.agendaTitle} numberOfLines={1}>{task.title}</Text>
        <Text style={styles.agendaDuration}>{task.duration_minutes}m</Text>
      </View>
      <Pressable onPress={onComplete} style={styles.agendaCheck} hitSlop={10}>
        <MaterialCommunityIcons
          name={isActive ? "checkbox-blank-circle-outline" : "checkbox-blank-circle-outline"}
          size={22}
          color={isActive ? priorityColor : COLORS.textTertiary}
        />
      </Pressable>
    </Pressable>
  );
}

// Compact Agenda Event Item (calendar events)
function AgendaEventItem({ event }: { event: CalendarEvent }) {
  const startTime = format(parseISO(event.start_time), "h:mm a");

  return (
    <View style={styles.agendaItem}>
      <View style={styles.agendaTimeCol}>
        <Text style={styles.agendaTime}>{startTime}</Text>
      </View>
      <View style={[styles.agendaDot, { backgroundColor: COLORS.textTertiary }]} />
      <View style={styles.agendaContent}>
        <Text style={[styles.agendaTitle, styles.agendaEventTitle]} numberOfLines={1}>
          {event.title}
        </Text>
        <View style={styles.agendaEventBadge}>
          <MaterialCommunityIcons name="calendar" size={10} color={COLORS.textTertiary} />
          <Text style={styles.agendaEventLabel}>Event</Text>
        </View>
      </View>
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
        setDisplayName(profile.display_name.split(" ")[0]);
      }

      // Trigger auto-reschedule
      triggerAutoReschedule();

      // Get tasks
      const { data: tasksData, error } = await supabase
        .from("tasks")
        .select("*")
        .order("scheduled_start", { ascending: true, nullsFirst: false });

      if (error) throw error;
      setTasks(tasksData || []);

      // Load calendar events
      await loadCalendarEvents();
    } catch (error) {
      console.error("[Home] Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const triggerAutoReschedule = async () => {
    try {
      await supabase.functions.invoke("auto-reschedule");
    } catch (error) {
      console.log("[Home] Auto-reschedule trigger failed");
    }
  };

  const loadCalendarEvents = async () => {
    try {
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 14);

      const isConnected = await isGoogleCalendarConnected();

      if (isConnected) {
        try {
          const events = await fetchGoogleCalendarEvents(startDate, endDate);
          setCalendarEvents(events);
        } catch {
          const cachedEvents = await getLocalCalendarEvents(startDate, endDate);
          setCalendarEvents(cachedEvents);
        }
      } else {
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

  // Filter out subtasks
  const parentTasks = useMemo(
    () =>
      tasks.filter((t) => {
        if (t.parent_task_id) return false;
        if (selectedTag && (!t.tags || !t.tags.includes(selectedTag))) return false;
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

  const getSubtasks = (parentId: string) => tasks.filter((t) => t.parent_task_id === parentId);

  const getSubtaskProgress = (parentId: string) => {
    const subtasks = getSubtasks(parentId);
    if (subtasks.length === 0) return null;
    const completed = subtasks.filter((s) => s.status === "completed").length;
    return { completed, total: subtasks.length };
  };

  // Task grouping logic
  const overdueTasks = useMemo(() => {
    const todayStart = startOfDay(new Date());
    return parentTasks.filter((t) => {
      if (t.status === "completed" || t.status === "cancelled") return false;
      if (t.due_date && isBefore(new Date(t.due_date), todayStart)) return true;
      if (t.scheduled_end && isPast(new Date(t.scheduled_end)) && t.status === "scheduled") return true;
      return false;
    });
  }, [parentTasks]);

  const overdueIds = useMemo(() => new Set(overdueTasks.map((t) => t.id)), [overdueTasks]);

  const todayTasks = useMemo(
    () => parentTasks.filter(
      (t) => t.scheduled_start && isToday(new Date(t.scheduled_start)) && t.status === "scheduled" && !overdueIds.has(t.id)
    ),
    [parentTasks, overdueIds]
  );

  const completedTodayTasks = useMemo(
    () => parentTasks.filter(
      (t) => t.status === "completed" && t.scheduled_start && isToday(new Date(t.scheduled_start))
    ),
    [parentTasks]
  );

  const upcomingTasks = useMemo(
    () => parentTasks.filter(
      (t) => t.scheduled_start && isFuture(startOfDay(new Date(t.scheduled_start))) && !isToday(new Date(t.scheduled_start)) && t.status === "scheduled" && !overdueIds.has(t.id)
    ),
    [parentTasks, overdueIds]
  );

  const pendingTasks = useMemo(
    () => parentTasks.filter((t) => t.status === "pending_schedule" && !overdueIds.has(t.id)),
    [parentTasks, overdueIds]
  );

  // Stats for welcome card
  const taskStats = useMemo(() => ({
    today: todayTasks.length,
    completed: completedTodayTasks.length,
    upcoming: upcomingTasks.length,
  }), [todayTasks, completedTodayTasks, upcomingTasks]);

  // Get next upcoming task
  const nextTask = useMemo(() => {
    const now = new Date();
    const scheduledTasks = parentTasks
      .filter((t) => t.scheduled_start && t.status === "scheduled" && !overdueIds.has(t.id))
      .sort((a, b) => new Date(a.scheduled_start!).getTime() - new Date(b.scheduled_start!).getTime());

    return scheduledTasks.find((t) => {
      const endTime = t.scheduled_end ? new Date(t.scheduled_end) : new Date(t.scheduled_start!);
      return endTime >= now;
    }) || null;
  }, [parentTasks, overdueIds]);

  const todayEvents = useMemo(
    () => calendarEvents.filter((e) => isToday(parseISO(e.start_time))),
    [calendarEvents]
  );

  const handleMarkDone = async (task: Task) => {
    try {
      await supabase.from("tasks").update({ status: "completed" }).eq("id", task.id);
      loadData();
    } catch (error) {
      console.error("[Home] Error marking task done:", error);
    }
  };

  const handleTaskPress = (task: Task) => {
    router.push(`/task/${task.id}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.gradientStart} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.gradientStart]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome Card */}
        <WelcomeCard displayName={displayName} taskStats={taskStats} />

        {/* Tag Filter Pills */}
        {allTags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tagFilterScroll}
            contentContainerStyle={styles.tagFilterContent}
          >
            <Pressable
              style={[styles.tagPill, selectedTag === null && styles.tagPillActive]}
              onPress={() => setSelectedTag(null)}
            >
              <Text style={[styles.tagPillText, selectedTag === null && styles.tagPillTextActive]}>All</Text>
            </Pressable>
            {allTags.map((tag) => (
              <Pressable
                key={tag}
                style={[styles.tagPill, selectedTag === tag && styles.tagPillActive]}
                onPress={() => setSelectedTag(selectedTag === tag ? null : tag)}
              >
                <Text style={[styles.tagPillText, selectedTag === tag && styles.tagPillTextActive]}>{tag}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Next Up Card */}
        {nextTask && (
          <View style={styles.section}>
            <NextUpCardEnhanced
              task={nextTask}
              onMarkDone={() => handleMarkDone(nextTask)}
              onPress={() => handleTaskPress(nextTask)}
            />
          </View>
        )}

        {/* Today's Agenda - Compact View */}
        {(todayTasks.length > 0 || todayEvents.length > 0) && (
          <View style={styles.section}>
            <SectionHeader
              title="Today's Schedule"
              count={todayTasks.length + todayEvents.length}
              onViewAll={() => router.push("/(tabs)/calendar")}
            />
            <View style={styles.agendaWrapper}>
              {/* Combine and sort today's items by time */}
              {[...todayTasks.map(t => ({ type: 'task' as const, item: t, time: t.scheduled_start })),
                ...todayEvents.map(e => ({ type: 'event' as const, item: e, time: e.start_time }))]
                .sort((a, b) => new Date(a.time!).getTime() - new Date(b.time!).getTime())
                .slice(0, 5)
                .map((entry, index) => (
                  entry.type === 'task' ? (
                    <AgendaTaskItem
                      key={entry.item.id}
                      task={entry.item as Task}
                      onPress={() => handleTaskPress(entry.item as Task)}
                      onComplete={() => handleMarkDone(entry.item as Task)}
                    />
                  ) : (
                    <AgendaEventItem key={entry.item.id} event={entry.item as CalendarEvent} />
                  )
                ))
              }
              {(todayTasks.length + todayEvents.length) > 5 && (
                <Pressable style={styles.seeMoreButton} onPress={() => router.push("/(tabs)/calendar")}>
                  <Text style={styles.seeMoreText}>
                    +{todayTasks.length + todayEvents.length - 5} more items
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={COLORS.gradientStart} />
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Overdue Tasks */}
        {overdueTasks.length > 0 && (
          <View style={styles.section}>
            <CollapsibleSectionRefined
              title="Overdue"
              count={overdueTasks.length}
              isExpanded={overdueExpanded}
              onToggle={() => setOverdueExpanded(!overdueExpanded)}
              variant="warning"
            >
              {overdueTasks.map((task) => (
                <TaskCardRefined
                  key={task.id}
                  task={task}
                  onPress={() => handleTaskPress(task)}
                  progress={getSubtaskProgress(task.id)}
                />
              ))}
            </CollapsibleSectionRefined>
          </View>
        )}

        {/* Pending Schedule */}
        {pendingTasks.length > 0 && (
          <View style={styles.section}>
            <CollapsibleSectionRefined
              title="Needs Scheduling"
              count={pendingTasks.length}
              isExpanded={pendingExpanded}
              onToggle={() => setPendingExpanded(!pendingExpanded)}
            >
              {pendingTasks.map((task) => (
                <TaskCardRefined
                  key={task.id}
                  task={task}
                  onPress={() => handleTaskPress(task)}
                  progress={getSubtaskProgress(task.id)}
                />
              ))}
            </CollapsibleSectionRefined>
          </View>
        )}

        {/* Upcoming Tasks */}
        {upcomingTasks.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Upcoming"
              count={upcomingTasks.length}
              onViewAll={() => router.push("/(tabs)/calendar")}
            />
            {upcomingTasks.slice(0, 4).map((task) => (
              <TaskCardRefined
                key={task.id}
                task={task}
                onPress={() => handleTaskPress(task)}
                progress={getSubtaskProgress(task.id)}
              />
            ))}
          </View>
        )}

        {/* Empty State */}
        {tasks.length === 0 && (
          <View style={styles.emptyState}>
            <LinearGradient
              colors={[COLORS.aiPurpleLight, "#F0F4FF"]}
              style={styles.emptyStateGradient}
            >
              <MaterialCommunityIcons name="robot-outline" size={64} color={COLORS.aiPurple} />
              <Text style={styles.emptyStateTitle}>Ready to plan your day?</Text>
              <Text style={styles.emptyStateText}>
                Add your first task and let AI find the perfect time for it.
              </Text>
              <Pressable style={styles.emptyStateButton} onPress={() => router.push("/(tabs)/add-task")}>
                <LinearGradient
                  colors={[COLORS.gradientStart, COLORS.gradientEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.emptyStateButtonGradient}
                >
                  <MaterialCommunityIcons name="plus" size={20} color="#FFFFFF" />
                  <Text style={styles.emptyStateButtonText}>Create First Task</Text>
                </LinearGradient>
              </Pressable>
            </LinearGradient>
          </View>
        )}

        {/* Nothing scheduled today state */}
        {tasks.length > 0 && todayTasks.length === 0 && todayEvents.length === 0 && !nextTask && (
          <View style={styles.nothingTodayCard}>
            <MaterialCommunityIcons name="calendar-check" size={40} color={COLORS.textTertiary} />
            <Text style={styles.nothingTodayTitle}>All clear for today</Text>
            <Text style={styles.nothingTodayText}>
              {pendingTasks.length > 0
                ? `${pendingTasks.length} task${pendingTasks.length > 1 ? "s" : ""} waiting to be scheduled`
                : "Enjoy your free time or add a new task"}
            </Text>
          </View>
        )}

        {/* Spacer for FAB */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Floating Action Button with gradient */}
      <Pressable style={styles.fabWrapper} onPress={() => router.push("/(tabs)/add-task")}>
        <LinearGradient
          colors={[COLORS.gradientStart, COLORS.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <MaterialCommunityIcons name="plus" size={28} color="#FFFFFF" />
        </LinearGradient>
      </Pressable>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },

  // Welcome Card
  welcomeCardWrapper: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  welcomeCard: {
    borderRadius: 24,
    padding: 24,
    overflow: "hidden",
  },
  decorativeCircle1: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  decorativeCircle2: {
    position: "absolute",
    bottom: -20,
    left: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  welcomeContent: {
    zIndex: 1,
  },
  welcomeGreeting: {
    fontSize: 26,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 4,
    letterSpacing: -0.5,
  },
  welcomeDate: {
    fontSize: 15,
    color: "rgba(255,255,255,0.8)",
    marginBottom: 20,
  },
  welcomeStats: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  welcomeStatItem: {
    flex: 1,
    alignItems: "center",
  },
  welcomeStatNumber: {
    fontSize: 28,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  welcomeStatLabel: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  welcomeStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  welcomeMotivation: {
    fontSize: 14,
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
    fontStyle: "italic",
  },

  // Tag Filter
  tagFilterScroll: {
    marginTop: 12,
  },
  tagFilterContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  tagPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginRight: 8,
  },
  tagPillActive: {
    backgroundColor: COLORS.gradientStart,
    borderColor: COLORS.gradientStart,
  },
  tagPillText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  tagPillTextActive: {
    color: "#FFFFFF",
  },

  // Sections
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    letterSpacing: -0.3,
  },
  sectionCount: {
    backgroundColor: COLORS.aiPurpleLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.aiPurple,
  },
  viewAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.gradientStart,
  },

  // Next Up Card
  nextUpWrapper: {
    marginBottom: 8,
  },
  nextUpCard: {
    borderRadius: 20,
    overflow: "hidden",
    flexDirection: "row",
  },
  nextUpIndicator: {
    width: 4,
  },
  nextUpContent: {
    flex: 1,
    padding: 18,
  },
  nextUpHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  nextUpLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  nextUpLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  nextUpTime: {
    fontSize: 14,
    fontWeight: "600",
  },
  nextUpTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  nextUpSchedule: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 12,
  },
  nextUpProgress: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    gap: 10,
  },
  progressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    fontWeight: "600",
    minWidth: 35,
  },
  nextUpActions: {
    flexDirection: "row",
    gap: 10,
  },
  nextUpButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  nextUpButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  // Task Card
  taskCardWrapper: {
    marginBottom: 10,
  },
  taskCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: "hidden",
    flexDirection: "row",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  taskPriorityBar: {
    width: 4,
  },
  taskCardContent: {
    flex: 1,
    padding: 16,
  },
  taskCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  taskCardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
    letterSpacing: -0.2,
  },
  taskTagsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap",
    gap: 6,
  },
  taskTag: {
    backgroundColor: COLORS.aiPurpleLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  taskTagText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.aiPurple,
  },
  taskTagMore: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  taskProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  taskProgressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  taskProgressText: {
    fontSize: 11,
    color: COLORS.textTertiary,
    fontWeight: "500",
  },
  taskCardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  taskTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  taskTimeText: {
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  taskDurationBadge: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  taskDurationText: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },

  // Collapsible
  collapsibleWrapper: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  collapsibleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  collapsibleTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  collapsibleTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  warningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.error,
  },
  warningText: {
    color: COLORS.error,
  },
  countBadge: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  warningBadge: {
    backgroundColor: "#FEF2F2",
  },
  countText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  warningCountText: {
    color: COLORS.error,
  },
  collapsibleContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  // Agenda styles (compact view)
  agendaWrapper: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  agendaItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  agendaItemActive: {
    backgroundColor: "#F0F9FF",
  },
  agendaTimeCol: {
    width: 60,
    marginRight: 12,
  },
  agendaTimeColActive: {},
  agendaTime: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  agendaTimeActive: {
    color: COLORS.gradientStart,
  },
  agendaTimeEnd: {
    fontSize: 11,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  agendaDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  agendaContent: {
    flex: 1,
  },
  agendaTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  agendaEventTitle: {
    color: COLORS.textSecondary,
  },
  agendaDuration: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  agendaCheck: {
    marginLeft: 8,
    padding: 4,
  },
  agendaEventBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  agendaEventLabel: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  seeMoreButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 4,
  },
  seeMoreText: {
    fontSize: 13,
    fontWeight: "500",
    color: COLORS.gradientStart,
  },

  // Empty States
  emptyState: {
    marginHorizontal: 20,
    marginTop: 40,
  },
  emptyStateGradient: {
    borderRadius: 24,
    padding: 40,
    alignItems: "center",
  },
  emptyStateTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginTop: 20,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  emptyStateText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  emptyStateButton: {
    borderRadius: 14,
    overflow: "hidden",
  },
  emptyStateButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  emptyStateButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  nothingTodayCard: {
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  nothingTodayTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginTop: 16,
    marginBottom: 6,
  },
  nothingTodayText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
  },

  // FAB
  fabWrapper: {
    position: "absolute",
    right: 20,
    bottom: 24,
    shadowColor: COLORS.gradientStart,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
  },
});
