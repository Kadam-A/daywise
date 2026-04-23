/**
 * Reset Password Screen
 *
 * Shown after user taps the password reset link in their email.
 * Session is already established by the auth callback.
 */

import { View, StyleSheet, KeyboardAvoidingView, Platform, Pressable, ScrollView } from "react-native";
import { Text, TextInput, ActivityIndicator } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAppColors } from "@/contexts/ThemeContext";

const COLORS = {
  primary: "#4A90E2",
  background: "#FFFFFF",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  success: "#5FBF73",
  error: "#E25555",
  border: "#E5E7EB",
};

const MIN_PASSWORD_LENGTH = 8;
const HAS_LOWERCASE = /[a-z]/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_NUMBER = /[0-9]/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|<>?,./`~]/;

function getPasswordErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) errors.push("Too short");
  if (!HAS_LOWERCASE.test(password)) errors.push("No lowercase");
  if (!HAS_UPPERCASE.test(password)) errors.push("No uppercase");
  if (!HAS_NUMBER.test(password)) errors.push("No number");
  if (!HAS_SPECIAL.test(password)) errors.push("No special character");
  return errors;
}

function PasswordRequirement({ met, text }: { met: boolean; text: string }) {
  const appColors = useAppColors();
  return (
    <View style={styles.requirement}>
      <MaterialCommunityIcons
        name={met ? "check-circle" : "circle-outline"}
        size={16}
        color={met ? appColors.success : appColors.textTertiary}
      />
      <Text style={[styles.requirementText, { color: appColors.textTertiary }, met && { color: appColors.success }]}>
        {text}
      </Text>
    </View>
  );
}

export default function ResetPasswordScreen() {
  const appColors = useAppColors();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordErrors = getPasswordErrors(password);
  const isPasswordValid = passwordErrors.length === 0 && password.length > 0;
  const doPasswordsMatch = password === confirmPassword;
  const canSubmit = isPasswordValid && doPasswordsMatch && confirmPassword.length > 0;

  const handleReset = async () => {
    if (!canSubmit || loading) return;

    try {
      setLoading(true);
      setError(null);

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      router.replace("/(tabs)/home");
    } catch (err) {
      let message: string;
      if (err instanceof Error && err.name === "AuthWeakPasswordError") {
        message = "Password doesn't meet the security requirements. Please ensure it includes uppercase, lowercase, a number, and a special character.";
      } else {
        message = err instanceof Error ? err.message : "Failed to update password";
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.keyboardView}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Title */}
          <View style={styles.titleArea}>
            <MaterialCommunityIcons name="lock-check-outline" size={40} color={appColors.primary} style={styles.icon} />
            <Text style={[styles.title, { color: appColors.textPrimary }]}>Set new password</Text>
            <Text style={[styles.subtitle, { color: appColors.textSecondary }]}>
              Choose a strong password for your account.
            </Text>
          </View>

          {/* Error */}
          {error && (
            <View style={[styles.errorContainer, { backgroundColor: appColors.errorLight }]}>
              <MaterialCommunityIcons name="alert-circle" size={18} color={appColors.error} />
              <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>
            </View>
          )}

          {/* New Password */}
          <TextInput
            label="New Password"
            value={password}
            onChangeText={setPassword}
            mode="outlined"
            secureTextEntry={!showPassword}
            style={[styles.input, { backgroundColor: appColors.background }]}
            outlineColor={appColors.border}
            activeOutlineColor={appColors.primary}
            textColor={appColors.textPrimary}
            left={<TextInput.Icon icon="lock-outline" color={appColors.textTertiary} />}
            right={
              <TextInput.Icon
                icon={showPassword ? "eye-off" : "eye"}
                onPress={() => setShowPassword(!showPassword)}
                color={appColors.textTertiary}
              />
            }
            theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
          />

          {/* Password Requirements */}
          {password.length > 0 && (
            <View style={styles.passwordRequirements}>
              <PasswordRequirement met={password.length >= MIN_PASSWORD_LENGTH} text="At least 8 characters" />
              <PasswordRequirement met={HAS_LOWERCASE.test(password)} text="At least one lowercase letter (a-z)" />
              <PasswordRequirement met={HAS_UPPERCASE.test(password)} text="At least one uppercase letter (A-Z)" />
              <PasswordRequirement met={HAS_NUMBER.test(password)} text="At least one number (0-9)" />
              <PasswordRequirement met={HAS_SPECIAL.test(password)} text="At least one special character (!@#$%^&*...)" />
            </View>
          )}

          {/* Confirm Password */}
          <TextInput
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            mode="outlined"
            secureTextEntry={!showPassword}
            style={[styles.input, { backgroundColor: appColors.background }]}
            outlineColor={confirmPassword.length > 0 && !doPasswordsMatch ? appColors.error : appColors.border}
            activeOutlineColor={appColors.primary}
            textColor={appColors.textPrimary}
            left={<TextInput.Icon icon="lock-check-outline" color={appColors.textTertiary} />}
            error={confirmPassword.length > 0 && !doPasswordsMatch}
            theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
          />
          {confirmPassword.length > 0 && !doPasswordsMatch && (
            <Text style={[styles.fieldError, { color: appColors.error }]}>Passwords don't match</Text>
          )}

          {/* Submit Button */}
          <Pressable
            style={[styles.button, { backgroundColor: appColors.primary }, (!canSubmit || loading) && styles.buttonDisabled]}
            onPress={handleReset}
            disabled={!canSubmit || loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Set New Password</Text>
            )}
          </Pressable>

        </ScrollView>
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 24,
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
    marginBottom: 12,
    backgroundColor: COLORS.background,
  },
  passwordRequirements: {
    marginBottom: 12,
    marginTop: -4,
    paddingHorizontal: 4,
  },
  requirement: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  requirementText: {
    fontSize: 13,
    color: COLORS.textTertiary,
  },
  fieldError: {
    fontSize: 12,
    color: COLORS.error,
    marginTop: -8,
    marginBottom: 12,
    marginLeft: 4,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
