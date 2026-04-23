/**
 * Auth Callback Route
 *
 * Handles deep link redirects after email verification and Google SSO.
 *
 * Architecture: single linear async flow.
 *   getCallbackUrl() → processCallbackUrl() → [mutex released] → getPostAuthRoute() → navigate
 *
 * Key design rule: navigate ONLY after setSession() / exchangeCodeForSession() / verifyOtp()
 * has fully returned. These calls hold Supabase's internal auth mutex. Any supabase.* call
 * made while the mutex is held (including supabase.from().select() on the home screen)
 * will deadlock. Awaiting them fully here ensures the mutex is released before the home
 * screen mounts and fetches data.
 */

import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAppColors } from "@/contexts/ThemeContext";
import { identifyUser } from "@/lib/posthog";
import { takePendingUrl } from "@/lib/pending-url";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Step 1: Obtain the deep link URL via whichever channel fired first.
 *
 * Three cases (in priority order):
 *   1. Warm-start Android: OS fires the Linking URL event before this screen mounts.
 *      _layout.tsx captures it in lib/pending-url.ts.
 *   2. Cold-start: OS holds the URL in getInitialURL().
 *   3. Slow warm-start edge case: URL event fires after this screen mounts.
 */
async function getCallbackUrl(
  params: ReturnType<typeof useLocalSearchParams>
): Promise<string | null> {
  // 1. Check pending URL captured by _layout.tsx before this screen mounted
  const pending = takePendingUrl();
  if (pending) {
    console.log("[AuthCallback] Using pending URL");
    return pending;
  }

  // 2. Cold start — system holds initial URL
  const initial = await Linking.getInitialURL();
  if (initial) {
    console.log("[AuthCallback] Using initial URL");
    return initial;
  }

  // 3. Slow warm-start — wait for Linking event
  // (outer fallback timer cancels the whole flow if this never fires)
  console.log("[AuthCallback] Waiting for Linking URL event...");
  return new Promise((resolve) => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      sub.remove();
      resolve(url);
    });
  });
}

/**
 * Step 2: Parse the URL and establish a Supabase session.
 *
 * Handles three auth flows:
 *   - Implicit: #access_token in hash (Google SSO via Supabase)
 *   - PKCE: ?code= in query params
 *   - OTP: token_hash + type in query params (email confirmation)
 *
 * Returns the authenticated user + access token, or null on failure.
 * The Supabase auth mutex is RELEASED when this function returns.
 */
async function processCallbackUrl(
  url: string,
  params: ReturnType<typeof useLocalSearchParams>
): Promise<{ user: User; accessToken: string } | null> {
  const parsed = Linking.parse(url);
  const hash = url.split("#")[1];

  // ── Implicit flow: #access_token in hash ─────────────────────────────────
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token") ?? "";
    if (accessToken) {
      console.log("[AuthCallback] Implicit flow — calling setSession()");
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      // ── Mutex released ──
      if (error) {
        console.error("[AuthCallback] setSession error:", error.message);
        return null;
      }
      if (data.user) return { user: data.user, accessToken };
    }
  }

  // ── PKCE flow: ?code= in query params ────────────────────────────────────
  const code = parsed.queryParams?.code as string | undefined;
  if (code) {
    console.log("[AuthCallback] PKCE flow — calling exchangeCodeForSession()");
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    // ── Mutex released ──
    if (error) {
      console.error("[AuthCallback] exchangeCodeForSession error:", error.message);
      return null;
    }
    if (data.user) return { user: data.user, accessToken: data.session.access_token };
  }

  // ── OTP email confirmation: token_hash + type ─────────────────────────────
  const tokenHash =
    (parsed.queryParams?.token_hash as string) ?? (params.token_hash as string);
  const type =
    (parsed.queryParams?.type as string) ?? (params.type as string);
  if (tokenHash && type) {
    console.log("[AuthCallback] OTP flow — calling verifyOtp()");
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "signup" | "email" | "recovery",
    });
    // ── Mutex released ──
    if (error) {
      console.error("[AuthCallback] verifyOtp error:", error.message);
      return null;
    }
    if (data.user) {
      return { user: data.user, accessToken: data.session?.access_token ?? "" };
    }
  }

  console.error("[AuthCallback] No recognisable auth params in URL");
  return null;
}

/**
 * Step 3: Check whether the user has completed onboarding.
 *
 * Uses a direct REST fetch with the access token — bypasses the Supabase JS client
 * entirely so there is zero chance of re-acquiring the mutex on a slow device.
 */
async function getPostAuthRoute(
  userId: string,
  accessToken: string
): Promise<"/(auth)/onboarding" | "/(tabs)/home"> {
  console.log("[AuthCallback] Checking user profile...");
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}&select=personality_data&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    const [profile] = await res.json();
    if (!profile) return "/(auth)/onboarding";

    const pd = profile.personality_data;
    const isDefault =
      pd?.chronotype === 50 &&
      pd?.focus_duration === 50 &&
      pd?.deadline_style === 50 &&
      pd?.break_frequency === 50 &&
      pd?.task_switching === 50 &&
      pd?.structure_preference === 50;

    return isDefault ? "/(auth)/onboarding" : "/(tabs)/home";
  } catch (err) {
    console.error("[AuthCallback] getPostAuthRoute error:", err);
    return "/(auth)/onboarding";
  }
}

export default function AuthCallbackScreen() {
  const appColors = useAppColors();
  const params = useLocalSearchParams();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        console.log("[AuthCallback] Starting auth flow");

        // Step 1: Get the callback URL
        const url = await getCallbackUrl(params);
        if (!url || cancelled) {
          console.log("[AuthCallback] No URL — bailing to login");
          if (!cancelled) router.replace("/(auth)/login");
          return;
        }
        console.log("[AuthCallback] Got URL:", url.substring(0, 80) + "...");

        // Step 2: Establish session — mutex acquired and released inside
        const result = await processCallbackUrl(url, params);
        if (!result || cancelled) {
          console.log("[AuthCallback] processCallbackUrl returned null — going to login");
          if (!cancelled) router.replace("/(auth)/login");
          return;
        }

        // ── Supabase auth mutex is now fully released ─────────────────────────
        console.log(
          "[AuthCallback] Session established for user:",
          result.user.id.substring(0, 8)
        );

        // Step 3: Analytics identify
        identifyUser(result.user.id, result.user.email);

        // Step 4: Check for password recovery flow
        // type=recovery can be in hash (#access_token=...&type=recovery) or query params
        const parsedUrl = Linking.parse(url!);
        const hash = url!.split("#")[1];
        const hashParams = hash ? new URLSearchParams(hash) : null;
        const urlType =
          hashParams?.get("type") ??
          (parsedUrl.queryParams?.type as string) ??
          (params.type as string);
        console.log("[AuthCallback] Detected type:", urlType);
        if (urlType === "recovery") {
          console.log("[AuthCallback] Recovery flow — navigating to reset-password");
          if (!cancelled) router.replace("/(auth)/reset-password");
          return;
        }
        console.log("[AuthCallback] Not a recovery flow — continuing to profile check");

        // Step 5: Profile check → navigate (no mutex conflict)
        const route = await getPostAuthRoute(result.user.id, result.accessToken);
        console.log("[AuthCallback] Navigating to:", route);

        if (!cancelled) router.replace(route);
      } catch (err) {
        console.error("[AuthCallback] Unhandled error:", err);
        if (!cancelled) router.replace("/(auth)/login");
      }
    };

    // 10s safety net — should never fire if setSession() completes normally
    const fallback = setTimeout(() => {
      console.log("[AuthCallback] 10s fallback — going to login");
      cancelled = true;
      router.replace("/(auth)/login");
    }, 10_000);

    run().finally(() => clearTimeout(fallback));

    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: appColors.background }]}>
      <ActivityIndicator size="large" color={appColors.primary} />
      <Text style={[styles.text, { color: appColors.textSecondary }]}>
        Verifying your account...
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  text: {
    fontSize: 16,
  },
});
