/**
 * Login Screen
 *
 * Supports both Google OAuth and email/password authentication.
 * Users can toggle between Sign Up and Sign In modes for email auth.
 */

import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable, Linking } from "react-native";
import { Button, Text, Surface, ActivityIndicator, TextInput, Divider } from "react-native-paper";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useEffect } from "react";
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { getPostAuthRoute } from "@/lib/auth-utils";
import { useAppColors } from "@/contexts/ThemeContext";
import { posthog, identifyUser } from "@/lib/posthog";

// Required for web browser auth sessions
WebBrowser.maybeCompleteAuthSession();

// Password requirements — must match Supabase project password strength policy
const MIN_PASSWORD_LENGTH = 8;
const HAS_LOWERCASE = /[a-z]/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_NUMBER = /[0-9]/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|<>?,./`~]/;

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
  const [notice, setNotice] = useState<string | null>(null);
  const { verified } = useLocalSearchParams<{ verified?: string }>();

  // Show notice when arriving from email verification
  useEffect(() => {
    if (verified === "1") {
      setNotice("Email verified! Sign in to continue.");
      setAuthMode("signin");
    }
  }, [verified]);

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

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
        },
      });

      if (oauthError) throw oauthError;
      if (!data.url) throw new Error("No OAuth URL returned");

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

      if (result.type === "success" && result.url) {
        // PKCE code flow (Supabase JS v2 default) — code in query params
        const codeMatch = result.url.match(/[?&]code=([^&#]+)/);
        const code = codeMatch?.[1];

        if (code) {
          const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
          if (sessionError) throw sessionError;
          if (sessionData.user) {
            identifyUser(sessionData.user.id, sessionData.user.email);
            posthog.capture('user_signed_in', { method: 'google' });
          }
          router.replace(await getPostAuthRoute());
          return;
        }

        // Fallback: implicit flow — access_token in URL hash
        // Use regex instead of new URL() to safely handle custom schemes (daywise://)
        const hashMatch = result.url.match(/#(.+)/);
        if (hashMatch) {
          const hashParams = new URLSearchParams(hashMatch[1]);
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");

          if (accessToken) {
            const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken || "",
            });
            if (sessionError) throw sessionError;
            if (sessionData.user) {
              identifyUser(sessionData.user.id, sessionData.user.email);
              posthog.capture('user_signed_in', { method: 'google' });
            }
            router.replace(await getPostAuthRoute());
          }
        }
      } else if (result.type === "cancel") {
        if (Platform.OS === "android") {
          // On Android the OS intercepts daywise://auth/callback via Intent, dismissing
          // the browser and returning 'cancel'. auth/callback.tsx is already processing
          // the result — do nothing here; its 10s fallback handles failure cases.
        } else {
          // On iOS a genuine user tap of "Cancel" in the browser returns this.
          setError("Sign in cancelled");
        }
      }
    } catch (err) {
      console.error("[Login Error]", err);
      const message = err instanceof Error ? err.message : "Failed to sign in";
      posthog.capture('user_sign_in_failed', { method: 'google', error: message });
      setError(message);
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
          emailRedirectTo: "daywise://auth/callback",
        },
      });

      if (signUpError) throw signUpError;

      if (data.user) {
        // Check if email confirmation is required
        if (data.user.identities?.length === 0) {
          setError("An account with this email already exists. Please sign in.");
          return;
        }

        identifyUser(data.user.id, data.user.email);
        posthog.capture('user_signed_up', { method: 'email', requires_confirmation: !data.session });

        if (!data.session) {
          // Email confirmation required
          router.replace({
            pathname: "/(auth)/verify-email",
            params: { email: email.trim() },
          });
        } else {
          // No confirmation needed (unlikely in production)
          router.replace(await getPostAuthRoute());
        }
      }
    } catch (err) {
      console.error("[SignUp Error]", err);
      // AuthWeakPasswordError has name "AuthWeakPasswordError" — give a friendly message
      // rather than exposing the raw Supabase character-set string to the user.
      let message: string;
      if (err instanceof Error && err.name === "AuthWeakPasswordError") {
        message =
          "Password doesn't meet the security requirements. Please ensure it includes uppercase, lowercase, a number, and a special character.";
      } else {
        message = err instanceof Error ? err.message : "Failed to create account";
      }
      posthog.capture('user_sign_in_failed', { method: 'email_signup', error: message });
      setError(message);
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
        identifyUser(data.user.id, data.user.email);
        posthog.capture('user_signed_in', { method: 'email' });
        router.replace(await getPostAuthRoute());
      }
    } catch (err) {
      console.error("[SignIn Error]", err);
      let message: string;
      if (err instanceof Error && err.message.includes("Invalid login")) {
        message = "Invalid email or password";
      } else {
        message = err instanceof Error ? err.message : "Failed to sign in";
      }
      posthog.capture('user_sign_in_failed', { method: 'email_signin', error: message });
      setError(message);
    } finally {
      setLoading(false);
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
            <Text style={[styles.headline, { color: appColors.textPrimary }]}>
              The right task,{"\n"}at the right time.
            </Text>
            <Text style={[styles.tagline, { color: appColors.textSecondary }]}>
              AI that builds your perfect day.
            </Text>
          </View>

          {/* Auth Form */}
          <View style={styles.formContainer}>
            {/* Verified notice */}
            {notice && (
              <View style={[styles.errorContainer, { backgroundColor: appColors.successLight }]}>
                <MaterialCommunityIcons name="check-circle" size={18} color={appColors.success} />
                <Text style={[styles.errorText, { color: appColors.success }]}>{notice}</Text>
              </View>
            )}

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

            {/* Forgot Password (Sign In only) */}
            {authMode === "signin" && (
              <Pressable onPress={() => router.push("/(auth)/forgot-password")} style={styles.forgotPassword}>
                <Text style={[styles.forgotPasswordText, { color: appColors.primary }]}>Forgot password?</Text>
              </Pressable>
            )}

            {/* Password Requirements (Sign Up only) */}
            {authMode === "signup" && password.length > 0 && (
              <View style={styles.passwordRequirements}>
                <PasswordRequirement
                  met={password.length >= MIN_PASSWORD_LENGTH}
                  text="At least 8 characters"
                />
                <PasswordRequirement
                  met={HAS_LOWERCASE.test(password)}
                  text="At least one lowercase letter (a-z)"
                />
                <PasswordRequirement
                  met={HAS_UPPERCASE.test(password)}
                  text="At least one uppercase letter (A-Z)"
                />
                <PasswordRequirement
                  met={HAS_NUMBER.test(password)}
                  text="At least one number (0-9)"
                />
                <PasswordRequirement
                  met={HAS_SPECIAL.test(password)}
                  text="At least one special character (!@#$%^&*...)"
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
                  {authMode === "signup" ? "Get Started" : "Sign In"}
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
            <Text
              style={[styles.termsLink, { color: appColors.primary }]}
              onPress={() => Linking.openURL("https://daywiseapp.com/terms")}
            >Terms of Service</Text>
            {" "}and{" "}
            <Text
              style={[styles.termsLink, { color: appColors.primary }]}
              onPress={() => Linking.openURL("https://daywiseapp.com/privacy")}
            >Privacy Policy</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Password validation helper — criteria must match the Supabase password strength policy
function getPasswordErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) errors.push("Too short");
  if (!HAS_LOWERCASE.test(password)) errors.push("No lowercase letter");
  if (!HAS_UPPERCASE.test(password)) errors.push("No uppercase letter");
  if (!HAS_NUMBER.test(password)) errors.push("No number");
  if (!HAS_SPECIAL.test(password)) errors.push("No special character");
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
  headline: {
    fontSize: 34,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 42,
    marginBottom: 10,
  },
  tagline: {
    fontSize: 15,
    textAlign: "center",
    letterSpacing: 0.2,
    lineHeight: 22,
    fontWeight: "400",
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
  forgotPassword: {
    alignSelf: "flex-end",
    marginTop: -4,
    marginBottom: 12,
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: "500",
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
