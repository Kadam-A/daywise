/**
 * Home Screen - "Fluid Intelligence" Design
 *
 * AI-powered task dashboard with organic visual language
 * that feels alive and responsive to the user's day
 */

import { View, StyleSheet, ScrollView, RefreshControl, Pressable, Animated, Dimensions, TextInput, Alert, Modal, Switch } from "react-native";
import { Text, ActivityIndicator, ProgressBar, Surface, useTheme } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { format, isToday, isPast, isFuture, parseISO, startOfDay, endOfDay, isBefore, differenceInMinutes, isWithinInterval } from "date-fns";
import { Task, CalendarEvent, TimeSlot } from "@/lib/types";
import { scheduleTask, saveScheduledSlot } from "@/lib/scheduling";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  isGoogleCalendarConnected,
  fetchGoogleCalendarEvents,
  getLocalCalendarEvents,
} from "@/lib/google-calendar";
import { isRecurringInstance } from "@/lib/recurrence";
import ErrorState from "@/components/ErrorState";
import { useNetwork } from "@/contexts/NetworkContext";
import { queueOperation } from "@/lib/offline";
import SchedulingFeedbackModal, { SCHEDULING_FEEDBACK_DISABLED_KEY } from "@/components/SchedulingFeedbackModal";
import QuickAddSheet from "@/components/QuickAddSheet";
import BulkRescheduleModal from "@/components/BulkRescheduleModal";
import { useAppColors, useThemeMode } from "@/contexts/ThemeContext";
import { useGuidedTour } from "@/contexts/GuidedTourContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import TourTooltip from "@/components/TourTooltip";
import TourPulseDot from "@/components/TourPulseDot";
import TourRewardModal from "@/components/TourRewardModal";
import TourStatesModal from "@/components/TourStatesModal";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Static colors for StyleSheet (can't use useTheme in StyleSheet.create)
const COLORS = {
  primary: "#4A90E2",
  secondary: "#7C6FBF",
  secondaryLight: "#F3F0FF",
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

// Welcome Card with accurate progress bar
function WelcomeCard({ displayName, taskStats }: { displayName: string; taskStats: { today: number; completed: number } }) {
  const appColors = useAppColors();
  const { isDark } = useThemeMode();
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

  const completionPercent = taskStats.today > 0
    ? Math.round((taskStats.completed / taskStats.today) * 100)
    : 0;

  const getMotivationalText = () => {
    if (taskStats.today === 0) return "Your day is wide open";
    if (completionPercent === 100) return "You're all done! Great work";
    if (completionPercent >= 75) return "Almost there, keep going!";
    if (completionPercent >= 50) return "Halfway through your day";
    if (taskStats.completed > 0) return "Good progress so far";
    return "Let's get started";
  };

  return (
    <Animated.View style={[styles.welcomeCardWrapper, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={[styles.welcomeCard, { backgroundColor: isDark ? appColors.surface : appColors.primaryLight }]}>
        <View style={styles.welcomeTop}>
          <View>
            <Text style={[styles.welcomeGreeting, { color: appColors.textSecondary }]}>
              {getGreeting()}{displayName ? `,` : ""}
            </Text>
            {displayName && (
              <Text style={[styles.welcomeName, { color: appColors.textPrimary }]}>{displayName}</Text>
            )}
          </View>
          <Text style={[styles.welcomeDate, { color: appColors.textSecondary, backgroundColor: isDark ? appColors.chipBg : `${appColors.primary}18` }]}>{format(new Date(), "EEE, MMM d")}</Text>
        </View>

        {/* Progress Section */}
        <View style={styles.welcomeProgressSection}>
          <View style={styles.welcomeProgressHeader}>
            <Text style={[styles.welcomeMotivation, { color: appColors.textSecondary }]}>{getMotivationalText()}</Text>
            <Text style={[styles.welcomeProgressPercent, { color: appColors.primary }]}>{completionPercent}%</Text>
          </View>
          <View style={[styles.welcomeProgressTrack, { backgroundColor: isDark ? appColors.inputBg : `${appColors.primary}20` }]}>
            <View style={[styles.welcomeProgressFill, { width: `${completionPercent}%`, backgroundColor: appColors.primary }]} />
          </View>
          <Text style={[styles.welcomeProgressDetail, { color: appColors.textTertiary }]}>
            {taskStats.completed} of {taskStats.today} tasks completed
          </Text>
        </View>

        <View style={[styles.welcomeStatsRow, { backgroundColor: isDark ? appColors.inputBg : `${appColors.primary}18` }]}>
          <View style={styles.welcomeStatChip}>
            <Text style={[styles.welcomeStatChipNumber, { color: appColors.textPrimary }]}>{taskStats.today}</Text>
            <Text style={[styles.welcomeStatChipLabel, { color: appColors.textTertiary }]}>today</Text>
          </View>
          <View style={styles.welcomeStatChip}>
            <Text style={[styles.welcomeStatChipNumber, { color: appColors.textPrimary }]}>{taskStats.completed}</Text>
            <Text style={[styles.welcomeStatChipLabel, { color: appColors.textTertiary }]}>done</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// Enhanced Next Up Card with fluid design
function NextUpCardEnhanced({ task, onMarkDone, onPress }: { task: Task; onMarkDone: () => void; onPress: () => void }) {
  const { colors } = useTheme();
  const appColors = useAppColors();
  const { isDark } = useThemeMode();
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
      if (minutesUntil >= 24 * 60) {
        const days = Math.floor(minutesUntil / (24 * 60));
        const hours = Math.floor((minutesUntil % (24 * 60)) / 60);
        timeUntil = hours > 0 ? `in ${days}d ${hours}h` : `in ${days}d`;
      } else {
        const hours = Math.floor(minutesUntil / 60);
        timeUntil = `in ${hours}h ${minutesUntil % 60}m`;
      }
    }

    return { urgency, timeUntil, progress };
  }, [task.scheduled_start, task.scheduled_end]);

  const urgencyStyles = {
    normal: { bg: appColors.primaryLight, accent: appColors.primary, text: appColors.primary },
    soon: {
      bg: isDark ? appColors.warningLight : `${appColors.warning}28`,
      accent: appColors.warning,
      text: isDark ? appColors.warning : "#B45309", // darker amber text in light for readability
    },
    now: {
      bg: isDark ? appColors.successLight : `${appColors.success}22`,
      accent: appColors.success,
      text: isDark ? appColors.success : "#276749", // darker green text in light
    },
    overdue: { bg: appColors.errorLight, accent: appColors.error, text: appColors.error },
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

// Task Row — agenda-style row (matches Today's Schedule visual language)
function TaskCardRefined({ task, onPress, onLongPress, onReschedule, onComplete, progress, isOverdue, isMissedSlot, isPending, isSelecting, isSelected }: { task: Task; onPress: () => void; onLongPress?: () => void; onReschedule?: () => void; onComplete?: () => void; progress?: { completed: number; total: number } | null; isOverdue?: boolean; isMissedSlot?: boolean; isPending?: boolean; isSelecting?: boolean; isSelected?: boolean }) {
  const appColors = useAppColors();
  const { isDark } = useThemeMode();
  const priorityColor = task.priority === "high" ? appColors.priorityHigh : task.priority === "medium" ? appColors.priorityMedium : appColors.priorityLow;

  // Left column: state label or scheduled time
  let leftLabel: string;
  let leftColor: string;
  if (isOverdue) {
    leftLabel = task.due_date ? format(new Date(task.due_date), "MMM d") : "--";
    leftColor = appColors.error;
  } else if (isMissedSlot) {
    leftLabel = task.scheduled_start ? format(new Date(task.scheduled_start), "h:mm a") : "Missed";
    leftColor = isDark ? appColors.warning : "#B45309";
  } else if (isPending) {
    leftLabel = "--";
    leftColor = appColors.textTertiary;
  } else {
    if (task.scheduled_start) {
      const start = new Date(task.scheduled_start);
      leftLabel = isToday(start) ? format(start, "h:mm a") : format(start, "EEE h:mm");
    } else {
      leftLabel = "--:--";
    }
    leftColor = appColors.textSecondary;
  }

  const dotColor = isOverdue ? appColors.error : isMissedSlot ? (isDark ? appColors.warning : "#D97706") : priorityColor;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => { if (!isSelecting) onLongPress?.(); }}
      style={[styles.agendaItem, isSelected && { backgroundColor: appColors.primaryLight }]}
    >
      {isSelecting && (
        <MaterialCommunityIcons
          name={isSelected ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
          size={22}
          color={isSelected ? appColors.primary : appColors.textTertiary}
          style={{ marginRight: 8 }}
        />
      )}
      <View style={styles.agendaTimeCol}>
        <Text style={[styles.agendaTime, { color: leftColor }]} numberOfLines={1}>{leftLabel}</Text>
        {(task.is_recurring || isRecurringInstance(task)) && (
          <MaterialCommunityIcons name="repeat" size={11} color={appColors.textTertiary} style={{ marginTop: 2 }} />
        )}
      </View>
      <View style={styles.agendaContent}>
        <Text style={[styles.agendaTitle, { color: appColors.textPrimary }]} numberOfLines={1}>{task.title}</Text>
        <Text style={[styles.agendaDuration, { color: appColors.textTertiary }]}>{task.duration_minutes}m</Text>
      </View>
      {!isSelecting && (
        <View style={styles.taskCardActions}>
          {(isOverdue || isMissedSlot || isPending) && onReschedule && (
            <Pressable onPress={onReschedule} hitSlop={10} style={[styles.miniCompletePill, { backgroundColor: appColors.chipBg }]}>
              <MaterialCommunityIcons name="calendar-clock" size={14} color={appColors.textSecondary} />
            </Pressable>
          )}
          {onComplete && task.status !== "completed" && (
            <Pressable onPress={onComplete} style={styles.agendaCheck} hitSlop={10}>
              <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={22} color={dotColor} />
            </Pressable>
          )}
        </View>
      )}
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
  infoText,
  children,
}: {
  title: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  variant?: "default" | "warning" | "error" | "pending";
  infoText?: string;
  children: React.ReactNode;
}) {
  const appColors = useAppColors();
  const [showInfo, setShowInfo] = useState(false);
  const { isDark } = useThemeMode();
  const isError = variant === "error";
  const isWarning = variant === "warning";
  const isPending = variant === "pending";
  const isSpecial = isError || isWarning || isPending;
  const accentColor = isError ? appColors.error : isWarning ? (isDark ? appColors.warning : "#B45309") : isPending ? appColors.primary : appColors.primary;
  const accentBg = isError ? appColors.errorLight : isWarning ? (isDark ? appColors.warningLight : `${appColors.warning}20`) : isPending ? appColors.primaryLight : appColors.chipBg;

  return (
    <View style={[styles.collapsibleWrapper, { backgroundColor: appColors.surface }]}>
      <Pressable style={styles.collapsibleHeader} onPress={onToggle}>
        <View style={styles.collapsibleTitleRow}>
          {isError ? (
            <MaterialCommunityIcons name="clock-alert-outline" size={16} color={accentColor} style={{ marginRight: 6 }} />
          ) : isWarning ? (
            <MaterialCommunityIcons name="clock-remove-outline" size={16} color={accentColor} style={{ marginRight: 6 }} />
          ) : isPending ? (
            <MaterialCommunityIcons name="calendar-clock" size={16} color={accentColor} style={{ marginRight: 6 }} />
          ) : null}
          <Text style={[
            styles.collapsibleTitle,
            { color: isSpecial ? accentColor : appColors.textPrimary },
            isSpecial && { fontWeight: "500" },
          ]}>
            {title}
          </Text>
          <View style={[styles.countBadge, { backgroundColor: accentBg }]}>
            <Text style={[styles.countText, { color: isSpecial ? accentColor : appColors.textSecondary }]}>{count}</Text>
          </View>
          {infoText && (
            <Pressable
              onPress={(e) => { e.stopPropagation(); setShowInfo((v) => !v); }}
              hitSlop={10}
              style={{ marginLeft: 4 }}
            >
              <MaterialCommunityIcons
                name={showInfo ? "information" : "information-outline"}
                size={16}
                color={appColors.textTertiary}
              />
            </Pressable>
          )}
        </View>
        <MaterialCommunityIcons
          name={isExpanded ? "chevron-up" : "chevron-down"}
          size={20}
          color={appColors.textTertiary}
        />
      </Pressable>
      {infoText && showInfo && (
        <View style={[styles.sectionInfoBanner, { backgroundColor: accentBg }]}>
          <Text style={[styles.sectionInfoText, { color: isSpecial ? accentColor : appColors.textSecondary }]}>
            {infoText}
          </Text>
        </View>
      )}
      {isExpanded && (
        <View style={styles.collapsibleContent}>{children}</View>
      )}
    </View>
  );
}

// Search Bar component
function SearchBar({ value, onChangeText, onClear }: { value: string; onChangeText: (text: string) => void; onClear: () => void }) {
  const { colors } = useTheme();
  const appColors = useAppColors();
  return (
    <View style={styles.searchBarWrapper}>
      <View style={[styles.searchBar, { backgroundColor: appColors.surface }]}>
        <Ionicons name="search" size={20} color={appColors.textTertiary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: appColors.textPrimary }]}
          placeholder="Search tasks..."
          placeholderTextColor={appColors.textTertiary}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {value.length > 0 && (
          <Pressable onPress={onClear} hitSlop={10}>
            <Ionicons name="close-circle" size={20} color={appColors.textTertiary} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

// Section Header component
function SectionHeader({ title, count, onViewAll }: { title: string; count?: number; onViewAll?: () => void }) {
  const { colors } = useTheme();
  const appColors = useAppColors();
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>{title}</Text>
        {count !== undefined && (
          <View style={[styles.sectionCount, { backgroundColor: appColors.secondaryLight }]}>
            <Text style={[styles.sectionCountText, { color: appColors.secondary }]}>{count}</Text>
          </View>
        )}
      </View>
      {onViewAll && (
        <Pressable onPress={onViewAll} style={styles.viewAllButton}>
          <Text style={[styles.viewAllText, { color: appColors.primary }]}>View all</Text>
          <MaterialCommunityIcons name="arrow-right" size={16} color={appColors.primary} />
        </Pressable>
      )}
    </View>
  );
}

// Compact Agenda Task Item
function AgendaTaskItem({ task, onPress, onComplete, onLongPress, isSelecting, isSelected }: { task: Task; onPress: () => void; onComplete: () => void; onLongPress?: () => void; isSelecting?: boolean; isSelected?: boolean }) {
  const { colors } = useTheme();
  const appColors = useAppColors();
  const priorityColor = task.priority === "high" ? appColors.priorityHigh : task.priority === "medium" ? appColors.priorityMedium : appColors.priorityLow;
  const startTime = task.scheduled_start ? format(new Date(task.scheduled_start), "h:mm a") : "--:--";
  const endTime = task.scheduled_end ? format(new Date(task.scheduled_end), "h:mm a") : "";

  // Check if task is currently active
  const isActive = task.scheduled_start && task.scheduled_end &&
    isWithinInterval(new Date(), {
      start: new Date(task.scheduled_start),
      end: new Date(task.scheduled_end)
    });

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={[styles.agendaItem, isActive && [styles.agendaItemActive, { backgroundColor: appColors.primaryLight }], isSelected && { backgroundColor: appColors.primaryLight }]}>
      {isSelecting && (
        <MaterialCommunityIcons
          name={isSelected ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
          size={22}
          color={isSelected ? appColors.primary : appColors.textTertiary}
          style={{ marginRight: 8 }}
        />
      )}
      <View style={[styles.agendaTimeCol, isActive && styles.agendaTimeColActive]}>
        <Text style={[styles.agendaTime, { color: appColors.textSecondary }, isActive && { color: appColors.primary }]}>{startTime}</Text>
        {endTime && <Text style={[styles.agendaTimeEnd, { color: appColors.textTertiary }]}>{endTime}</Text>}
      </View>
      <View style={styles.agendaContent}>
        <Text style={[styles.agendaTitle, { color: appColors.textPrimary }]} numberOfLines={1}>{task.title}</Text>
        <Text style={[styles.agendaDuration, { color: appColors.textTertiary }]}>{task.duration_minutes}m</Text>
      </View>
      {!isSelecting && (
        <Pressable onPress={onComplete} style={styles.agendaCheck} hitSlop={10}>
          <MaterialCommunityIcons
            name="checkbox-blank-circle-outline"
            size={22}
            color={priorityColor}
          />
        </Pressable>
      )}
    </Pressable>
  );
}

// Compact Agenda Event Item (calendar events)
function AgendaEventItem({ event }: { event: CalendarEvent }) {
  const { colors } = useTheme();
  const appColors = useAppColors();
  const startTime = format(parseISO(event.start_time), "h:mm a");

  return (
    <View style={styles.agendaItem}>
      <View style={styles.agendaTimeCol}>
        <Text style={[styles.agendaTime, { color: appColors.textSecondary }]}>{startTime}</Text>
      </View>
      <View style={[styles.agendaDot, { backgroundColor: appColors.textTertiary }]} />
      <View style={styles.agendaContent}>
        <Text style={[styles.agendaTitle, styles.agendaEventTitle, { color: appColors.textSecondary }]} numberOfLines={1}>
          {event.title}
        </Text>
        <View style={styles.agendaEventBadge}>
          <MaterialCommunityIcons name="calendar" size={10} color={appColors.textTertiary} />
          <Text style={[styles.agendaEventLabel, { color: appColors.textTertiary }]}>Event</Text>
        </View>
      </View>
    </View>
  );
}

// Completed Task Row — agenda-style row with strikethrough
function CompletedTaskRow({ task, onPress, onUndo }: { task: Task; onPress: () => void; onUndo?: () => void }) {
  const appColors = useAppColors();
  const startTime = task.scheduled_start ? format(new Date(task.scheduled_start), "h:mm a") : "";

  return (
    <Pressable onPress={onPress} style={styles.agendaItem}>
      <View style={styles.agendaTimeCol}>
        <Text style={[styles.agendaTime, { color: appColors.textTertiary }]} numberOfLines={1}>{startTime || "Done"}</Text>
      </View>
      <View style={[styles.agendaDot, { backgroundColor: appColors.success }]} />
      <View style={styles.agendaContent}>
        <Text style={[styles.agendaTitle, { color: appColors.textTertiary, textDecorationLine: "line-through" }]} numberOfLines={1}>{task.title}</Text>
        <Text style={[styles.agendaDuration, { color: appColors.textTertiary }]}>{task.duration_minutes}m</Text>
      </View>
      {onUndo && (
        <Pressable onPress={onUndo} hitSlop={8} style={[styles.miniCompletePill, { backgroundColor: appColors.chipBg }]}>
          <MaterialCommunityIcons name="undo-variant" size={14} color={appColors.textTertiary} />
        </Pressable>
      )}
    </Pressable>
  );
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const { isConnected } = useNetwork();
  const appColors = useAppColors();
  const { isDark } = useThemeMode();
  const [displayName, setDisplayName] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overdueExpanded, setOverdueExpanded] = useState(true);
  const [missedSlotExpanded, setMissedSlotExpanded] = useState(true);
  const [pendingExpanded, setPendingExpanded] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // Auto-reschedule intro modal + toast
  const [showAutoRescheduleIntro, setShowAutoRescheduleIntro] = useState(false);
  const [autoRescheduleEnabled, setAutoRescheduleEnabled] = useState(true);
  const [rescheduleToast, setRescheduleToast] = useState<{
    taskTitle: string; taskId: string; newSlot: TimeSlot; prevStart?: string; prevEnd?: string;
  } | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  // Batch auto-reschedule toast
  const [batchToast, setBatchToast] = useState<{
    count: number;
    tasks: Array<{ taskId: string; taskTitle: string; newStart: string; prevStart?: string; prevEnd?: string }>;
  } | null>(null);
  const batchToastAnim = useRef(new Animated.Value(0)).current;
  const batchToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Complete-task undo toast
  const [completeToast, setCompleteToast] = useState<{ taskId: string; taskTitle: string; prevStatus: Task["status"] } | null>(null);
  const completeToastAnim = useRef(new Animated.Value(0)).current;
  const completeToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Multi-select state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Quick-add sheet state
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // Scheduling feedback modal state (for quick-complete of AI-scheduled tasks)
  const [showSchedulingFeedback, setShowSchedulingFeedback] = useState(false);
  const [feedbackTask, setFeedbackTask] = useState<Task | null>(null);

  // Guided tour
  const { tourStep, advanceTour, skipTour } = useGuidedTour();
  const { refreshAIUsage, isPro, features } = useSubscription();
  const isInAddTaskFlow = [
    "tour_task_title", "tour_task_duration", "tour_task_priority",
    "tour_task_due", "tour_task_tag", "tour_task_create_ai",
  ].includes(tourStep ?? "");

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
      setError(null);

      // Get user name + auto-reschedule enabled flag
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name, personality_data")
        .single();

      if (profile?.display_name) {
        setDisplayName(profile.display_name.split(" ")[0]);
      }
      if (profile?.personality_data?.auto_reschedule_enabled !== undefined) {
        setAutoRescheduleEnabled(profile.personality_data.auto_reschedule_enabled);
      }

      // Get tasks — apply 30-day history limit for free users
      let tasksQuery = supabase
        .from("tasks")
        .select("*")
        .order("scheduled_start", { ascending: true, nullsFirst: false });

      if (!isPro && features.task_history_days !== -1) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - features.task_history_days);
        tasksQuery = tasksQuery.gte("created_at", cutoff.toISOString());
      }

      const { data: tasksData, error: tasksError } = await tasksQuery;

      if (tasksError) {
        throw new Error("Failed to load tasks. Please check your connection.");
      }
      setTasks(tasksData || []);

      // Compute missed slot tasks from fresh data (before re-render) for auto-reschedule check
      const freshParentTasks = (tasksData || []).filter((t: Task) => !t.parent_task_id);
      const todayStart = startOfDay(new Date());
      const freshOverdueIds = new Set(freshParentTasks.filter((t: Task) => {
        if (t.status === "completed" || t.status === "cancelled") return false;
        if (t.scheduled_start && !isPast(new Date(t.scheduled_end || t.scheduled_start))) return false;
        if (t.scheduled_end && isPast(new Date(t.scheduled_end)) && t.due_date && !isBefore(new Date(t.due_date), todayStart)) return false;
        if (t.due_date && isBefore(new Date(t.due_date), todayStart)) return true;
        if (t.scheduled_end && isPast(new Date(t.scheduled_end)) && t.status === "scheduled") return true;
        return false;
      }).map((t: Task) => t.id));
      const freshMissedSlotTasks = freshParentTasks.filter((t: Task) => {
        if (t.status === "completed" || t.status === "cancelled") return false;
        if (freshOverdueIds.has(t.id)) return false;
        if (!t.scheduled_end || !t.due_date) return false;
        return isPast(new Date(t.scheduled_end)) && !isBefore(new Date(t.due_date), todayStart);
      });
      if (freshMissedSlotTasks.length > 0) {
        checkMissedSlotState(freshMissedSlotTasks);
      }

      // Load calendar events (non-blocking, don't fail whole load)
      await loadCalendarEvents();
    } catch (err) {
      console.error("[Home] Error loading data:", err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Bulk reschedule modal state
  const [showBulkReschedule, setShowBulkReschedule] = useState(false);
  const [showRescheduleAllInfo, setShowRescheduleAllInfo] = useState(false);

  const handleRescheduleAll = () => {
    setShowBulkReschedule(true);
  };

  // ============================================
  // Auto-Reschedule (Grey Zone / Missed Slot)
  // ============================================
  const showRescheduleToast = (title: string, slot: TimeSlot, taskId: string, prevStart?: string, prevEnd?: string) => {
    setRescheduleToast({ taskTitle: title, taskId, newSlot: slot, prevStart, prevEnd });
    Animated.spring(toastAnim, { toValue: 1, useNativeDriver: true }).start();
    setTimeout(() => hideRescheduleToast(), 15000);
  };

  const hideRescheduleToast = () => {
    Animated.timing(toastAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(
      () => setRescheduleToast(null)
    );
  };

  const handleUndoReschedule = async () => {
    if (!rescheduleToast) return;
    hideRescheduleToast();
    await supabase.from("tasks").update({
      scheduled_start: rescheduleToast.prevStart || null,
      scheduled_end: rescheduleToast.prevEnd || null,
      status: rescheduleToast.prevStart ? "scheduled" : "pending_schedule",
    }).eq("id", rescheduleToast.taskId);
    loadData();
  };

  const showBatchToast = (tasks: Array<{ taskId: string; taskTitle: string; newStart: string; prevStart?: string; prevEnd?: string }>) => {
    if (batchToastTimer.current) clearTimeout(batchToastTimer.current);
    setBatchToast({ count: tasks.length, tasks });
    Animated.spring(batchToastAnim, { toValue: 1, useNativeDriver: true }).start();
    batchToastTimer.current = setTimeout(() => hideBatchToast(), 15000);
  };

  const hideBatchToast = () => {
    Animated.timing(batchToastAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(
      () => setBatchToast(null)
    );
  };

  const handleUndoBatchReschedule = async () => {
    if (!batchToast) return;
    hideBatchToast();
    await Promise.all(
      batchToast.tasks.map(({ taskId, prevStart, prevEnd }) =>
        supabase.from("tasks").update({
          scheduled_start: prevStart || null,
          scheduled_end: prevEnd || null,
          status: prevStart ? "scheduled" : "pending_schedule",
        }).eq("id", taskId)
      )
    );
    loadData();
  };

  const showCompleteToast = (taskId: string, taskTitle: string, prevStatus: Task["status"]) => {
    if (completeToastTimer.current) clearTimeout(completeToastTimer.current);
    setCompleteToast({ taskId, taskTitle, prevStatus });
    Animated.spring(completeToastAnim, { toValue: 1, useNativeDriver: true }).start();
    completeToastTimer.current = setTimeout(() => hideCompleteToast(), 5000);
  };

  const hideCompleteToast = () => {
    Animated.timing(completeToastAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(
      () => setCompleteToast(null)
    );
  };

  const handleUndoComplete = async () => {
    if (!completeToast) return;
    const { taskId, prevStatus } = completeToast;
    hideCompleteToast();
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: prevStatus } : t));
    await supabase.from("tasks").update({ status: prevStatus }).eq("id", taskId);
  };

  const handleUndoCompleteTask = async (task: Task) => {
    const restoredStatus = task.scheduled_start ? "scheduled" : "pending_schedule";
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: restoredStatus as const } : t));
    await supabase.from("tasks").update({ status: restoredStatus }).eq("id", task.id);
  };

  const autoRescheduleGreyZone = async (tasks: Task[]) => {
    const now = new Date();
    const todayStr = format(now, "yyyy-MM-dd");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from("user_profiles").select("*").eq("id", user.id).single();
    if (!profile) return; // no profile — can't schedule without user context
    const pd = profile.personality_data;
    if (pd?.auto_reschedule_enabled === false) return;

    // Stored as minutes from midnight; migrate old hour values (< 24) on the fly
    const rawMorning = pd?.auto_reschedule_morning ?? 540;
    const rawEvening = pd?.auto_reschedule_evening ?? 1140;
    const morningMinutes: number = rawMorning < 24 ? rawMorning * 60 : rawMorning;
    const eveningMinutes: number = rawEvening < 24 ? rawEvening * 60 : rawEvening;

    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Run once per day after each configured time (key includes the minute value so it resets if user changes time)
    const morningKey = `autoRescheduleDate_m${morningMinutes}`;
    const eveningKey = `autoRescheduleDate_e${eveningMinutes}`;
    const lastMorning = await AsyncStorage.getItem(morningKey);
    const lastEvening = await AsyncStorage.getItem(eveningKey);

    const shouldRunMorning = currentMinutes >= morningMinutes && lastMorning !== todayStr;
    const shouldRunEvening = currentMinutes >= eveningMinutes && lastEvening !== todayStr;

    if (!shouldRunMorning && !shouldRunEvening) return;
    if (shouldRunMorning) await AsyncStorage.setItem(morningKey, todayStr);
    if (shouldRunEvening) await AsyncStorage.setItem(eveningKey, todayStr);
    const { data: existingTasks } = await supabase.from("tasks").select("*")
      .in("status", ["scheduled", "pending_schedule"]);
    const { data: calendarEvents } = await supabase.from("calendar_events").select("*")
      .gte("end_time", new Date().toISOString());

    const rescheduled: Array<{ taskId: string; prevStart?: string; prevEnd?: string }> = [];

    for (const task of tasks) {
      if (!task.due_date) continue;
      if (task.auto_reschedule === false) continue;

      // Treat due date as end-of-day — stored as midnight UTC but intent is "by end of that day"
      const dueDate = endOfDay(new Date(task.due_date));

      if (task.scheduled_end) {
        const minutesSinceMissed = differenceInMinutes(new Date(), new Date(task.scheduled_end));
        if (minutesSinceMissed < 1) continue; // grace period
      }

      try {
        const daysLeft = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const taskListForScheduling = (existingTasks || []).filter((t: Task) => t.id !== task.id);

        const result = await scheduleTask({
          task,
          userProfile: profile,
          existingEvents: calendarEvents || [],
          existingTasks: taskListForScheduling,
          lookAheadDays: Math.min(daysLeft, 14),
        });

        if (result.slots.length > 0) {
          const slot = result.slots[0];
          const success = await saveScheduledSlot(task, slot);
          if (success) {
            rescheduled.push({ taskId: task.id, taskTitle: task.title, newStart: slot.start, prevStart: task.scheduled_start ?? undefined, prevEnd: task.scheduled_end ?? undefined });
          }
        }
      } catch (e) {
        console.warn("[AutoReschedule] Failed for task:", task.id, e);
      }
    }

    if (rescheduled.length > 0) {
      showBatchToast(rescheduled);
    }

    loadData();
  };

  const checkMissedSlotState = async (tasks: Task[]) => {
    if (tasks.length === 0) return;

    // Check if the user has already made a choice about auto-reschedule.
    // Once they have, Supabase (auto_reschedule_enabled) is the single source of truth.
    const introSeen = await AsyncStorage.getItem("autoRescheduleIntroSeen");
    if (introSeen === "true") {
      autoRescheduleGreyZone(tasks);
      return;
    }

    // Haven't decided yet — show intro, but stop after 3 declines
    const countStr = await AsyncStorage.getItem("autoRescheduleDeclineCount");
    const count = parseInt(countStr || "0");
    if (count >= 3) {
      // Silently treat as disabled — no more prompting
      await AsyncStorage.setItem("autoRescheduleIntroSeen", "true");
      return;
    }

    setShowAutoRescheduleIntro(true);
  };

  const handleAutoRescheduleEnable = async () => {
    await AsyncStorage.setItem("autoRescheduleIntroSeen", "true");
    // Save enabled=true to Supabase so Settings and this flag stay in sync
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile } = await supabase.from("user_profiles").select("personality_data").eq("id", user?.id).single();
    await supabase.from("user_profiles").update({
      personality_data: {
        ...profile?.personality_data,
        auto_reschedule_enabled: true,
        auto_reschedule_tz_offset: -new Date().getTimezoneOffset() / 60,
      },
    }).eq("id", user?.id);
    setShowAutoRescheduleIntro(false);
    autoRescheduleGreyZone(missedSlotTasks);
  };

  const handleAutoRescheduleDecline = async () => {
    const countStr = await AsyncStorage.getItem("autoRescheduleDeclineCount");
    const count = parseInt(countStr || "0") + 1;
    await AsyncStorage.setItem("autoRescheduleDeclineCount", String(count));
    if (count >= 3) {
      // Permanently declined — write to Supabase and never show intro again
      await AsyncStorage.setItem("autoRescheduleIntroSeen", "true");
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("user_profiles").select("personality_data").eq("id", user?.id).single();
      await supabase.from("user_profiles").update({
        personality_data: { ...profile?.personality_data, auto_reschedule_enabled: false },
      }).eq("id", user?.id);
    }
    setShowAutoRescheduleIntro(false);
  };

  const handleToggleAutoReschedule = async (value: boolean) => {
    // Optimistic update
    setAutoRescheduleEnabled(value);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("user_profiles").select("personality_data").eq("id", user?.id).single();
      await supabase.from("user_profiles").update({
        personality_data: { ...profile?.personality_data, auto_reschedule_enabled: value },
      }).eq("id", user?.id);
      // If user explicitly enabled, mark intro as seen so we don't re-prompt
      if (value) await AsyncStorage.setItem("autoRescheduleIntroSeen", "true");
    } catch (e) {
      console.error("[Home] Failed to save auto-reschedule toggle:", e);
      setAutoRescheduleEnabled(!value); // revert on failure
    }
  };

  // Multi-select helpers
  const toggleSelection = (taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
        if (next.size === 0) setIsSelecting(false);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const enterSelectionMode = (taskId: string) => {
    setIsSelecting(true);
    setSelectedIds(new Set([taskId]));
  };

  const handleLongPress = (task: Task) => {
    enterSelectionMode(task.id);
  };

  const handleRescheduleOne = (task: Task) => {
    router.push(`/task/${task.id}?reschedule=true`);
  };

  const exitSelectionMode = () => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  };

  const handleBulkComplete = async () => {
    if (selectedIds.size === 0) return;
    try {
      const ids = Array.from(selectedIds);
      // Optimistic update
      setTasks((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, status: "completed" as const } : t)));
      exitSelectionMode();

      const { error: updateError } = await supabase
        .from("tasks")
        .update({ status: "completed" })
        .in("id", ids);

      if (updateError) throw updateError;
    } catch (err) {
      console.error("[Home] Bulk complete error:", err);
      loadData(); // Revert by reloading
    }
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    Alert.alert(
      `Delete ${selectedIds.size} task${selectedIds.size > 1 ? "s" : ""}?`,
      "This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const ids = Array.from(selectedIds);
              setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
              exitSelectionMode();

              const { error: deleteError } = await supabase
                .from("tasks")
                .delete()
                .in("id", ids);

              if (deleteError) throw deleteError;
            } catch (err) {
              console.error("[Home] Bulk delete error:", err);
              loadData();
            }
          },
        },
      ]
    );
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
      if (t.scheduled_start && !isPast(new Date(t.scheduled_end || t.scheduled_start))) return false;
      // Grey zone exclusion: scheduled past but due date still today or future → NOT overdue
      if (t.scheduled_end && isPast(new Date(t.scheduled_end)) && t.due_date && !isBefore(new Date(t.due_date), todayStart)) return false;
      if (t.due_date && isBefore(new Date(t.due_date), todayStart)) return true;
      if (t.scheduled_end && isPast(new Date(t.scheduled_end)) && t.status === "scheduled") return true;
      return false;
    });
  }, [parentTasks]);

  const overdueIds = useMemo(() => new Set(overdueTasks.map((t) => t.id)), [overdueTasks]);

  // Missed slot tasks: scheduled time passed but due date is still future
  const missedSlotTasks = useMemo(() => {
    const todayStart = startOfDay(new Date());
    return parentTasks.filter((t) => {
      if (t.status === "completed" || t.status === "cancelled") return false;
      if (overdueIds.has(t.id)) return false;
      if (!t.scheduled_end || !t.due_date) return false;
      return isPast(new Date(t.scheduled_end)) && !isBefore(new Date(t.due_date), todayStart);
    });
  }, [parentTasks, overdueIds]);

  const missedSlotIds = useMemo(() => new Set(missedSlotTasks.map((t) => t.id)), [missedSlotTasks]);

  const todayTasks = useMemo(
    () => parentTasks.filter(
      (t) => t.scheduled_start && isToday(new Date(t.scheduled_start)) && t.status === "scheduled" && !overdueIds.has(t.id)
    ),
    [parentTasks, overdueIds]
  );

  const completedTodayTasks = useMemo(
    () => parentTasks.filter(
      (t) => t.status === "completed" && (
        (t.scheduled_start && isToday(new Date(t.scheduled_start))) ||
        (t.updated_at && isToday(new Date(t.updated_at)))
      )
    ),
    [parentTasks]
  );

  const upcomingTasks = useMemo(
    () => parentTasks.filter(
      (t) => t.scheduled_start && isFuture(startOfDay(new Date(t.scheduled_start))) && !isToday(new Date(t.scheduled_start)) && t.status === "scheduled" && !overdueIds.has(t.id) && !missedSlotIds.has(t.id)
    ),
    [parentTasks, overdueIds, missedSlotIds]
  );

  const pendingTasks = useMemo(
    () => parentTasks.filter((t) => t.status === "pending_schedule" && !overdueIds.has(t.id) && !missedSlotIds.has(t.id)),
    [parentTasks, overdueIds, missedSlotIds]
  );

  // Stats for welcome card
  // "today" should be TOTAL tasks for today (scheduled + completed), not just remaining
  const taskStats = useMemo(() => ({
    today: todayTasks.length + completedTodayTasks.length,
    completed: completedTodayTasks.length,
  }), [todayTasks, completedTodayTasks]);

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

  const [actionError, setActionError] = useState<string | null>(null);

  const handleMarkDone = async (task: Task) => {
    // For AI-scheduled tasks, show feedback modal at most once per day (unless opted out)
    if (task.scheduling_method === "SMART" && task.scheduled_start) {
      const [disabled, lastFeedbackDate] = await Promise.all([
        AsyncStorage.getItem(SCHEDULING_FEEDBACK_DISABLED_KEY),
        AsyncStorage.getItem("lastSchedulingFeedbackDate"),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      if (!disabled && lastFeedbackDate !== today) {
        await AsyncStorage.setItem("lastSchedulingFeedbackDate", today);
        setFeedbackTask(task);
        setShowSchedulingFeedback(true);
        return;
      }
    }

    await completeTask(task);
  };

  const completeTask = async (task: Task) => {
    const prevStatus = task.status;
    try {
      setActionError(null);

      // Advance guided tour: complete_task → states
      if (tourStep === "tour_complete_task") {
        await advanceTour("tour_states");
      }

      // Optimistic UI update - immediately show task as completed
      setTasks(prevTasks => prevTasks.map(t =>
        t.id === task.id ? { ...t, status: "completed" as const, updated_at: new Date().toISOString() } : t
      ));
      showCompleteToast(task.id, task.title, prevStatus);

      if (!isConnected) {
        // Queue operation for when back online
        await queueOperation("complete_task", { taskId: task.id });
        console.log("[Home] Queued complete_task for offline sync");
        return;
      }

      const { error: updateError } = await supabase.from("tasks").update({ status: "completed" }).eq("id", task.id);
      if (updateError) throw updateError;
    } catch (err) {
      console.error("[Home] Error marking task done:", err);
      // Revert optimistic update on failure
      setTasks(prevTasks => prevTasks.map(t =>
        t.id === task.id ? { ...t, status: task.status } : t
      ));
      setActionError("Couldn't complete task. Please try again.");
      setTimeout(() => setActionError(null), 3000);
    }
  };

  const handleSchedulingFeedbackComplete = () => {
    setShowSchedulingFeedback(false);
    if (feedbackTask) {
      completeTask(feedbackTask);
      setFeedbackTask(null);
    }
  };

  const handleTaskPress = (task: Task) => {
    router.push(`/task/${task.id}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={appColors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
        <View style={styles.errorContainer}>
          <ErrorState
            title="Couldn't load your tasks"
            message={error}
            onRetry={loadData}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={["top"]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[appColors.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Welcome Card */}
        <WelcomeCard displayName={displayName} taskStats={taskStats} />

        {/* Tour Reward Modal — shown after AI task scheduled */}
        <TourRewardModal
          visible={tourStep === "tour_ai_reward"}
          onCta={async () => {
            await refreshAIUsage();
            await advanceTour("tour_complete_task");
          }}
        />

        {/* Tour States Modal */}
        <TourStatesModal
          visible={tourStep === "tour_states"}
          onClose={() => advanceTour("tour_add_manual")}
        />

        {/* Action Error Toast */}
        {actionError && (
          <View style={styles.actionErrorWrapper}>
            <ErrorState
              message={actionError}
              variant="inline"
              onRetry={() => setActionError(null)}
            />
          </View>
        )}

        {/* Search Bar */}
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          onClear={() => setSearchQuery("")}
        />

        {/* Tag Filter Pills */}
        {allTags.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tagFilterScroll}
            contentContainerStyle={styles.tagFilterContent}
          >
            <Pressable
              style={[styles.tagPill, { backgroundColor: appColors.surface, borderColor: appColors.border }, selectedTag === null && { backgroundColor: appColors.primary, borderColor: appColors.primary }]}
              onPress={() => setSelectedTag(null)}
            >
              <Text style={[styles.tagPillText, { color: appColors.textSecondary }, selectedTag === null && styles.tagPillTextActive]}>All</Text>
            </Pressable>
            {allTags.map((tag) => (
              <Pressable
                key={tag}
                style={[styles.tagPill, { backgroundColor: appColors.surface, borderColor: appColors.border }, selectedTag === tag && { backgroundColor: appColors.primary, borderColor: appColors.primary }]}
                onPress={() => setSelectedTag(selectedTag === tag ? null : tag)}
              >
                <Text style={[styles.tagPillText, { color: appColors.textSecondary }, selectedTag === tag && styles.tagPillTextActive]}>{tag}</Text>
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
            <View style={[styles.agendaWrapper, { backgroundColor: appColors.surface }]}>
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
                      onPress={() => isSelecting ? toggleSelection(entry.item.id) : handleTaskPress(entry.item as Task)}
                      onComplete={() => handleMarkDone(entry.item as Task)}
                      onLongPress={() => handleLongPress(entry.item as Task)}
                      isSelecting={isSelecting}
                      isSelected={selectedIds.has(entry.item.id)}
                    />
                  ) : (
                    <AgendaEventItem key={entry.item.id} event={entry.item as CalendarEvent} />
                  )
                ))
              }
              {(todayTasks.length + todayEvents.length) > 5 && (
                <Pressable style={styles.seeMoreButton} onPress={() => router.push("/(tabs)/calendar")}>
                  <Text style={[styles.seeMoreText, { color: appColors.primary }]}>
                    +{todayTasks.length + todayEvents.length - 5} more items
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={appColors.primary} />
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Completed Today (TickTick-style) */}
        {completedTodayTasks.length > 0 && (
          <View style={styles.section}>
            <CollapsibleSectionRefined
              title="Completed"
              count={completedTodayTasks.length}
              isExpanded={completedExpanded}
              onToggle={() => setCompletedExpanded(!completedExpanded)}
            >
              {completedTodayTasks.map((task) => (
                <CompletedTaskRow
                  key={task.id}
                  task={task}
                  onPress={() => handleTaskPress(task)}
                  onUndo={() => handleUndoCompleteTask(task)}
                />
              ))}
            </CollapsibleSectionRefined>
          </View>
        )}

        {/* Overdue Tasks */}
        {overdueTasks.length > 0 && (
          <View style={styles.section}>
            {/* Reschedule All button */}
            <View>
              <View style={styles.overdueHeaderRow}>
                <View style={{ flex: 1 }} />
                <Pressable
                  onPress={() => setShowRescheduleAllInfo((v) => !v)}
                  hitSlop={10}
                  style={{ marginRight: 8, justifyContent: "center" }}
                >
                  <MaterialCommunityIcons
                    name={showRescheduleAllInfo ? "information" : "information-outline"}
                    size={16}
                    color={appColors.textTertiary}
                  />
                </Pressable>
                <Pressable
                  style={[styles.rescheduleAllPill, { backgroundColor: appColors.primaryLight }]}
                  onPress={handleRescheduleAll}
                >
                  <MaterialCommunityIcons name="calendar-refresh" size={14} color={appColors.primary} />
                  <Text style={[styles.rescheduleAllText, { color: appColors.primary }]}>Reschedule All</Text>
                </Pressable>
              </View>
              {showRescheduleAllInfo && (
                <View style={[styles.sectionInfoBanner, { backgroundColor: appColors.primaryLight, marginTop: 0, marginBottom: 8 }]}>
                  <Text style={[styles.sectionInfoText, { color: appColors.primary }]}>
                    Opens a workflow to reschedule all overdue tasks at once. You can pick a new deadline, choose how each task is scheduled (AI, fixed time, or ASAP), and review before confirming.
                  </Text>
                </View>
              )}
            </View>
            <CollapsibleSectionRefined
              title="Overdue"
              count={overdueTasks.length}
              isExpanded={overdueExpanded}
              onToggle={() => setOverdueExpanded(!overdueExpanded)}
              variant="error"
              infoText="These tasks have passed their due date. Reschedule or complete them as soon as possible to stay on track."
            >
              {overdueTasks.map((task) => (
                <TaskCardRefined
                  key={task.id}
                  task={task}
                  onPress={() => isSelecting ? toggleSelection(task.id) : handleTaskPress(task)}
                  onLongPress={() => handleLongPress(task)}
                  onReschedule={() => handleRescheduleOne(task)}
                  onComplete={() => handleMarkDone(task)}
                  progress={getSubtaskProgress(task.id)}
                  isOverdue={true}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(task.id)}
                />
              ))}
            </CollapsibleSectionRefined>
          </View>
        )}

        {/* Missed Slot Tasks */}
        {missedSlotTasks.length > 0 && (
          <View style={styles.section}>
            <CollapsibleSectionRefined
              title="Missed Slot"
              count={missedSlotTasks.length}
              isExpanded={missedSlotExpanded}
              onToggle={() => setMissedSlotExpanded(!missedSlotExpanded)}
              variant="warning"
              infoText="These tasks missed their scheduled time but their due date hasn't passed yet. You still have time — reschedule them to a new slot."
            >
              {missedSlotTasks.map((task) => (
                <TaskCardRefined
                  key={task.id}
                  task={task}
                  onPress={() => isSelecting ? toggleSelection(task.id) : handleTaskPress(task)}
                  onLongPress={() => handleLongPress(task)}
                  onReschedule={() => handleRescheduleOne(task)}
                  onComplete={() => handleMarkDone(task)}
                  progress={getSubtaskProgress(task.id)}
                  isMissedSlot={true}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(task.id)}
                />
              ))}
              <View style={[styles.missedSlotBanner, {
                backgroundColor: isDark ? appColors.warningLight : `${appColors.warning}18`,
                borderWidth: 1,
                borderColor: isDark ? `${appColors.warning}30` : `${appColors.warning}55`,
              }]}>
                {/* Info row */}
                <View style={styles.missedSlotBannerRow}>
                  <MaterialCommunityIcons name="information-outline" size={14} color={isDark ? appColors.warning : "#B45309"} />
                  <Text style={[styles.missedSlotBannerText, { color: isDark ? appColors.warning : "#B45309" }]}>
                    Slot missed — due date still upcoming
                  </Text>
                </View>
                {/* Auto-reschedule toggle row */}
                <View style={styles.missedSlotToggleRow}>
                  <Text style={[styles.missedSlotToggleLabel, { color: isDark ? appColors.warning : "#92400E" }]}>
                    Auto-reschedule
                  </Text>
                  <Switch
                    value={autoRescheduleEnabled}
                    onValueChange={handleToggleAutoReschedule}
                    trackColor={{ false: isDark ? "#555" : "#d1d5db", true: `${appColors.primary}80` }}
                    thumbColor={autoRescheduleEnabled ? appColors.primary : (isDark ? "#aaa" : "#9ca3af")}
                    style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
                  />
                </View>
              </View>
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
              variant="pending"
            >
              {pendingTasks.map((task) => (
                <TaskCardRefined
                  key={task.id}
                  task={task}
                  onPress={() => isSelecting ? toggleSelection(task.id) : handleTaskPress(task)}
                  onLongPress={() => handleLongPress(task)}
                  onReschedule={() => handleRescheduleOne(task)}
                  onComplete={() => handleMarkDone(task)}
                  progress={getSubtaskProgress(task.id)}
                  isPending={true}
                  isSelecting={isSelecting}
                  isSelected={selectedIds.has(task.id)}
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
                onPress={() => isSelecting ? toggleSelection(task.id) : handleTaskPress(task)}
                onLongPress={() => handleLongPress(task)}
                onComplete={() => handleMarkDone(task)}
                progress={getSubtaskProgress(task.id)}
                isSelecting={isSelecting}
                isSelected={selectedIds.has(task.id)}
              />
            ))}
          </View>
        )}

        {/* No Search Results State */}
        {searchQuery.trim() && parentTasks.length === 0 && tasks.length > 0 && (
          <View style={[styles.noResultsState, { backgroundColor: appColors.surface }]}>
            <MaterialCommunityIcons name="file-search-outline" size={48} color={appColors.textTertiary} />
            <Text style={[styles.noResultsTitle, { color: appColors.textPrimary }]}>No tasks found</Text>
            <Text style={[styles.noResultsText, { color: appColors.textSecondary }]}>
              No tasks match "{searchQuery}"
            </Text>
            <Pressable style={[styles.clearSearchButton, { backgroundColor: appColors.secondaryLight }]} onPress={() => setSearchQuery("")}>
              <Text style={[styles.clearSearchText, { color: appColors.secondary }]}>Clear search</Text>
            </Pressable>
          </View>
        )}

        {/* Empty State */}
        {tasks.length === 0 && (
          <View style={styles.emptyState}>
            <LinearGradient
              colors={[appColors.secondaryLight, appColors.primaryLight]}
              style={styles.emptyStateGradient}
            >
              <MaterialCommunityIcons name="robot-outline" size={64} color={appColors.secondary} />
              <Text style={[styles.emptyStateTitle, { color: appColors.textPrimary }]}>Ready to plan your day?</Text>
              <Text style={[styles.emptyStateText, { color: appColors.textSecondary }]}>
                Add your first task and let AI find the perfect time for it.
              </Text>
              <Pressable style={styles.emptyStateButton} onPress={() => router.push("/(tabs)/add-task")}>
                <LinearGradient
                  colors={[appColors.gradientStart, appColors.gradientEnd]}
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
          <View style={[styles.nothingTodayCard, { backgroundColor: appColors.surface }]}>
            <MaterialCommunityIcons name="calendar-check" size={40} color={appColors.textTertiary} />
            <Text style={[styles.nothingTodayTitle, { color: appColors.textPrimary }]}>All clear for today</Text>
            <Text style={[styles.nothingTodayText, { color: appColors.textSecondary }]}>
              {pendingTasks.length > 0
                ? `${pendingTasks.length} task${pendingTasks.length > 1 ? "s" : ""} waiting to be scheduled`
                : "Enjoy your free time or add a new task"}
            </Text>
          </View>
        )}

        {/* Spacer for FAB */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bulk Action Toolbar (when selecting) */}
      {isSelecting ? (
        <View style={[styles.bulkActionBar, { backgroundColor: appColors.surface, borderTopColor: appColors.border }]}>
          <Pressable onPress={exitSelectionMode} style={styles.bulkActionClose}>
            <MaterialCommunityIcons name="close" size={24} color={appColors.textPrimary} />
          </Pressable>
          <Text style={[styles.bulkActionCount, { color: appColors.textPrimary }]}>{selectedIds.size} selected</Text>
          <View style={styles.bulkActionButtons}>
            <Pressable onPress={handleBulkComplete} style={[styles.bulkCompleteButton, { backgroundColor: appColors.success }]}>
              <MaterialCommunityIcons name="check-all" size={20} color="#FFFFFF" />
              <Text style={styles.bulkButtonText}>Complete</Text>
            </Pressable>
            <Pressable onPress={handleBulkDelete} style={[styles.bulkDeleteButton, { backgroundColor: appColors.error }]}>
              <MaterialCommunityIcons name="delete-outline" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      ) : (
        /* Floating Action Button - solid */
        <Pressable
          style={styles.fabWrapper}
          onPress={() => {
            if (tourStep === "tour_add_task_start") {
              advanceTour("tour_task_title");
              router.push("/(tabs)/add-task");
            } else if (tourStep === "tour_add_manual") {
              // Don't advance tour — step stays at tour_add_manual; add-task advances when create is tapped
              router.push({ pathname: "/(tabs)/add-task", params: { tourMode: "manual" } });
            } else {
              setShowQuickAdd(true);
            }
          }}
        >
          <View style={[styles.fab, { backgroundColor: appColors.primary, shadowColor: appColors.primary }]}>
            <MaterialCommunityIcons name="plus" size={28} color="#FFFFFF" />
            {(tourStep === "tour_add_task_start" || tourStep === "tour_add_manual") && (
              <View style={{ position: "absolute", top: -4, right: -4 }}>
                <TourPulseDot visible color="#FFFFFF" size={8} />
              </View>
            )}
          </View>
        </Pressable>
      )}

      {/* Scheduling Feedback Modal for AI-scheduled tasks */}
      {feedbackTask && (
        <SchedulingFeedbackModal
          visible={showSchedulingFeedback}
          onComplete={handleSchedulingFeedbackComplete}
          taskId={feedbackTask.id}
          taskTitle={feedbackTask.title}
          scheduledStart={feedbackTask.scheduled_start || ""}
          scheduledEnd={feedbackTask.scheduled_end || ""}
        />
      )}

      {/* Quick Add Sheet */}
      <QuickAddSheet
        visible={showQuickAdd}
        onDismiss={() => setShowQuickAdd(false)}
        onCreated={() => { setShowQuickAdd(false); loadData(); }}
      />

      {/* Bulk Reschedule Modal */}
      <BulkRescheduleModal
        visible={showBulkReschedule}
        tasks={overdueTasks}
        onComplete={() => { setShowBulkReschedule(false); loadData(); }}
        onDismiss={() => setShowBulkReschedule(false)}
      />

      {/* Auto-Reschedule Intro Modal (contextual onboarding) */}
      <Modal
        visible={showAutoRescheduleIntro}
        transparent
        animationType="fade"
        onRequestClose={handleAutoRescheduleDecline}
      >
        <View style={styles.introModalOverlay}>
          <View style={[styles.introModalCard, { backgroundColor: appColors.surface }]}>
            <MaterialCommunityIcons name="clock-alert-outline" size={32} color={appColors.warning} />
            <Text style={[styles.introModalTitle, { color: appColors.textPrimary }]}>
              Missed Your Time Slot
            </Text>
            <Text style={[styles.introModalBody, { color: appColors.textSecondary }]}>
              You have {missedSlotTasks.length} task{missedSlotTasks.length > 1 ? "s" : ""} that missed {missedSlotTasks.length > 1 ? "their" : "its"} scheduled time, but {missedSlotTasks.length > 1 ? "they're" : "it's"} not overdue yet.
            </Text>
            <View style={[styles.introModalDivider, { backgroundColor: appColors.border }]} />
            <MaterialCommunityIcons name="lightning-bolt" size={20} color={appColors.primary} />
            <Text style={[styles.introModalFeatureTitle, { color: appColors.textPrimary }]}>
              Auto-Reschedule
            </Text>
            <Text style={[styles.introModalFeatureBody, { color: appColors.textSecondary }]}>
              I can automatically find better times for tasks like this — twice daily, at 9am and 7pm. You'll always see what changed and can undo it.
            </Text>
            <Pressable
              style={[styles.introModalPrimaryBtn, { backgroundColor: appColors.primary }]}
              onPress={handleAutoRescheduleEnable}
            >
              <Text style={styles.introModalPrimaryBtnText}>Enable Auto-Reschedule</Text>
            </Pressable>
            <Pressable style={styles.introModalSecondaryBtn} onPress={handleAutoRescheduleDecline}>
              <Text style={[styles.introModalSecondaryBtnText, { color: appColors.textSecondary }]}>
                I'll reschedule manually
              </Text>
            </Pressable>
            <Text style={[styles.introModalFooter, { color: appColors.textTertiary }]}>
              You can change this in Settings
            </Text>
          </View>
        </View>
      </Modal>

      {/* Single-task Undo Toast */}
      {rescheduleToast && (
        <Animated.View style={[
          styles.rescheduleToast,
          { backgroundColor: appColors.surface },
          {
            opacity: toastAnim,
            transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }],
          },
        ]}>
          <MaterialCommunityIcons name="calendar-check" size={18} color={appColors.success} />
          <Text style={[styles.toastText, { color: appColors.textPrimary }]} numberOfLines={1}>
            "{rescheduleToast.taskTitle}" moved to {format(new Date(rescheduleToast.newSlot.start), "EEE MMM d · h:mm a")}
          </Text>
          <Pressable onPress={handleUndoReschedule} hitSlop={8}>
            <Text style={[styles.toastUndo, { color: appColors.primary }]}>Undo</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Batch Auto-Reschedule Toast — top of screen */}
      {batchToast && (
        <Animated.View style={[
          styles.rescheduleToast,
          styles.topToast,
          { backgroundColor: appColors.surface },
          {
            opacity: batchToastAnim,
            transform: [{ translateY: batchToastAnim.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) }],
          },
        ]}>
          <MaterialCommunityIcons name="lightning-bolt" size={18} color={appColors.primary} />
          <Text style={[styles.toastText, { color: appColors.textPrimary }]} numberOfLines={1}>
            {batchToast.count === 1
              ? `"${batchToast.tasks[0].taskTitle}" → ${format(new Date(batchToast.tasks[0].newStart), "EEE, MMM d · h:mm a")}`
              : `${batchToast.count} tasks auto-rescheduled`}
          </Text>
          <Pressable onPress={handleUndoBatchReschedule} hitSlop={8}>
            <Text style={[styles.toastUndo, { color: appColors.primary }]}>Undo</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Complete Task Undo Toast */}
      {completeToast && (
        <Animated.View style={[
          styles.rescheduleToast,
          { backgroundColor: appColors.surface },
          {
            opacity: completeToastAnim,
            transform: [{ translateY: completeToastAnim.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }],
          },
        ]}>
          <MaterialCommunityIcons name="check-circle-outline" size={18} color={appColors.success} />
          <Text style={[styles.toastText, { color: appColors.textPrimary }]} numberOfLines={1}>
            "{completeToast.taskTitle}" completed
          </Text>
          <Pressable onPress={handleUndoComplete} hitSlop={8}>
            <Text style={[styles.toastUndo, { color: appColors.primary }]}>Undo</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Tour Tooltips for Home steps */}
      <TourTooltip
        visible={tourStep === "tour_welcome"}
        icon="hand-wave"
        iconColor={appColors.primary}
        title="Welcome!"
        body="Let me give you a 2-minute tour of DayWise."
        ctaLabel="Show me around"
        onCta={() => advanceTour("tour_add_task_start")}
        onSkip={skipTour}
        showSkip
      />
      <TourTooltip
        visible={tourStep === "tour_add_task_start"}
        icon="plus-circle"
        iconColor={appColors.primary}
        title="Create your first task"
        body="Tap the + button above to open the task creator. We'll build your first AI-scheduled task together."
        ctaLabel="Open task creator"
        onCta={() => {
          advanceTour("tour_task_title");
          router.push("/(tabs)/add-task");
        }}
        onSkip={skipTour}
        showSkip
        bottomOffset={90}
      />
      <TourTooltip
        visible={tourStep === "tour_complete_task"}
        icon="check-circle-outline"
        iconColor={appColors.success}
        title="Mark it done"
        body="Tap the check button on any task to complete it. AI tasks ask for quick feedback to improve future suggestions."
        ctaLabel="Got it"
        onCta={() => advanceTour("tour_states")}
        onSkip={skipTour}
        showSkip
      />
      <TourTooltip
        visible={tourStep === "tour_add_manual"}
        icon="gesture-tap"
        iconColor={appColors.secondary}
        title="Now schedule yourself"
        body="Tap the + button above to create another task. This time you'll pick your own time slot."
        ctaLabel="Open task creator"
        onCta={() => {
          // Don't advance tour step — add-task screen handles advance when task is created
          router.push({ pathname: "/(tabs)/add-task", params: { tourMode: "manual" } });
        }}
        onSkip={skipTour}
        showSkip
        bottomOffset={90}
      />
      <TourTooltip
        visible={isInAddTaskFlow}
        icon="arrow-left-circle-outline"
        iconColor={appColors.primary}
        title="Still creating your task?"
        body="Head back to finish setting it up — then we'll find you the perfect time."
        ctaLabel="Back to task"
        onCta={() => router.push("/(tabs)/add-task")}
        onSkip={skipTour}
        showSkip
      />
      <TourTooltip
        visible={tourStep === "tour_manual_done"}
        icon="arm-flex-outline"
        iconColor={appColors.success}
        title="You're in full control"
        body="Use AI for the best slot, or manual when you know exactly when."
        ctaLabel="See your schedule"
        onCta={() => {
          advanceTour("tour_go_calendar");
        }}
        onSkip={skipTour}
        showSkip
      />
      <TourTooltip
        visible={tourStep === "tour_go_calendar"}
        icon="calendar-month-outline"
        iconColor={appColors.primary}
        title="See your full schedule"
        body="Tap the Calendar tab to see all tasks laid out by time."
        ctaLabel="Go to Calendar"
        onCta={() => {
          advanceTour("tour_calendar_intro");
          router.push("/(tabs)/calendar");
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
  actionErrorWrapper: {
    marginHorizontal: 20,
    marginTop: 12,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },

  // Welcome Card - Warm with accurate progress bar
  welcomeCardWrapper: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
  },
  welcomeCard: {
    borderRadius: 20,
    padding: 20,
    overflow: "hidden",
  },
  welcomeTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  welcomeGreeting: {
    fontSize: 15,
    fontWeight: "500",
    color: "#92854C",
  },
  welcomeName: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1A1D23",
    letterSpacing: -0.5,
  },
  welcomeDate: {
    fontSize: 13,
    fontWeight: "600",
    color: "#92854C",
    backgroundColor: "rgba(255,255,255,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  welcomeProgressSection: {
    marginBottom: 20,
  },
  welcomeProgressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  welcomeMotivation: {
    fontSize: 15,
    color: "#5C5030",
    fontWeight: "600",
  },
  welcomeProgressPercent: {
    fontSize: 22,
    fontWeight: "700",
    color: "#D4A84B",
  },
  welcomeProgressTrack: {
    height: 10,
    backgroundColor: "#EDE5CC",
    borderRadius: 5,
    overflow: "hidden",
  },
  welcomeProgressFill: {
    height: "100%",
    backgroundColor: "#D4A84B",
    borderRadius: 5,
  },
  welcomeProgressDetail: {
    fontSize: 12,
    color: "#92854C",
    marginTop: 6,
  },
  welcomeStatsRow: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRadius: 12,
    padding: 4,
  },
  welcomeStatChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
  },
  welcomeStatChipNumber: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1A1D23",
  },
  welcomeStatChipLabel: {
    fontSize: 11,
    color: "#92854C",
    marginTop: 2,
  },

  // Search Bar
  searchBarWrapper: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textPrimary,
    padding: 0,
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
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
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
    backgroundColor: COLORS.secondaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.secondary,
  },
  viewAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.primary,
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

  // Task Card — neutral bg with left accent border
  taskCardWrapper: {
    marginBottom: 10,
  },
  taskCard: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 0,
    borderColor: "transparent",
  },
  taskCardContent: {
    padding: 16,
  },
  taskCardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 6,
  },
  taskCardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
    letterSpacing: -0.2,
  },
  priorityPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  priorityPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  taskCardBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 8,
  },
  miniReschedulePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#EBF4FF",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  miniRescheduleText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.primary,
  },
  taskCardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  miniCompletePill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  taskTagsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  taskTag: {
    backgroundColor: "rgba(255,255,255,0.6)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  taskTagText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  taskTagMore: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  taskProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  taskProgressBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  taskProgressText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
  taskMetaText: {
    fontSize: 13,
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
    paddingBottom: 8,
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
    color: COLORS.primary,
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
    color: COLORS.primary,
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
  noResultsState: {
    marginHorizontal: 20,
    marginTop: 40,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 40,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  noResultsTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginTop: 16,
    marginBottom: 6,
  },
  noResultsText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: 16,
  },
  clearSearchButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: COLORS.secondaryLight,
    borderRadius: 12,
  },
  clearSearchText: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.secondary,
  },

  // Overdue header with reschedule
  overdueHeaderRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  rescheduleAllPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#EBF4FF",
    borderRadius: 16,
  },
  rescheduleAllText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.primary,
  },

  // Completed Task Row
  completedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  completedTitle: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textTertiary,
    textDecorationLine: "line-through",
  },
  completedTime: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
  completedUndoBtn: {
    padding: 2,
    marginLeft: 2,
  },

  // Task card selected state
  taskCardSelected: {
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  agendaItemSelected: {
    backgroundColor: "#EBF4FF",
  },

  // Bulk Action Toolbar
  bulkActionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  bulkActionClose: {
    padding: 4,
    marginRight: 12,
  },
  bulkActionCount: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  bulkActionButtons: {
    flexDirection: "row",
    gap: 8,
  },
  bulkCompleteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.success,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  bulkDeleteButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.error,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  bulkButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  // FAB - Solid, clean
  fabWrapper: {
    position: "absolute",
    right: 20,
    bottom: 24,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    // Soft shadow
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },

  // Missed Slot Banner
  missedSlotBanner: {
    flexDirection: "column",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    marginTop: 4,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  missedSlotBannerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  missedSlotBannerText: {
    fontSize: 12,
    flex: 1,
  },
  missedSlotToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  missedSlotToggleLabel: {
    fontSize: 12,
    fontWeight: "500",
  },

  sectionInfoBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
  },
  sectionInfoText: {
    fontSize: 12,
    lineHeight: 18,
  },

  // Auto-Reschedule Undo Toast
  rescheduleToast: {
    position: "absolute",
    bottom: 16,
    left: 12,
    right: 12,
  },
  topToast: {
    bottom: undefined,
    top: 60,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  toastText: {
    flex: 1,
    fontSize: 13,
  },
  toastUndo: {
    fontSize: 13,
    fontWeight: "600",
  },

  // Auto-Reschedule Intro Modal
  introModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  introModalCard: {
    width: "100%",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  introModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  introModalBody: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  introModalDivider: {
    width: "100%",
    height: 1,
    marginVertical: 4,
  },
  introModalFeatureTitle: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  introModalFeatureBody: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  introModalPrimaryBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
  },
  introModalPrimaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  introModalSecondaryBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  introModalSecondaryBtnText: {
    fontSize: 14,
  },
  introModalFooter: {
    fontSize: 12,
    marginTop: 2,
  },

  // Guided tour styles
  tourCard: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  tourCardInner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  tourCardText: {
    flex: 1,
  },
  tourCardTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  tourCardSub: {
    fontSize: 13,
  },
  tourDismiss: {
    fontSize: 16,
    padding: 4,
  },
  tourCTA: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  tourCTAText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 14,
  },
  tourHintBanner: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  tourHintText: {
    fontSize: 13,
    fontWeight: "500",
  },
  calendarHint: {
    position: "absolute",
    bottom: 80,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  calendarHintText: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
  },
  calendarHintDismiss: {
    fontSize: 16,
    paddingLeft: 12,
  },
});
