/**
 * Admin Feedback Screen
 *
 * View and manage all user feedback.
 * Filter by category, status, and mark as reviewed/resolved.
 */

import { useState, useCallback } from "react";
import { View, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { Text, ActivityIndicator, Surface, Chip, Menu, Divider } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { format } from "date-fns";

import { getAllFeedback, updateFeedbackStatus, FeedbackItem, FeedbackFilters } from "@/lib/admin";
import { FEEDBACK_CATEGORY_LABELS, FEEDBACK_CATEGORY_ICONS } from "@/lib/feedback";
import { FeedbackCategory } from "@/lib/types";
import { useAppColors } from "@/contexts/ThemeContext";

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

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  new: { color: COLORS.primary, label: "New" },
  reviewed: { color: COLORS.warning, label: "Reviewed" },
  resolved: { color: COLORS.success, label: "Resolved" },
  archived: { color: COLORS.textTertiary, label: "Archived" },
};

export default function AdminFeedbackScreen() {
  const appColors = useAppColors();
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filters, setFilters] = useState<FeedbackFilters>({});
  const [statusMenuVisible, setStatusMenuVisible] = useState<string | null>(null);

  // Filter menu state
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "new" | "reviewed">("all");

  const loadFeedback = async (showRefresh = false) => {
    try {
      if (showRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      const appliedFilters: FeedbackFilters = {};
      if (activeFilter !== "all") {
        appliedFilters.status = activeFilter;
      }

      const data = await getAllFeedback(appliedFilters);
      setFeedback(data);
    } catch (err) {
      console.error("[Admin] Error loading feedback:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadFeedback();
    }, [activeFilter])
  );

  const handleStatusChange = async (
    feedbackId: string,
    newStatus: "new" | "reviewed" | "resolved" | "archived"
  ) => {
    setStatusMenuVisible(null);

    const result = await updateFeedbackStatus(feedbackId, newStatus);
    if (result.success) {
      // Update local state
      setFeedback((prev) =>
        prev.map((f) => (f.id === feedbackId ? { ...f, status: newStatus } : f))
      );
    }
  };

  const handleRefresh = () => loadFeedback(true);

  const renderFeedbackItem = ({ item }: { item: FeedbackItem }) => {
    const statusConfig = STATUS_CONFIG[item.status] || STATUS_CONFIG.new;
    const categoryIcon = FEEDBACK_CATEGORY_ICONS[item.category as FeedbackCategory] || "comment-question-outline";
    const categoryLabel = FEEDBACK_CATEGORY_LABELS[item.category as FeedbackCategory] || item.category;

    return (
      <Surface style={[styles.feedbackCard, { backgroundColor: appColors.surface }]} elevation={1}>
        {/* Header */}
        <View style={styles.feedbackHeader}>
          <View style={styles.categoryContainer}>
            <View style={[styles.categoryIcon, { backgroundColor: `${appColors.secondary}15` }]}>
              <MaterialCommunityIcons
                name={categoryIcon as any}
                size={18}
                color={appColors.secondary}
              />
            </View>
            <Text style={[styles.categoryText, { color: appColors.textPrimary }]}>{categoryLabel}</Text>
          </View>
          <Menu
            visible={statusMenuVisible === item.id}
            onDismiss={() => setStatusMenuVisible(null)}
            anchor={
              <Pressable
                onPress={() => setStatusMenuVisible(item.id)}
                style={[styles.statusBadge, { backgroundColor: `${statusConfig.color}15` }]}
              >
                <View style={[styles.statusDot, { backgroundColor: statusConfig.color }]} />
                <Text style={[styles.statusText, { color: statusConfig.color }]}>
                  {statusConfig.label}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-down"
                  size={14}
                  color={statusConfig.color}
                />
              </Pressable>
            }
          >
            <Menu.Item
              onPress={() => handleStatusChange(item.id, "new")}
              title="New"
              leadingIcon="circle-outline"
            />
            <Menu.Item
              onPress={() => handleStatusChange(item.id, "reviewed")}
              title="Reviewed"
              leadingIcon="eye-outline"
            />
            <Menu.Item
              onPress={() => handleStatusChange(item.id, "resolved")}
              title="Resolved"
              leadingIcon="check-circle-outline"
            />
            <Divider />
            <Menu.Item
              onPress={() => handleStatusChange(item.id, "archived")}
              title="Archive"
              leadingIcon="archive-outline"
            />
          </Menu>
        </View>

        {/* Content */}
        {item.text_feedback && (
          <Text style={[styles.feedbackText, { color: appColors.textSecondary }]} numberOfLines={3}>
            {item.text_feedback}
          </Text>
        )}

        {/* Meta */}
        <View style={styles.feedbackMeta}>
          <View style={styles.metaItem}>
            <MaterialCommunityIcons name="clock-outline" size={14} color={appColors.textTertiary} />
            <Text style={[styles.metaText, { color: appColors.textTertiary }]}>
              {format(new Date(item.created_at), "MMM d, h:mm a")}
            </Text>
          </View>
          <View style={styles.metaItem}>
            <MaterialCommunityIcons name="tag-outline" size={14} color={appColors.textTertiary} />
            <Text style={[styles.metaText, { color: appColors.textTertiary }]}>{item.trigger_point}</Text>
          </View>
          {item.user_email && (
            <View style={styles.metaItem}>
              <MaterialCommunityIcons name="email-outline" size={14} color={appColors.textTertiary} />
              <Text style={[styles.metaText, { color: appColors.textTertiary }]} numberOfLines={1}>
                {item.user_email}
              </Text>
            </View>
          )}
        </View>
      </Surface>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={appColors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: appColors.textPrimary }]}>Feedback</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Filter Chips */}
      <View style={[styles.filterContainer, { backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
        <Chip
          mode={activeFilter === "all" ? "flat" : "outlined"}
          selected={activeFilter === "all"}
          onPress={() => setActiveFilter("all")}
          style={[styles.filterChip, { backgroundColor: activeFilter === "all" ? appColors.primaryLight : appColors.surface }]}
        >
          All
        </Chip>
        <Chip
          mode={activeFilter === "new" ? "flat" : "outlined"}
          selected={activeFilter === "new"}
          onPress={() => setActiveFilter("new")}
          style={[styles.filterChip, { backgroundColor: activeFilter === "new" ? appColors.primaryLight : appColors.surface }]}
        >
          New
        </Chip>
        <Chip
          mode={activeFilter === "reviewed" ? "flat" : "outlined"}
          selected={activeFilter === "reviewed"}
          onPress={() => setActiveFilter("reviewed")}
          style={[styles.filterChip, { backgroundColor: activeFilter === "reviewed" ? appColors.primaryLight : appColors.surface }]}
        >
          Reviewed
        </Chip>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={appColors.primary} />
        </View>
      ) : feedback.length === 0 ? (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="message-text-outline" size={64} color={appColors.textTertiary} />
          <Text style={[styles.emptyTitle, { color: appColors.textPrimary }]}>No feedback yet</Text>
          <Text style={[styles.emptyDescription, { color: appColors.textSecondary }]}>
            Feedback from users will appear here
          </Text>
        </View>
      ) : (
        <FlatList
          data={feedback}
          keyExtractor={(item) => item.id}
          renderItem={renderFeedbackItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  filterContainer: {
    flexDirection: "row",
    padding: 16,
    gap: 8,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  filterChip: {
    backgroundColor: COLORS.surface,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginTop: 16,
  },
  emptyDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 8,
    textAlign: "center",
  },
  listContent: {
    padding: 16,
  },
  separator: {
    height: 12,
  },
  feedbackCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
  },
  feedbackHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  categoryContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  feedbackText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 12,
  },
  feedbackMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: COLORS.textTertiary,
  },
});
