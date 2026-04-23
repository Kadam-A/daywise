import { supabase } from "@/lib/supabase";

/**
 * Determines where to send a user after authentication.
 * Returns onboarding if their personality profile is still at defaults,
 * otherwise returns home.
 */
export async function getPostAuthRoute(): Promise<
  "/(auth)/onboarding" | "/(tabs)/home"
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return "/(auth)/onboarding";

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("personality_data")
    .eq("id", user.id)
    .single();

  const needsOnboarding =
    !profile ||
    (profile.personality_data?.chronotype === 50 &&
      profile.personality_data?.focus_duration === 50);

  return needsOnboarding ? "/(auth)/onboarding" : "/(tabs)/home";
}
