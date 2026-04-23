/**
 * Forgot Password Screen
 *
 * User enters their email and receives a password reset link.
 */

import { View, StyleSheet, KeyboardAvoidingView, Platform, Pressable, AppState } from "react-native";
import { Text, TextInput, ActivityIndicator } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState, useEffect, useRef } from "react";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppColors } from "@/contexts/ThemeContext";

const COLORS = {
  primary: "#4A90E2",
  background: "#FFFFFF",
  surface: "#F8F9FB",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  success: "#5FBF73",
  error: "#E25555",
  border: "#E5E7EB",
};

const RESEND_COOLDOWN = 60;

export default function ForgotPasswordScreen() {
  const appColors = useAppColors();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownEndRef = useRef<number>(0);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Recalculate remaining cooldown from timestamp — works correctly after backgrounding
  const recalcCooldown = () => {
    const remaining = Math.ceil((cooldownEndRef.current - Date.now()) / 1000);
    setCooldown(remaining > 0 ? remaining : 0);
  };

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(recalcCooldown, 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") recalcCooldown();
    });
    return () => sub.remove();
  }, []);

  const handleSend = async () => {
    if (!isEmailValid || loading) return;

    try {
      setLoading(true);
      setError(null);

      const redirectTo = "https://daywiseapp.com/auth/callback";
      console.log("[ForgotPassword] Sending reset email to:", email.trim(), "redirectTo:", redirectTo);
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (resetError) throw resetError;

      setSent(true);
      cooldownEndRef.current = Date.now() + RESEND_COOLDOWN * 1000;
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.keyboardView}>

        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={appColors.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.content}>
          {!sent ? (
            <>
              {/* Title */}
              <View style={styles.titleArea}>
                <MaterialCommunityIcons name="lock-reset" size={40} color={appColors.primary} style={styles.icon} />
                <Text style={[styles.title, { color: appColors.textPrimary }]}>Forgot your password?</Text>
                <Text style={[styles.subtitle, { color: appColors.textSecondary }]}>
                  Enter your email and we'll send you a link to reset your password.
                </Text>
              </View>

              {/* Error */}
              {error && (
                <View style={[styles.errorContainer, { backgroundColor: appColors.errorLight }]}>
                  <MaterialCommunityIcons name="alert-circle" size={18} color={appColors.error} />
                  <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>
                </View>
              )}

              {/* Email Input */}
              <TextInput
                label="Email"
                value={email}
                onChangeText={setEmail}
                mode="outlined"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={[styles.input, { backgroundColor: appColors.background }]}
                outlineColor={appColors.border}
                activeOutlineColor={appColors.primary}
                textColor={appColors.textPrimary}
                left={<TextInput.Icon icon="email-outline" color={appColors.textTertiary} />}
                theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
              />

              {/* Submit Button */}
              <Pressable
                style={[styles.button, { backgroundColor: appColors.primary }, (!isEmailValid || loading) && styles.buttonDisabled]}
                onPress={handleSend}
                disabled={!isEmailValid || loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>Send Reset Link</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              {/* Success State */}
              <View style={styles.titleArea}>
                <MaterialCommunityIcons name="email-check-outline" size={40} color={appColors.success} style={styles.icon} />
                <Text style={[styles.title, { color: appColors.textPrimary }]}>Check your email</Text>
                <Text style={[styles.subtitle, { color: appColors.textSecondary }]}>
                  We sent a password reset link to{" "}
                  <Text style={{ fontWeight: "600", color: appColors.textPrimary }}>{email}</Text>
                </Text>
              </View>

              {/* Resend Button */}
              <Pressable
                style={[styles.button, { backgroundColor: appColors.primary }, (cooldown > 0 || loading) && styles.buttonDisabled]}
                onPress={handleSend}
                disabled={cooldown > 0 || loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.buttonText}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Email"}
                  </Text>
                )}
              </Pressable>

              {/* Back to Sign In */}
              <Pressable onPress={() => router.replace("/(auth)/login")} style={styles.backToLogin}>
                <Text style={[styles.backToLoginText, { color: appColors.textSecondary }]}>Back to Sign In</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    padding: 4,
    alignSelf: "flex-start",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  titleArea: {
    alignItems: "center",
    marginBottom: 32,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
  },
  input: {
    marginBottom: 16,
    backgroundColor: COLORS.background,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  backToLogin: {
    alignItems: "center",
    marginTop: 20,
  },
  backToLoginText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
