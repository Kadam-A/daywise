/**
 * TailoredTime - Root Layout
 *
 * Sets up React Native Paper theme and navigation structure
 */

import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { PaperProvider } from "react-native-paper";
import { lightTheme } from "@/constants/theme";
import { setupNotificationResponseHandler } from "@/lib/notifications";

export default function RootLayout() {
  // Handle notification taps - navigate to task detail
  useEffect(() => {
    const cleanup = setupNotificationResponseHandler((taskId) => {
      router.push(`/task/${taskId}`);
    });

    return cleanup;
  }, []);

  return (
    <PaperProvider theme={lightTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </PaperProvider>
  );
}
