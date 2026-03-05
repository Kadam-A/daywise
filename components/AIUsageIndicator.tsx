/**
 * AIUsageIndicator - Shows weekly AI task usage for free users
 *
 * Displays progress bar and usage count (e.g., "2/3 AI tasks this week")
 * Pro users see an "Unlimited" badge instead.
 */

import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text, ProgressBar } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { format, differenceInDays } from "date-fns";
import { useAppColors } from "@/contexts/ThemeContext";

interface AIUsageIndicatorProps {
  used: number;
  limit: number;
  isUnlimited: boolean;
  resetsOn: Date | null;
  onUpgradePress?: () => void;
}

export default function AIUsageIndicator({
  used,
  limit,
  isUnlimited,
  resetsOn,
  onUpgradePress,
}: AIUsageIndicatorProps) {
  const appColors = useAppColors();

  if (isUnlimited) {
    return (
      <View style={styles.proContainer}>
        <LinearGradient
          colors={[appColors.primary, appColors.secondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.proBadge}
        >
          <MaterialCommunityIcons name="star" size={14} color="#FFFFFF" />
          <Text style={styles.proText}>Unlimited AI Scheduling</Text>
        </LinearGradient>
      </View>
    );
  }

  const remaining = Math.max(0, limit - used);
  const progress = limit > 0 ? used / limit : 0;
  const isAtLimit = used >= limit;

  const getResetText = () => {
    if (!resetsOn) return "";
    const daysUntil = differenceInDays(resetsOn, new Date());
    if (daysUntil <= 0) return "Resets today";
    if (daysUntil === 1) return "Resets tomorrow";
    return `Resets ${format(resetsOn, "EEEE")}`;
  };

  return (
    <View style={[styles.container, { backgroundColor: appColors.surface, borderColor: appColors.border }]}>
      <View style={styles.header}>
        <View style={styles.labelRow}>
          <MaterialCommunityIcons
            name="robot-outline"
            size={16}
            color={isAtLimit ? appColors.warning : appColors.primary}
          />
          <Text style={[styles.label, { color: appColors.textPrimary }]}>AI Scheduling</Text>
        </View>
        <Text style={[styles.count, { color: isAtLimit ? appColors.warning : appColors.primary }]}>
          {used}/{limit} this week
        </Text>
      </View>

      <View style={styles.progressRow}>
        <ProgressBar
          progress={progress}
          color={isAtLimit ? appColors.warning : appColors.primary}
          style={[styles.progressBar, { backgroundColor: appColors.inputBg }]}
        />
      </View>

      <View style={styles.footer}>
        <Text style={[styles.resetText, { color: appColors.textTertiary }]}>{getResetText()}</Text>
        {isAtLimit && onUpgradePress && (
          <Pressable style={styles.upgradeButton} onPress={onUpgradePress}>
            <Text style={[styles.upgradeText, { color: appColors.primary }]}>Upgrade</Text>
            <MaterialCommunityIcons name="arrow-right" size={14} color={appColors.primary} />
          </Pressable>
        )}
        {!isAtLimit && (
          <Text style={[styles.remainingText, { color: appColors.textSecondary }]}>
            {remaining} {remaining === 1 ? "task" : "tasks"} remaining
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Compact version for inline display
 */
export function AIUsageIndicatorCompact({
  used,
  limit,
  isUnlimited,
}: Pick<AIUsageIndicatorProps, "used" | "limit" | "isUnlimited">) {
  const appColors = useAppColors();

  if (isUnlimited) {
    return (
      <View style={[styles.compactPro, { backgroundColor: appColors.primaryLight }]}>
        <MaterialCommunityIcons name="star" size={12} color={appColors.primary} />
        <Text style={[styles.compactProText, { color: appColors.primary }]}>Pro</Text>
      </View>
    );
  }

  const isAtLimit = used >= limit;

  return (
    <View style={[styles.compactContainer, { backgroundColor: appColors.inputBg }, isAtLimit && { backgroundColor: appColors.warningLight }]}>
      <MaterialCommunityIcons
        name="robot-outline"
        size={12}
        color={isAtLimit ? appColors.warning : appColors.textSecondary}
      />
      <Text style={[styles.compactText, { color: appColors.textSecondary }, isAtLimit && { color: appColors.warning }]}>
        {used}/{limit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
  },
  count: {
    fontSize: 14,
    fontWeight: "600",
  },
  progressRow: {
    marginBottom: 10,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resetText: {
    fontSize: 12,
  },
  remainingText: {
    fontSize: 12,
  },
  upgradeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  upgradeText: {
    fontSize: 13,
    fontWeight: "600",
  },

  // Pro container
  proContainer: {
    alignSelf: "flex-start",
  },
  proBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  proText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  // Compact version
  compactContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  compactText: {
    fontSize: 12,
    fontWeight: "500",
  },
  compactPro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  compactProText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
