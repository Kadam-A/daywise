/**
 * TailoredTime - Root Layout
 *
 * Sets up React Native Paper theme and navigation structure
 */

import { Stack } from "expo-router";
import { PaperProvider } from "react-native-paper";
import { lightTheme } from "@/constants/theme";

export default function RootLayout() {
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
