/**
 * TailoredTime - Root Layout
 *
 * Sets up React Native Paper theme, network context, auth, and navigation structure
 */

import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Stack, router } from "expo-router";
import { PaperProvider } from "react-native-paper";
import { lightTheme, darkTheme } from "@/constants/theme";
import { setupNotificationResponseHandler } from "@/lib/notifications";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider, useThemeMode } from "@/contexts/ThemeContext";
import { GuidedTourProvider } from "@/contexts/GuidedTourContext";
import OfflineBanner from "@/components/OfflineBanner";
import { initializePurchases } from "@/lib/purchases";
import { markUserActive } from "@/lib/analytics";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

function AppContent() {
  const { isDark } = useThemeMode();

  // Handle notification taps - navigate to task detail
  useEffect(() => {
    const cleanup = setupNotificationResponseHandler((taskId) => {
      router.push(`/task/${taskId}`);
    });

    return cleanup;
  }, []);

  // Initialize RevenueCat and mark user active for retention tracking
  useEffect(() => {
    initializePurchases();
    markUserActive();
  }, []);

  return (
    <PaperProvider theme={isDark ? darkTheme : lightTheme}>
      <StatusBar style={isDark ? "light" : "dark"} translucent />
      <View style={[styles.container, isDark && styles.containerDark]}>
        <OfflineBanner />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="admin" />
          <Stack.Screen name="paywall" options={{ presentation: "modal" }} />
        </Stack>
      </View>
    </PaperProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
      <ThemeProvider>
        <NetworkProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <GuidedTourProvider>
                <AppContent />
              </GuidedTourProvider>
            </SubscriptionProvider>
          </AuthProvider>
        </NetworkProvider>
      </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  containerDark: {
    backgroundColor: '#1A1D23',
  },
});
