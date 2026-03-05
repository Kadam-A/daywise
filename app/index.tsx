/**
 * TailoredTime - Entry Point
 *
 * Redirects to login, onboarding, or home based on auth status
 */

import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { supabase, getCurrentSession } from "@/lib/supabase";
import { useAppColors } from "@/contexts/ThemeContext";

type AuthState = "loading" | "unauthenticated" | "needs_onboarding" | "authenticated";

export default function Index() {
  const appColors = useAppColors();
  const [authState, setAuthState] = useState<AuthState>("loading");

  useEffect(() => {
    checkAuthStatus();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_OUT" || !session) {
          setAuthState("unauthenticated");
        } else if (event === "SIGNED_IN") {
          await checkOnboardingStatus();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const session = await getCurrentSession();

      if (!session) {
        setAuthState("unauthenticated");
        return;
      }

      await checkOnboardingStatus();
    } catch (error) {
      console.error("[Auth Check Error]", error);
      setAuthState("unauthenticated");
    }
  };

  const checkOnboardingStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAuthState("unauthenticated"); return; }

      const { data: profile, error } = await supabase
        .from("user_profiles")
        .select("personality_data")
        .eq("id", user.id)
        .single();

      if (error || !profile) {
        setAuthState("needs_onboarding");
        return;
      }

      // Check if user has default personality values (hasn't completed onboarding)
      const pd = profile.personality_data;
      const isDefault =
        pd?.chronotype === 50 &&
        pd?.focus_duration === 50 &&
        pd?.deadline_style === 50 &&
        pd?.break_frequency === 50 &&
        pd?.task_switching === 50 &&
        pd?.structure_preference === 50;

      setAuthState(isDefault ? "needs_onboarding" : "authenticated");
    } catch (error) {
      console.error("[Profile Check Error]", error);
      setAuthState("needs_onboarding");
    }
  };

  if (authState === "loading") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: appColors.background }}>
        <ActivityIndicator size="large" color={appColors.primary} />
      </View>
    );
  }

  if (authState === "unauthenticated") {
    return <Redirect href="/(auth)/login" />;
  }

  if (authState === "needs_onboarding") {
    return <Redirect href="/(auth)/onboarding" />;
  }

  return <Redirect href="/(tabs)/home" />;
}
