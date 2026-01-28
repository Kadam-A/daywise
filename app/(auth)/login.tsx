/**
 * Login Screen
 *
 * Google OAuth authentication via Supabase
 * Also supports email/password for admin/testing
 */

import { View, StyleSheet } from "react-native";
import { Button, Text, Surface, ActivityIndicator, TextInput, Divider } from "react-native-paper";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { supabase } from "@/lib/supabase";

// Required for web browser auth sessions
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email/password login state
  const [showEmailLogin, setShowEmailLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setError(null);

      // Create redirect URI for OAuth callback
      // useProxy: true is required for Expo Go
      const redirectUri = makeRedirectUri({
        scheme: "tailoredtime",
        path: "auth/callback",
        preferLocalhost: false,
      });

      console.log("[OAuth] Redirect URI:", redirectUri);

      // Start OAuth flow with Supabase
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      });

      if (oauthError) throw oauthError;
      if (!data.url) throw new Error("No OAuth URL returned");

      // Open browser for Google sign-in
      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectUri
      );

      if (result.type === "success" && result.url) {
        // Extract tokens from URL
        const url = new URL(result.url);
        const params = new URLSearchParams(url.hash.substring(1));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (accessToken) {
          // Set the session in Supabase
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || "",
          });

          if (sessionError) throw sessionError;

          // Check if user has completed onboarding
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("personality_data")
            .single();

          // If default personality data, go to onboarding
          const isDefaultProfile =
            profile?.personality_data?.chronotype === 50 &&
            profile?.personality_data?.focus_duration === 50;

          if (isDefaultProfile) {
            router.replace("/(auth)/onboarding");
          } else {
            router.replace("/(tabs)/home");
          }
        }
      } else if (result.type === "cancel") {
        setError("Sign in cancelled");
      }
    } catch (err) {
      console.error("[Login Error]", err);
      setError(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setLoading(false);
    }
  };

  // Email/password login for admin/testing
  const handleEmailLogin = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!email.trim() || !password) {
        setError("Please enter email and password");
        return;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;

      if (data.user) {
        // Check if user has completed onboarding
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("personality_data")
          .single();

        const isDefaultProfile =
          profile?.personality_data?.chronotype === 50 &&
          profile?.personality_data?.focus_duration === 50;

        if (isDefaultProfile) {
          router.replace("/(auth)/onboarding");
        } else {
          router.replace("/(tabs)/home");
        }
      }
    } catch (err) {
      console.error("[Email Login Error]", err);
      setError(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Surface style={styles.logoContainer} elevation={0}>
          <Text variant="displaySmall" style={styles.logo}>
            ⏰
          </Text>
          <Text variant="headlineLarge" style={styles.title}>
            TailoredTime
          </Text>
          <Text variant="bodyLarge" style={styles.tagline}>
            Time management, tailored to you
          </Text>
        </Surface>

        <View style={styles.buttonContainer}>
          {error && (
            <Text variant="bodySmall" style={styles.error}>
              {error}
            </Text>
          )}

          <Button
            mode="contained"
            onPress={handleGoogleLogin}
            icon={loading ? undefined : "google"}
            style={styles.button}
            contentStyle={styles.buttonContent}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              "Continue with Google"
            )}
          </Button>

          {/* Admin/Dev Login Toggle */}
          <Button
            mode="text"
            onPress={() => setShowEmailLogin(!showEmailLogin)}
            style={styles.devToggle}
          >
            {showEmailLogin ? "Hide" : "Admin Login"}
          </Button>

          {/* Email/Password Login */}
          {showEmailLogin && (
            <View style={styles.emailLogin}>
              <Divider style={styles.divider} />
              <Text variant="labelMedium" style={styles.devLabel}>
                Developer/Admin Login
              </Text>
              <TextInput
                label="Email"
                value={email}
                onChangeText={setEmail}
                mode="outlined"
                keyboardType="email-address"
                autoCapitalize="none"
                style={styles.input}
              />
              <TextInput
                label="Password"
                value={password}
                onChangeText={setPassword}
                mode="outlined"
                secureTextEntry
                style={styles.input}
              />
              <Button
                mode="outlined"
                onPress={handleEmailLogin}
                disabled={loading}
                loading={loading}
                style={styles.emailButton}
              >
                Sign In
              </Button>
            </View>
          )}

          <Text variant="bodySmall" style={styles.disclaimer}>
            By continuing, you agree to our Terms of Service and Privacy Policy
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
    padding: 24,
  },
  logoContainer: {
    alignItems: "center",
    marginTop: 120,
    backgroundColor: "transparent",
  },
  logo: {
    fontSize: 72,
    marginBottom: 16,
  },
  title: {
    fontWeight: "bold",
    color: "#2563eb",
    marginBottom: 8,
  },
  tagline: {
    color: "#64748b",
    textAlign: "center",
  },
  buttonContainer: {
    marginBottom: 40,
  },
  error: {
    color: "#dc2626",
    textAlign: "center",
    marginBottom: 12,
  },
  button: {
    marginBottom: 16,
  },
  buttonContent: {
    paddingVertical: 8,
  },
  disclaimer: {
    textAlign: "center",
    color: "#94a3b8",
    paddingHorizontal: 20,
  },
  devToggle: {
    marginBottom: 8,
  },
  emailLogin: {
    marginBottom: 16,
  },
  divider: {
    marginBottom: 16,
  },
  devLabel: {
    textAlign: "center",
    color: "#64748b",
    marginBottom: 12,
  },
  input: {
    marginBottom: 12,
  },
  emailButton: {
    marginBottom: 8,
  },
});
