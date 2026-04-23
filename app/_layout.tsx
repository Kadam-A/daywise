/**
 * TailoredTime - Root Layout
 *
 * Sets up React Native Paper theme, network context, auth, and navigation structure
 */

import { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { Stack, router, usePathname, useGlobalSearchParams } from "expo-router";
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
import { Sentry, initSentry } from "@/lib/sentry";
import { initPostHog, posthog } from "@/lib/posthog";
import { PostHogProvider } from "posthog-react-native";
import * as Linking from "expo-linking";
import { setPendingUrl } from "@/lib/pending-url";

// Initialise crash reporting & analytics before anything else renders
initSentry();
initPostHog();

function AppContent() {
  const { isDark } = useThemeMode();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const previousPathname = useRef<string | undefined>(undefined);

  // Manual screen tracking for Expo Router
  // @see https://posthog.com/docs/libraries/react-native#screen-tracking
  useEffect(() => {
    if (previousPathname.current !== pathname) {
      posthog.screen(pathname, {
        previous_screen: previousPathname.current ?? null,
        ...params,
      });
      previousPathname.current = pathname;
    }
  }, [pathname, params]);

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
        <Stack screenOptions={{ headerShown: false, gestureEnabled: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="auth/callback" />
          <Stack.Screen name="admin" />
          <Stack.Screen name="paywall" options={{ presentation: "modal" }} />
        </Stack>
      </View>
    </PaperProvider>
  );
}

function RootLayout() {
  // Capture deep-link URLs at the root level so auth/callback can consume them
  // even on Android warm-starts where the url event fires before the screen mounts.
  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => setPendingUrl(url));
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
      <ThemeProvider>
        <NetworkProvider>
          <PostHogProvider
            client={posthog}
            autocapture={{
              captureScreens: false, // Manual screen tracking via useEffect above
              captureTouches: true,
              propsToCapture: ['testID'],
              maxElementsCaptured: 20,
            }}
          >
            <AuthProvider>
              <SubscriptionProvider>
                <GuidedTourProvider>
                  <AppContent />
                </GuidedTourProvider>
              </SubscriptionProvider>
            </AuthProvider>
          </PostHogProvider>
        </NetworkProvider>
      </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap captures unhandled JS exceptions and ANRs at the root level
export default Sentry.wrap(RootLayout);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  containerDark: {
    backgroundColor: '#1A1D23',
  },
});
