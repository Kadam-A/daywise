/**
 * Admin Dashboard
 *
 * Overview of app statistics and quick links to admin features.
 * Only accessible to admin and super_admin users.
 */

import { useState, useCallback } from "react";
import { Alert, View, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { Text, ActivityIndicator, Surface } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";

import { useAuth } from "@/contexts/AuthContext";
import { getAdminStats, AdminStats, getRevenueStats, RevenueStats } from "@/lib/admin";
import { useAppColors } from "@/contexts/ThemeContext";
import { resetToNewUserState } from "@/lib/newUserState";

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

export default function AdminDashboard() {
  const appColors = useAppColors();
  const { role, user } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [revenueStats, setRevenueStats] = useState<RevenueStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadStats = async (showRefresh = false) => {
    try {
      if (showRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      const data = await getAdminStats();
      setStats(data);

      // Load revenue stats for super admins
      if (role === "super_admin") {
        const revenue = await getRevenueStats();
        setRevenueStats(revenue);
      }
    } catch (err) {
      console.error("[Admin] Error loading stats:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const formatCents = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatPercent = (numerator: number, denominator: number) => {
    if (denominator === 0) return "0%";
    return `${((numerator / denominator) * 100).toFixed(1)}%`;
  };

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [])
  );

  const handleRefresh = () => loadStats(true);

  const handleSimulateNewUser = () => {
    Alert.alert(
      "Simulate New User?",
      "Resets personality data and all first-time flags. Your tasks and account are preserved. You'll walk through onboarding exactly as a new user would.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset & Simulate",
          style: "destructive",
          onPress: async () => {
            try {
              await resetToNewUserState();
              router.replace("/(auth)/onboarding");
            } catch (err) {
              console.error("[Admin] Simulate new user failed:", err);
              Alert.alert("Error", "Failed to reset user state. Check console for details.");
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={appColors.textPrimary} />
        </Pressable>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: appColors.textPrimary }]}>Admin Dashboard</Text>
          <View style={[styles.roleBadge, { backgroundColor: `${appColors.secondary}15` }]}>
            <MaterialCommunityIcons
              name={role === "super_admin" ? "shield-crown" : "shield-account"}
              size={14}
              color={appColors.secondary}
            />
            <Text style={[styles.roleText, { color: appColors.secondary }]}>
              {role === "super_admin" ? "Super Admin" : "Admin"}
            </Text>
          </View>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={appColors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
          }
        >
          {/* Stats Grid */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>Overview</Text>
            <View style={styles.statsGrid}>
              <StatCard
                icon="account-group"
                label="Total Users"
                value={stats?.total_users || 0}
                color={COLORS.primary}
              />
              <StatCard
                icon="account-plus"
                label="This Week"
                value={stats?.users_this_week || 0}
                color={COLORS.success}
              />
              <StatCard
                icon="star"
                label="Pro Users"
                value={stats?.pro_users || 0}
                color={COLORS.secondary}
              />
              <StatCard
                icon="clock-outline"
                label="In Trial"
                value={stats?.trial_users || 0}
                color={COLORS.warning}
              />
            </View>
          </View>

          {/* Tasks Stats */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>Tasks</Text>
            <View style={styles.statsRow}>
              <StatCard
                icon="format-list-checks"
                label="Total"
                value={stats?.total_tasks || 0}
                color={COLORS.primary}
                size="small"
              />
              <StatCard
                icon="check-circle"
                label="Completed"
                value={stats?.completed_tasks || 0}
                color={COLORS.success}
                size="small"
              />
            </View>
          </View>

          {/* Revenue Stats - Super Admin Only */}
          {isSuperAdmin && revenueStats && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>Revenue</Text>
              <View style={styles.statsGrid}>
                <RevenueCard
                  label="MRR"
                  value={formatCents(revenueStats.mrr_cents)}
                  color={COLORS.success}
                  icon="cash"
                />
                <RevenueCard
                  label="Active Subs"
                  value={String(revenueStats.active_subscribers)}
                  color={COLORS.primary}
                  icon="account-check"
                />
                <RevenueCard
                  label="Monthly"
                  value={String(revenueStats.monthly_subscribers)}
                  color={COLORS.secondary}
                  icon="calendar-month"
                />
                <RevenueCard
                  label="Yearly"
                  value={String(revenueStats.yearly_subscribers)}
                  color={COLORS.warning}
                  icon="calendar-star"
                />
              </View>
              <View style={[styles.statsRow, { marginTop: 12 }]}>
                <RevenueCard
                  label="Conversion"
                  value={formatPercent(revenueStats.paid_users, revenueStats.total_users)}
                  color={COLORS.success}
                  icon="percent"
                  size="small"
                />
                <RevenueCard
                  label="Avg LTV"
                  value={formatCents(revenueStats.avg_ltv_cents)}
                  color={COLORS.primary}
                  icon="chart-line"
                  size="small"
                />
              </View>
              <View style={[styles.statsRow, { marginTop: 12 }]}>
                <RevenueCard
                  label="Active Trials"
                  value={String(revenueStats.active_trials)}
                  color={COLORS.warning}
                  icon="clock-outline"
                  size="small"
                />
                <RevenueCard
                  label="Churned"
                  value={String(revenueStats.churned_users)}
                  color={COLORS.error}
                  icon="account-remove"
                  size="small"
                />
              </View>
            </View>
          )}

          {/* Feedback Stats */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>Feedback</Text>
            <View style={styles.statsRow}>
              <StatCard
                icon="message-text"
                label="Total"
                value={stats?.total_feedback || 0}
                color={COLORS.primary}
                size="small"
              />
              <StatCard
                icon="message-alert"
                label="Pending"
                value={stats?.pending_feedback || 0}
                color={stats?.pending_feedback && stats.pending_feedback > 0 ? COLORS.error : COLORS.success}
                size="small"
              />
            </View>
          </View>

          {/* Quick Actions */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>Quick Actions</Text>
            <Surface style={[styles.actionsCard, { backgroundColor: appColors.surface }]} elevation={1}>
              <ActionButton
                icon="message-text-outline"
                label="View Feedback"
                description="Review and manage user feedback"
                onPress={() => router.push("/admin/feedback")}
              />
            </Surface>
            {isSuperAdmin && (
              <Pressable
                onPress={handleSimulateNewUser}
                style={[styles.simulateButton, { backgroundColor: `${appColors.warning}18` }]}
              >
                <MaterialCommunityIcons name="account-reactivate" size={20} color={appColors.warning} />
                <Text style={[styles.simulateButtonText, { color: appColors.warning }]}>
                  Simulate New User
                </Text>
              </Pressable>
            )}
          </View>

          {/* Admin Info */}
          <View style={[styles.infoCard, { backgroundColor: appColors.surface }]}>
            <MaterialCommunityIcons name="information-outline" size={18} color={appColors.textTertiary} />
            <Text style={[styles.infoText, { color: appColors.textTertiary }]}>
              Logged in as {user?.email || "Admin"}
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// Stat Card Component
function StatCard({
  icon,
  label,
  value,
  color,
  size = "normal",
}: {
  icon: string;
  label: string;
  value: number;
  color: string;
  size?: "normal" | "small";
}) {
  const appColors = useAppColors();
  const isSmall = size === "small";

  return (
    <Surface style={[styles.statCard, { backgroundColor: appColors.surface }, isSmall && styles.statCardSmall]} elevation={1}>
      <View style={[styles.statIcon, { backgroundColor: `${color}15` }]}>
        <MaterialCommunityIcons name={icon as any} size={isSmall ? 20 : 24} color={color} />
      </View>
      <Text style={[styles.statValue, { color: appColors.textPrimary }, isSmall && styles.statValueSmall]}>{value}</Text>
      <Text style={[styles.statLabel, { color: appColors.textSecondary }]}>{label}</Text>
    </Surface>
  );
}

// Action Button Component
function ActionButton({
  icon,
  label,
  description,
  onPress,
}: {
  icon: string;
  label: string;
  description: string;
  onPress: () => void;
}) {
  const appColors = useAppColors();
  return (
    <Pressable style={styles.actionButton} onPress={onPress}>
      <View style={[styles.actionIcon, { backgroundColor: `${appColors.primary}10` }]}>
        <MaterialCommunityIcons name={icon as any} size={24} color={appColors.primary} />
      </View>
      <View style={styles.actionContent}>
        <Text style={[styles.actionLabel, { color: appColors.textPrimary }]}>{label}</Text>
        <Text style={[styles.actionDescription, { color: appColors.textSecondary }]}>{description}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={24} color={appColors.textTertiary} />
    </Pressable>
  );
}

// Revenue Card Component (for super_admin)
function RevenueCard({
  icon,
  label,
  value,
  color,
  size = "normal",
}: {
  icon: string;
  label: string;
  value: string;
  color: string;
  size?: "normal" | "small";
}) {
  const appColors = useAppColors();
  const isSmall = size === "small";

  return (
    <Surface style={[styles.statCard, { backgroundColor: appColors.surface }, isSmall && styles.statCardSmall]} elevation={1}>
      <View style={[styles.statIcon, { backgroundColor: `${color}15` }]}>
        <MaterialCommunityIcons name={icon as any} size={isSmall ? 20 : 24} color={color} />
      </View>
      <Text style={[styles.statValue, { color: appColors.textPrimary }, isSmall && styles.statValueSmall]}>{value}</Text>
      <Text style={[styles.statLabel, { color: appColors.textSecondary }]}>{label}</Text>
    </Surface>
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
  headerContent: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: `${COLORS.secondary}15`,
    borderRadius: 10,
  },
  roleText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.secondary,
  },
  headerSpacer: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  statCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  statCardSmall: {
    padding: 12,
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  statValueSmall: {
    fontSize: 24,
  },
  statLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  actionsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: "hidden",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 14,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: `${COLORS.primary}10`,
    alignItems: "center",
    justifyContent: "center",
  },
  actionContent: {
    flex: 1,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  actionDescription: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  simulateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  simulateButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
  },
  infoText: {
    fontSize: 13,
    color: COLORS.textTertiary,
  },
});
