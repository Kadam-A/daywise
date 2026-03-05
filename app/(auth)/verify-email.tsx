/**
 * Verify Email Screen
 *
 * Shown after user signs up with email/password.
 * Prompts them to check their email for verification link.
 */

import { View, StyleSheet, Pressable } from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useEffect } from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
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

// Cooldown for resend button (seconds)
const RESEND_COOLDOWN = 60;

export default function VerifyEmailScreen() {
  const appColors = useAppColors();
  const { email } = useLocalSearchParams<{ email: string }>();
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  // Check if user has verified (poll every 3 seconds)
  useEffect(() => {
    const checkVerification = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email_confirmed_at) {
        // User verified, go to onboarding
        router.replace("/(auth)/onboarding");
      }
    };

    const interval = setInterval(checkVerification, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleResendEmail = async () => {
    if (!email || resendCooldown > 0) return;

    try {
      setIsResending(true);
      setMessage(null);

      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
      });

      if (error) throw error;

      setMessage({ type: "success", text: "Verification email sent!" });
      setResendCooldown(RESEND_COOLDOWN);
    } catch (err) {
      console.error("[VerifyEmail] Resend error:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to resend email",
      });
    } finally {
      setIsResending(false);
    }
  };

  const handleUseDifferentEmail = () => {
    router.replace("/(auth)/login");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={[styles.iconContainer, { backgroundColor: `${appColors.primary}10` }]}>
          <MaterialCommunityIcons name="email-check-outline" size={80} color={appColors.primary} />
        </View>

        {/* Title */}
        <Text style={[styles.title, { color: appColors.textPrimary }]}>Check your email</Text>

        {/* Description */}
        <Text style={[styles.description, { color: appColors.textSecondary }]}>
          We sent a verification link to
        </Text>
        <Text style={[styles.email, { color: appColors.primary }]}>{email}</Text>
        <Text style={[styles.description, { color: appColors.textSecondary }]}>
          Click the link in the email to verify your account and continue.
        </Text>

        {/* Message */}
        {message && (
          <View style={[
            styles.messageContainer,
            { backgroundColor: message.type === "success" ? appColors.successLight : appColors.errorLight },
          ]}>
            <MaterialCommunityIcons
              name={message.type === "success" ? "check-circle" : "alert-circle"}
              size={18}
              color={message.type === "success" ? appColors.success : appColors.error}
            />
            <Text style={[
              styles.messageText,
              { color: message.type === "success" ? appColors.success : appColors.error },
            ]}>
              {message.text}
            </Text>
          </View>
        )}

        {/* Resend Button */}
        <Pressable
          style={[
            styles.resendButton,
            { borderColor: appColors.primary },
            (isResending || resendCooldown > 0) && { borderColor: appColors.textTertiary },
          ]}
          onPress={handleResendEmail}
          disabled={isResending || resendCooldown > 0}
        >
          {isResending ? (
            <ActivityIndicator size="small" color={appColors.primary} />
          ) : (
            <Text style={[styles.resendButtonText, { color: appColors.primary }]}>
              {resendCooldown > 0
                ? `Resend in ${resendCooldown}s`
                : "Resend verification email"}
            </Text>
          )}
        </Pressable>

        {/* Use Different Email */}
        <Pressable style={styles.differentEmailButton} onPress={handleUseDifferentEmail}>
          <MaterialCommunityIcons name="arrow-left" size={18} color={appColors.textSecondary} />
          <Text style={[styles.differentEmailText, { color: appColors.textSecondary }]}>Use a different email</Text>
        </Pressable>

        {/* Help Text */}
        <View style={[styles.helpContainer, { backgroundColor: appColors.surface }]}>
          <MaterialCommunityIcons name="information-outline" size={16} color={appColors.textTertiary} />
          <Text style={[styles.helpText, { color: appColors.textTertiary }]}>
            Didn't receive the email? Check your spam folder or try resending.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: `${COLORS.primary}10`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.textPrimary,
    marginBottom: 16,
    textAlign: "center",
  },
  description: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 24,
  },
  email: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.primary,
    marginVertical: 8,
  },
  messageContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 24,
    gap: 8,
    width: "100%",
  },
  successMessage: {
    backgroundColor: `${COLORS.success}10`,
  },
  errorMessage: {
    backgroundColor: `${COLORS.error}10`,
  },
  messageText: {
    flex: 1,
    fontSize: 14,
  },
  resendButton: {
    marginTop: 32,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
    minWidth: 200,
    alignItems: "center",
  },
  buttonDisabled: {
    borderColor: COLORS.textTertiary,
  },
  resendButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.primary,
  },
  differentEmailButton: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    gap: 6,
    padding: 8,
  },
  differentEmailText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  helpContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    position: "absolute",
    bottom: 40,
    left: 24,
    right: 24,
    gap: 8,
    backgroundColor: COLORS.surface,
    padding: 16,
    borderRadius: 12,
  },
  helpText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textTertiary,
    lineHeight: 18,
  },
});
