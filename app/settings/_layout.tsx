/**
 * Settings Layout
 * Handles routing for settings sub-screens
 */

import { Stack } from "expo-router";

export default function SettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="personality" />
      <Stack.Screen name="account" />
      <Stack.Screen name="stats" />
    </Stack>
  );
}
