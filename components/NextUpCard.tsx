/**
 * NextUpCard - Shows the next upcoming task prominently
 *
 * Displays urgency-based styling:
 * - normal (blue): task > 1hr away
 * - soon (orange): task < 1hr away
 * - now (green): task is happening now
 * - overdue (red): task start time passed
 */

import React, { useMemo } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text, Button, ProgressBar, Surface } from "react-native-paper";
import { Task } from "@/lib/types";
import { format, differenceInMinutes, isPast, isWithinInterval } from "date-fns";

interface NextUpCardProps {
  task: Task;
  onMarkDone: () => void;
  onReschedule: () => void;
  onPress: () => void;
}

type UrgencyState = "normal" | "soon" | "now" | "overdue";

const URGENCY_COLORS = {
  normal: {
    background: "#eff6ff",
    border: "#3b82f6",
    text: "#1e40af",
    accent: "#2563eb",
  },
  soon: {
    background: "#fff7ed",
    border: "#f97316",
    text: "#9a3412",
    accent: "#ea580c",
  },
  now: {
    background: "#f0fdf4",
    border: "#22c55e",
    text: "#166534",
    accent: "#16a34a",
  },
  overdue: {
    background: "#fef2f2",
    border: "#ef4444",
    text: "#991b1b",
    accent: "#dc2626",
  },
};

export default function NextUpCard({
  task,
  onMarkDone,
  onReschedule,
  onPress,
}: NextUpCardProps) {
  const { urgency, timeUntil, colors } = useMemo(() => {
    if (!task.scheduled_start || !task.scheduled_end) {
      return {
        urgency: "normal" as UrgencyState,
        timeUntil: "Not scheduled",
        colors: URGENCY_COLORS.normal,
      };
    }

    const now = new Date();
    const start = new Date(task.scheduled_start);
    const end = new Date(task.scheduled_end);
    const minutesUntil = differenceInMinutes(start, now);

    let urgency: UrgencyState;
    let timeUntil: string;

    if (isPast(end)) {
      // Task end time has passed
      urgency = "overdue";
      timeUntil = "Overdue";
    } else if (isWithinInterval(now, { start, end })) {
      // Currently happening
      urgency = "now";
      const minutesLeft = differenceInMinutes(end, now);
      timeUntil = `${minutesLeft} min left`;
    } else if (minutesUntil <= 60) {
      // Less than 1 hour away
      urgency = "soon";
      if (minutesUntil <= 0) {
        timeUntil = "Starting now";
      } else if (minutesUntil < 60) {
        timeUntil = `in ${minutesUntil} min`;
      } else {
        timeUntil = "in 1 hr";
      }
    } else {
      // More than 1 hour away
      urgency = "normal";
      if (minutesUntil < 120) {
        timeUntil = `in ${Math.round(minutesUntil / 60)} hr`;
      } else {
        const hours = Math.floor(minutesUntil / 60);
        timeUntil = `in ${hours} hrs`;
      }
    }

    return {
      urgency,
      timeUntil,
      colors: URGENCY_COLORS[urgency],
    };
  }, [task.scheduled_start, task.scheduled_end]);

  const formatTimeRange = () => {
    if (!task.scheduled_start || !task.scheduled_end) return "";
    const start = new Date(task.scheduled_start);
    const end = new Date(task.scheduled_end);
    return `${format(start, "h:mm a")} - ${format(end, "h:mm a")}`;
  };

  const getUrgencyIcon = () => {
    switch (urgency) {
      case "now":
        return "play-circle";
      case "soon":
        return "clock-alert";
      case "overdue":
        return "alert-circle";
      default:
        return "bell";
    }
  };

  const getUrgencyLabel = () => {
    switch (urgency) {
      case "now":
        return "Happening Now";
      case "soon":
        return "Coming Up Soon";
      case "overdue":
        return "Overdue";
      default:
        return "Next Up";
    }
  };

  return (
    <Pressable onPress={onPress}>
      <Surface
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]}
        elevation={1}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={[styles.label, { color: colors.accent }]}>
              {getUrgencyLabel()}
            </Text>
          </View>
          <Text style={[styles.timeUntil, { color: colors.text }]}>
            {timeUntil}
          </Text>
        </View>

        {/* Task Info */}
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {task.title}
        </Text>

        <View style={styles.timeRow}>
          <Text style={[styles.timeRange, { color: colors.accent }]}>
            {formatTimeRange()}
          </Text>
          <Text style={[styles.duration, { color: colors.text }]}>
            {task.duration_minutes} min
          </Text>
        </View>

        {/* Score bar (if SMART scheduled) */}
        {task.scheduling_method === "SMART" && (
          <View style={styles.scoreSection}>
            <View style={styles.progressBarContainer}>
              <ProgressBar
                progress={0.85}
                color={colors.accent}
                style={styles.progressBar}
              />
            </View>
            <Text style={[styles.scoreText, { color: colors.text }]}>
              85%
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            mode="contained"
            onPress={onMarkDone}
            style={[styles.actionButton, { backgroundColor: colors.accent }]}
            labelStyle={styles.actionButtonLabel}
            compact
          >
            Mark Done
          </Button>
          <Button
            mode="outlined"
            onPress={onReschedule}
            style={[styles.actionButton, { borderColor: colors.accent }]}
            labelStyle={[styles.actionButtonLabel, { color: colors.accent }]}
            compact
          >
            Reschedule
          </Button>
        </View>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  timeUntil: {
    fontSize: 14,
    fontWeight: "600",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 8,
    lineHeight: 26,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  timeRange: {
    fontSize: 15,
    fontWeight: "500",
  },
  duration: {
    fontSize: 14,
    opacity: 0.8,
  },
  scoreSection: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  progressBarContainer: {
    flex: 1,
    marginRight: 10,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
  },
  scoreText: {
    fontSize: 13,
    fontWeight: "500",
    minWidth: 35,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
  actionButtonLabel: {
    fontSize: 14,
  },
});
