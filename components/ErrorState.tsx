/**
 * ErrorState - Reusable error display component
 *
 * Shows user-friendly error messages with retry option
 */

import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAppColors } from "@/contexts/ThemeContext";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  variant?: "default" | "inline" | "card";
}

export default function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  icon = "alert-circle-outline",
  variant = "default",
}: ErrorStateProps) {
  const appColors = useAppColors();

  if (variant === "inline") {
    return (
      <View style={[styles.inlineContainer, { backgroundColor: appColors.errorLight, borderColor: appColors.error + "40" }]}>
        <MaterialCommunityIcons name={icon} size={18} color={appColors.error} />
        <Text style={[styles.inlineText, { color: appColors.error }]}>{message}</Text>
        {onRetry && (
          <Pressable onPress={onRetry} hitSlop={10}>
            <MaterialCommunityIcons name="refresh" size={18} color={appColors.error} />
          </Pressable>
        )}
      </View>
    );
  }

  if (variant === "card") {
    return (
      <View style={[styles.cardContainer, { backgroundColor: appColors.surface, borderColor: appColors.error + "40" }]}>
        <View style={[styles.cardIconWrapper, { backgroundColor: appColors.errorLight }]}>
          <MaterialCommunityIcons name={icon} size={24} color={appColors.error} />
        </View>
        <View style={styles.cardContent}>
          <Text style={[styles.cardTitle, { color: appColors.textPrimary }]}>{title}</Text>
          <Text style={[styles.cardMessage, { color: appColors.textSecondary }]}>{message}</Text>
        </View>
        {onRetry && (
          <Pressable style={[styles.cardRetryButton, { backgroundColor: appColors.errorLight }]} onPress={onRetry}>
            <MaterialCommunityIcons name="refresh" size={20} color={appColors.error} />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrapper, { backgroundColor: appColors.errorLight }]}>
        <MaterialCommunityIcons name={icon} size={56} color={appColors.error} />
      </View>
      <Text style={[styles.title, { color: appColors.textPrimary }]}>{title}</Text>
      <Text style={[styles.message, { color: appColors.textSecondary }]}>{message}</Text>
      {onRetry && (
        <Pressable style={[styles.retryButton, { backgroundColor: appColors.error }]} onPress={onRetry}>
          <MaterialCommunityIcons name="refresh" size={18} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>Try Again</Text>
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
  },
  iconWrapper: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  message: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  // Inline variant
  inlineContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  inlineText: {
    flex: 1,
    fontSize: 14,
  },

  // Card variant
  cardContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 2,
  },
  cardMessage: {
    fontSize: 13,
  },
  cardRetryButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
});
