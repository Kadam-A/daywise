/**
 * EmptyState - Reusable empty state component
 *
 * Shows friendly messages when lists are empty with optional action button.
 */

import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAppColors } from "@/contexts/ThemeContext";

interface EmptyStateProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: "default" | "compact" | "card";
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  variant = "default",
}: EmptyStateProps) {
  const appColors = useAppColors();

  if (variant === "compact") {
    return (
      <View style={styles.compactContainer}>
        <MaterialCommunityIcons name={icon} size={32} color={appColors.textTertiary} />
        <View style={styles.compactContent}>
          <Text style={[styles.compactTitle, { color: appColors.textPrimary }]}>{title}</Text>
          <Text style={[styles.compactDescription, { color: appColors.textTertiary }]}>{description}</Text>
        </View>
        {actionLabel && onAction && (
          <Pressable onPress={onAction} style={[styles.compactAction, { backgroundColor: appColors.primaryLight }]}>
            <Text style={[styles.compactActionText, { color: appColors.gradientStart }]}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (variant === "card") {
    return (
      <View style={[styles.cardContainer, { backgroundColor: appColors.surface }]}>
        <View style={[styles.cardIconContainer, { backgroundColor: appColors.primaryLight }]}>
          <MaterialCommunityIcons name={icon} size={28} color={appColors.gradientStart} />
        </View>
        <Text style={[styles.cardTitle, { color: appColors.textPrimary }]}>{title}</Text>
        <Text style={[styles.cardDescription, { color: appColors.textSecondary }]}>{description}</Text>
        {actionLabel && onAction && (
          <Pressable onPress={onAction} style={styles.cardAction}>
            <Text style={[styles.cardActionText, { color: appColors.gradientStart }]}>{actionLabel}</Text>
            <MaterialCommunityIcons name="arrow-right" size={16} color={appColors.gradientStart} />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.iconContainer, { backgroundColor: appColors.primaryLight }]}>
        <MaterialCommunityIcons name={icon} size={56} color={appColors.gradientStart} />
      </View>
      <Text style={[styles.title, { color: appColors.textPrimary }]}>{title}</Text>
      <Text style={[styles.description, { color: appColors.textSecondary }]}>{description}</Text>
      {actionLabel && onAction && (
        <Pressable style={styles.actionButton} onPress={onAction}>
          <LinearGradient
            colors={[appColors.gradientStart, appColors.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.actionButtonGradient}
          >
            <MaterialCommunityIcons name="plus" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>{actionLabel}</Text>
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Default variant
  container: {
    alignItems: "center",
    padding: 40,
    paddingVertical: 60,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 280,
    marginBottom: 28,
  },
  actionButton: {
    borderRadius: 16,
    overflow: "hidden",
  },
  actionButtonGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  // Compact variant
  compactContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    gap: 14,
  },
  compactContent: {
    flex: 1,
  },
  compactTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  compactDescription: {
    fontSize: 13,
  },
  compactAction: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  compactActionText: {
    fontSize: 13,
    fontWeight: "600",
  },

  // Card variant
  cardContainer: {
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginHorizontal: 20,
    marginVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 6,
    textAlign: "center",
  },
  cardDescription: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  cardAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cardActionText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
