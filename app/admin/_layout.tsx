/**
 * Admin Layout
 *
 * Stack navigation for admin screens with auth guard.
 * Redirects non-admin users back to home.
 */

import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { Stack, router } from "expo-router";
import { ActivityIndicator, Text } from "react-native-paper";
import { useAuth } from "@/contexts/AuthContext";

const COLORS = {
  background: "#F8F9FB",
  primary: "#4A90E2",
};

export default function AdminLayout() {
  const { isAdmin, isLoading, isAuthenticated } = useAuth();

  // Redirect non-admins
  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        router.replace("/(auth)/login");
      } else if (!isAdmin) {
        router.replace("/(tabs)/home");
      }
    }
  }, [isLoading, isAuthenticated, isAdmin]);

  // Show loading while checking auth
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Checking access...</Text>
      </View>
    );
  }

  // Only render for admins
  if (!isAdmin) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="feedback" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 12,
    color: "#5C6370",
    fontSize: 14,
  },
});
