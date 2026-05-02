import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import { getGoogleTokens } from "@/lib/google-calendar";

// Catches daywise://oauth2redirect deep link from Google OAuth.
// Polls SecureStore until tokens are written (exchange completes), then navigates
// back to settings — ensuring the connected state is visible immediately.
export default function OAuthRedirect() {
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 25; // ~5 seconds max

    const interval = setInterval(async () => {
      attempts++;
      const tokens = await getGoogleTokens();
      if (tokens || attempts >= maxAttempts) {
        clearInterval(interval);
        router.replace("/(tabs)/settings");
      }
    }, 200);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
