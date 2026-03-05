/**
 * Login Screen
 *
 * Supports both Google OAuth and email/password authentication.
 * Users can toggle between Sign Up and Sign In modes for email auth.
 */

import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable } from "react-native";
import { Button, Text, Surface, ActivityIndicator, TextInput, Divider } from "react-native-paper";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAppColors } from "@/contexts/ThemeContext";

// Required for web browser auth sessions
WebBrowser.maybeCompleteAuthSession();

// Password requirements
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_REGEX = /^(?=.*[0-9]).{8,}$/; // At least 8 chars and 1 number

const COLORS = {
  primary: "#4A90E2",
  primaryDark: "#3A7BC8",
  secondary: "#7C6FBF",
  background: "#FFFFFF",
  surface: "#F8F9FB",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  error: "#E25555",
  border: "#E5E7EB",
  success: "#5FBF73",
};

type AuthMode = "signin" | "signup";

export default function LoginScreen() {
  const appColors = useAppColors();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auth mode
  const [authMode, setAuthMode] = useState<AuthMode>("signup");

  // Email/password state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Password validation
  const passwordErrors = getPasswordErrors(password);
  const isPasswordValid = passwordErrors.length === 0 && password.length > 0;
  const doPasswordsMatch = password === confirmPassword;

  // Form validation
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSubmitSignUp = isEmailValid && isPasswordValid && doPasswordsMatch;
  const canSubmitSignIn = isEmailValid && password.length > 0;

  // Handle Google OAuth login
  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setError(null);

      const redirectUri = makeRedirectUri({
        scheme: "daywise",
        path: "auth/callback",
        preferLocalhost: false,
      });

      console.log("[OAuth] Redirect URI:", redirectUri);

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      });

      if (oauthError) throw oauthError;
      if (!data.url) throw new Error("No OAuth URL returned");

      const result = await WebBrowser.openAuthSessionAsync(
        data.url,
        redirectUri
      );

      if (result.type === "success" && result.url) {
        const url = new URL(result.url);
        const params = new URLSearchParams(url.hash.substring(1));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");

        if (accessToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken || "",
          });

          if (sessionError) throw sessionError;

          await checkOnboardingAndNavigate();
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

  // Handle email sign up
  const handleEmailSignUp = async () => {
    if (!canSubmitSignUp) return;

    try {
      setLoading(true);
      setError(null);

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: makeRedirectUri({
            scheme: "daywise",
            path: "auth/callback",
          }),
        },
      });

      if (signUpError) throw signUpError;

      if (data.user) {
        // Check if email confirmation is required
        if (data.user.identities?.length === 0) {
          setError("An account with this email already exists. Please sign in.");
          return;
        }

        if (!data.session) {
          // Email confirmation required
          router.replace({
            pathname: "/(auth)/verify-email",
            params: { email: email.trim() },
          });
        } else {
          // No confirmation needed (unlikely in production)
          await checkOnboardingAndNavigate();
        }
      }
    } catch (err) {
      console.error("[SignUp Error]", err);
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  // Handle email sign in
  const handleEmailSignIn = async () => {
    if (!canSubmitSignIn) return;

    try {
      setLoading(true);
      setError(null);

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) throw signInError;

      if (data.user) {
        await checkOnboardingAndNavigate();
      }
    } catch (err) {
      console.error("[SignIn Error]", err);
      if (err instanceof Error && err.message.includes("Invalid login")) {
        setError("Invalid email or password");
      } else {
        setError(err instanceof Error ? err.message : "Failed to sign in");
      }
    } finally {
      setLoading(false);
    }
  };

  // Check if user needs onboarding and navigate
  const checkOnboardingAndNavigate = async () => {
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
  };

  // Toggle auth mode
  const toggleAuthMode = () => {
    setAuthMode(authMode === "signin" ? "signup" : "signin");
    setError(null);
    setPassword("");
    setConfirmPassword("");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={styles.logoContainer}>
            <Text style={styles.logo}>⏰</Text>
            <Text style={[styles.title, { color: appColors.primary }]}>DayWise</Text>
            <Text style={[styles.tagline, { color: appColors.textSecondary }]}>
              Time management, tailored to you
            </Text>
          </View>

          {/* Auth Form */}
          <View style={styles.formContainer}>
            {/* Error Message */}
            {error && (
              <View style={[styles.errorContainer, { backgroundColor: appColors.errorLight }]}>
                <MaterialCommunityIcons name="alert-circle" size={18} color={appColors.error} />
                <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>
              </View>
            )}

            {/* Google Button */}
            <Pressable
              style={[styles.googleButton, { backgroundColor: appColors.surface, borderColor: appColors.border }, loading && styles.buttonDisabled]}
              onPress={handleGoogleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color={appColors.textPrimary} />
              ) : (
                <>
                  <MaterialCommunityIcons name="google" size={20} color={appColors.textPrimary} />
                  <Text style={[styles.googleButtonText, { color: appColors.textPrimary }]}>Continue with Google</Text>
                </>
              )}
            </Pressable>

            {/* Divider */}
            <View style={styles.dividerContainer}>
              <View style={[styles.dividerLine, { backgroundColor: appColors.border }]} />
              <Text style={[styles.dividerText, { color: appColors.textTertiary }]}>
                or {authMode === "signup" ? "sign up" : "sign in"} with email
              </Text>
              <View style={[styles.dividerLine, { backgroundColor: appColors.border }]} />
            </View>

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

            {/* Password Input */}
            <TextInput
              label="Password"
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

            {/* Password Requirements (Sign Up only) */}
            {authMode === "signup" && password.length > 0 && (
              <View style={styles.passwordRequirements}>
                <PasswordRequirement
                  met={password.length >= MIN_PASSWORD_LENGTH}
                  text="At least 8 characters"
                />
                <PasswordRequirement
                  met={/[0-9]/.test(password)}
                  text="At least 1 number"
                />
              </View>
            )}

            {/* Confirm Password (Sign Up only) */}
            {authMode === "signup" && (
              <TextInput
                label="Confirm Password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                mode="outlined"
                secureTextEntry={!showPassword}
                style={[styles.input, { backgroundColor: appColors.background }]}
                outlineColor={
                  confirmPassword.length > 0 && !doPasswordsMatch
                    ? appColors.error
                    : appColors.border
                }
                activeOutlineColor={appColors.primary}
                textColor={appColors.textPrimary}
                left={<TextInput.Icon icon="lock-check-outline" color={appColors.textTertiary} />}
                error={confirmPassword.length > 0 && !doPasswordsMatch}
                theme={{ colors: { onSurfaceVariant: appColors.textTertiary } }}
              />
            )}
            {authMode === "signup" && confirmPassword.length > 0 && !doPasswordsMatch && (
              <Text style={[styles.fieldError, { color: appColors.error }]}>Passwords don't match</Text>
            )}

            {/* Submit Button */}
            <Pressable
              style={[
                styles.submitButton,
                { backgroundColor: appColors.primary },
                (loading || (authMode === "signup" ? !canSubmitSignUp : !canSubmitSignIn)) &&
                  { backgroundColor: appColors.textTertiary },
              ]}
              onPress={authMode === "signup" ? handleEmailSignUp : handleEmailSignIn}
              disabled={loading || (authMode === "signup" ? !canSubmitSignUp : !canSubmitSignIn)}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {authMode === "signup" ? "Create Account" : "Sign In"}
                </Text>
              )}
            </Pressable>

            {/* Toggle Auth Mode */}
            <View style={styles.toggleContainer}>
              <Text style={[styles.toggleText, { color: appColors.textSecondary }]}>
                {authMode === "signup"
                  ? "Already have an account?"
                  : "Don't have an account?"}
              </Text>
              <Pressable onPress={toggleAuthMode}>
                <Text style={[styles.toggleLink, { color: appColors.primary }]}>
                  {authMode === "signup" ? "Sign In" : "Sign Up"}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Terms */}
          <Text style={[styles.terms, { color: appColors.textTertiary }]}>
            By continuing, you agree to our{" "}
            <Text style={[styles.termsLink, { color: appColors.primary }]}>Terms of Service</Text>
            {" "}and{" "}
            <Text style={[styles.termsLink, { color: appColors.primary }]}>Privacy Policy</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Password validation helper
function getPasswordErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push("Too short");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("No number");
  }
  return errors;
}

// Password requirement component
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
    padding: 24,
    justifyContent: "center",
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 40,
  },
  logo: {
    fontSize: 64,
    marginBottom: 12,
  },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: COLORS.primary,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: "center",
  },
  formContainer: {
    marginBottom: 24,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: `${COLORS.error}10`,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: COLORS.error,
    fontSize: 14,
  },
  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 10,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 14,
    color: COLORS.textTertiary,
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
  requirementMet: {
    color: COLORS.success,
  },
  fieldError: {
    fontSize: 12,
    color: COLORS.error,
    marginTop: -8,
    marginBottom: 12,
    marginLeft: 4,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.textTertiary,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  toggleContainer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    gap: 6,
  },
  toggleText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  toggleLink: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.primary,
  },
  terms: {
    fontSize: 12,
    color: COLORS.textTertiary,
    textAlign: "center",
    lineHeight: 18,
  },
  termsLink: {
    color: COLORS.primary,
  },
});
