/**
 * Personality Profile Screen
 *
 * Shows user's personality data with visual sliders
 * Allows manual adjustment without retaking the full quiz
 */

import { View, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import {
  Text,
  Button,
  ActivityIndicator,
  Divider,
} from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { trackPersonalityUpdated } from "@/lib/analytics";
import Slider from "@react-native-community/slider";
import { PersonalityData } from "@/lib/types";
import { useAppColors } from "@/contexts/ThemeContext";

// Design colors
const COLORS = {
  primary: "#4A90E2",
  secondary: "#7C6FBF",
  background: "#F8F9FB",
  surface: "#FFFFFF",
  textPrimary: "#1A1D23",
  textSecondary: "#5C6370",
  textTertiary: "#9CA3AF",
  border: "#E5E7EB",
  success: "#5FBF73",
  warning: "#F5A962",
};

// Peak window options (mirrors onboarding)
type PeakWindow = { start: number; end: number };
const PEAK_WINDOW_OPTIONS: { label: string; description: string; value: PeakWindow }[] = [
  { label: "Early morning", description: "6–9am", value: { start: 6, end: 9 } },
  { label: "Morning", description: "9am–12pm", value: { start: 9, end: 12 } },
  { label: "Early afternoon", description: "12–3pm", value: { start: 12, end: 15 } },
  { label: "Afternoon", description: "3–6pm", value: { start: 15, end: 18 } },
  { label: "Evening", description: "6–9pm", value: { start: 18, end: 21 } },
  { label: "Late night", description: "9pm–midnight", value: { start: 21, end: 24 } },
];

// Personality dimension definitions (chronotype replaced by PeakWindowsPicker above)
const PERSONALITY_DIMENSIONS: {
  key: keyof PersonalityData;
  label: string;
  leftLabel: string;
  rightLabel: string;
  icon: string;
  description: string;
}[] = [
  // Note: chronotype replaced by PeakWindowsPicker
  {
    key: "focus_duration",
    label: "Focus Duration",
    leftLabel: "Short Sprints",
    rightLabel: "Deep Focus",
    icon: "timer-sand",
    description: "How long do you prefer to work without breaks?",
  },
  {
    key: "deadline_style",
    label: "Deadline Style",
    leftLabel: "Early Starter",
    rightLabel: "Pressure Driven",
    icon: "target",
    description: "When do you start working on tasks?",
  },
  {
    key: "break_frequency",
    label: "Break Frequency",
    leftLabel: "Frequent",
    rightLabel: "Marathon",
    icon: "coffee",
    description: "How often do you need breaks?",
  },
  {
    key: "task_switching",
    label: "Task Switching",
    leftLabel: "Single-Task",
    rightLabel: "Multi-Task",
    icon: "swap-horizontal",
    description: "Do you prefer batching or variety?",
  },
  {
    key: "structure_preference",
    label: "Structure",
    leftLabel: "Rigid",
    rightLabel: "Flexible",
    icon: "calendar-check",
    description: "How structured is your ideal schedule?",
  },
];

export default function PersonalityScreen() {
  const appColors = useAppColors();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [personality, setPersonality] = useState<PersonalityData | null>(null);
  const [originalPersonality, setOriginalPersonality] = useState<PersonalityData | null>(null);
  const [peakWindows, setPeakWindows] = useState<PeakWindow[]>([]);
  const [originalPeakWindows, setOriginalPeakWindows] = useState<PeakWindow[]>([]);

  useEffect(() => {
    loadPersonality();
  }, []);

  const loadPersonality = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile, error } = await supabase
        .from("user_profiles")
        .select("personality_data")
        .eq("id", user.id)
        .single();

      if (error) throw error;

      if (profile?.personality_data) {
        setPersonality(profile.personality_data);
        setOriginalPersonality(profile.personality_data);
        const savedWindows = profile.personality_data.peak_windows ?? [];
        setPeakWindows(savedWindows);
        setOriginalPeakWindows(savedWindows);
      }
    } catch (error) {
      console.error("[Personality] Error loading:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSliderChange = (key: keyof PersonalityData, value: number) => {
    setPersonality((prev) => prev ? { ...prev, [key]: Math.round(value) } : prev);
  };

  const handleSave = async () => {
    if (!personality) return;

    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();

      // Derive chronotype from peak_windows for backward compat
      const derivedChronotype =
        peakWindows.length === 0 ? personality.chronotype :
        peakWindows.every((w) => w.end <= 12) ? 80 :
        peakWindows.every((w) => w.start >= 15) ? 20 :
        50;

      // Re-fetch latest personality_data from DB before saving to avoid
      // overwriting keys set by other screens (e.g. preferred_windows from Work Hours)
      const { data: freshProfile } = await supabase
        .from("user_profiles")
        .select("personality_data")
        .eq("id", user?.id)
        .single();

      // Only apply the slider fields managed by this screen.
      // All other keys (preferred_windows, auto_reschedule_*) come exclusively
      // from the fresh DB fetch so they are never overwritten by stale local state.
      const updatedPersonality: PersonalityData = {
        ...freshProfile?.personality_data,
        focus_duration: personality.focus_duration,
        deadline_style: personality.deadline_style,
        break_frequency: personality.break_frequency,
        task_switching: personality.task_switching,
        structure_preference: personality.structure_preference,
        chronotype: derivedChronotype,
        peak_windows: peakWindows.length > 0 ? peakWindows : undefined,
      };

      const { error, count } = await supabase
        .from("user_profiles")
        .update({ personality_data: updatedPersonality })
        .eq("id", user?.id)
        .select();

      if (error) throw error;
      if (count === 0) throw new Error("No rows updated — profile may not exist");

      setPersonality(updatedPersonality);
      setOriginalPersonality(updatedPersonality);
      setOriginalPeakWindows(peakWindows);
      trackPersonalityUpdated(); // fire-and-forget
      router.back();
    } catch (error) {
      console.error("[Personality] Error saving:", error);
      Alert.alert("Save Failed", "Your changes couldn't be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (originalPersonality) {
      setPersonality(originalPersonality);
      setPeakWindows(originalPeakWindows);
    }
  };

  const hasChanges = (personality && originalPersonality
    ? JSON.stringify(personality) !== JSON.stringify(originalPersonality)
    : false) || JSON.stringify(peakWindows) !== JSON.stringify(originalPeakWindows);

  const getValueDescription = (key: keyof PersonalityData, value: number): string => {
    switch (key) {
      case "chronotype":
        if (value < 30) return "Most productive in the evening";
        if (value > 70) return "Most productive in the morning";
        return "Flexible throughout the day";
      case "focus_duration":
        if (value < 30) return "25-45 min focused sessions";
        if (value > 70) return "2-3 hour deep work blocks";
        return "~1 hour work sessions";
      case "deadline_style":
        if (value < 30) return "Start tasks well before deadlines";
        if (value > 70) return "Thrive under deadline pressure";
        return "Balanced approach to deadlines";
      case "break_frequency":
        if (value < 30) return "Need breaks every 25-30 min";
        if (value > 70) return "Can work 2-3 hours straight";
        return "Break every hour or so";
      case "task_switching":
        if (value < 30) return "Focus on one task at a time";
        if (value > 70) return "Comfortable switching often";
        return "Moderate task switching";
      case "structure_preference":
        if (value < 30) return "Prefer consistent schedules";
        if (value > 70) return "Adapt easily to changes";
        return "Some structure with flexibility";
      default:
        return "";
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={appColors.primary} />
          <Text style={[styles.loadingText, { color: appColors.textSecondary }]}>Loading your profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={["top"]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={appColors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: appColors.textPrimary }]}>Your Profile</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Intro Card */}
        <View style={[styles.introCard, { backgroundColor: appColors.surface }]}>
          <MaterialCommunityIcons name="head-lightbulb-outline" size={32} color={appColors.primary} />
          <View style={styles.introContent}>
            <Text style={[styles.introTitle, { color: appColors.textPrimary }]}>Personality-Based Scheduling</Text>
            <Text style={[styles.introText, { color: appColors.textSecondary }]}>
              These settings help us find the best times for your tasks based on how you work best.
            </Text>
          </View>
        </View>

        {/* Peak Windows Picker */}
        <View style={[styles.dimensionCard, { backgroundColor: appColors.surface }]}>
          <View style={styles.dimensionHeader}>
            <View style={styles.dimensionTitleRow}>
              <MaterialCommunityIcons name="lightning-bolt" size={22} color={appColors.primary} />
              <Text style={[styles.dimensionLabel, { color: appColors.textPrimary }]}>Peak Energy Windows</Text>
            </View>
          </View>
          <Text style={[styles.dimensionDescription, { color: appColors.textTertiary }]}>
            When are you most energised and focused? Select 1 or 2 windows.
          </Text>
          <View style={styles.peakWindowsGrid}>
            {PEAK_WINDOW_OPTIONS.map((opt) => {
              const active = peakWindows.some((s) => s.start === opt.value.start);
              const atMax = peakWindows.length >= 2 && !active;
              return (
                <Pressable
                  key={opt.value.start}
                  style={[
                    styles.peakWindowChip,
                    { borderColor: appColors.border, backgroundColor: appColors.background },
                    active && { borderColor: appColors.primary, backgroundColor: appColors.primaryLight },
                    atMax && { opacity: 0.45 },
                  ]}
                  onPress={() => {
                    if (atMax) return;
                    setPeakWindows((prev) =>
                      prev.some((s) => s.start === opt.value.start)
                        ? prev.filter((s) => s.start !== opt.value.start)
                        : [...prev, opt.value],
                    );
                  }}
                  disabled={atMax}
                >
                  <Text style={[styles.peakWindowLabel, { color: appColors.textPrimary }, active && { color: appColors.primary }]}>
                    {opt.label}
                  </Text>
                  <Text style={[styles.peakWindowSub, { color: appColors.textSecondary }]}>
                    {opt.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Personality Sliders */}
        {personality && PERSONALITY_DIMENSIONS.map((dim, index) => (
          <View key={dim.key} style={[styles.dimensionCard, { backgroundColor: appColors.surface }]}>
            <View style={styles.dimensionHeader}>
              <View style={styles.dimensionTitleRow}>
                <MaterialCommunityIcons
                  name={dim.icon as any}
                  size={22}
                  color={appColors.primary}
                />
                <Text style={[styles.dimensionLabel, { color: appColors.textPrimary }]}>{dim.label}</Text>
              </View>
              <Text style={[styles.dimensionValue, { color: appColors.primary }]}>
                {(personality[dim.key] as number)}
              </Text>
            </View>

            <Text style={[styles.dimensionDescription, { color: appColors.textTertiary }]}>{dim.description}</Text>

            <View style={styles.sliderContainer}>
              <Text style={[styles.sliderLabel, { color: appColors.textTertiary }]}>{dim.leftLabel}</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={100}
                value={personality[dim.key] as number}
                onValueChange={(value) => handleSliderChange(dim.key, value)}
                minimumTrackTintColor={appColors.primary}
                maximumTrackTintColor={appColors.border}
                thumbTintColor={appColors.primary}
              />
              <Text style={[styles.sliderLabel, { color: appColors.textTertiary }]}>{dim.rightLabel}</Text>
            </View>

            <Text style={[styles.valueDescription, { color: appColors.textSecondary }]}>
              {getValueDescription(dim.key, personality[dim.key] as number)}
            </Text>

            {index < PERSONALITY_DIMENSIONS.length - 1 && (
              <Divider style={[styles.divider, { backgroundColor: appColors.border }]} />
            )}
          </View>
        ))}

        {/* Retake Quiz Option */}
        <View style={[styles.retakeCard, { backgroundColor: appColors.surface }]}>
          <Text style={[styles.retakeTitle, { color: appColors.textPrimary }]}>Want to start fresh?</Text>
          <Text style={[styles.retakeText, { color: appColors.textSecondary }]}>
            Retake the personality quiz for a guided experience
          </Text>
          <Button
            mode="outlined"
            icon="refresh"
            onPress={() => router.push("/(auth)/onboarding?retake=true")}
            style={[styles.retakeButton, { borderColor: appColors.primary }]}
          >
            Retake Quiz
          </Button>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Bottom Action Bar */}
      {hasChanges && (
        <View style={[styles.bottomBar, { backgroundColor: appColors.surface, borderTopColor: appColors.border }]}>
          <Button
            mode="outlined"
            onPress={handleReset}
            style={styles.resetButton}
            textColor={appColors.textPrimary}
          >
            Reset
          </Button>
          <Button
            mode="contained"
            onPress={handleSave}
            loading={saving}
            disabled={saving}
            style={styles.saveButton}
            buttonColor={appColors.primary}
            textColor="#FFFFFF"
          >
            Save Changes
          </Button>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    color: COLORS.textSecondary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.textPrimary,
  },
  headerSpacer: {
    width: 32,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
  },
  introCard: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    alignItems: "flex-start",
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  introContent: {
    flex: 1,
  },
  introTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  introText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  dimensionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 8,
  },
  dimensionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  dimensionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dimensionLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
  },
  dimensionValue: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.primary,
  },
  dimensionDescription: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginBottom: 16,
  },
  sliderContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  sliderLabel: {
    fontSize: 11,
    color: COLORS.textTertiary,
    width: 60,
    textAlign: "center",
  },
  valueDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    fontStyle: "italic",
    paddingTop: 4,
  },
  divider: {
    marginTop: 20,
    backgroundColor: COLORS.border,
  },
  peakWindowsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  peakWindowChip: {
    width: "47%",
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  peakWindowLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 2,
    color: COLORS.textPrimary,
  },
  peakWindowSub: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  retakeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    marginTop: 12,
    alignItems: "center",
  },
  retakeTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  retakeText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 16,
    textAlign: "center",
  },
  retakeButton: {
    borderColor: COLORS.primary,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    padding: 16,
    paddingBottom: 32,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: 12,
  },
  resetButton: {
    flex: 1,
  },
  saveButton: {
    flex: 2,
    backgroundColor: COLORS.primary,
  },
});
