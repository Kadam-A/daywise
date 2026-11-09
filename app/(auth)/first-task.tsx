import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Platform,
} from "react-native";
import { Button, Text, ActivityIndicator } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useState, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { format } from "date-fns";
import { supabase } from "@/lib/supabase";
import { scheduleTask, saveScheduledSlot } from "@/lib/scheduling";
import { scheduleDay2ReEngagement, scheduleDailyNudge } from "@/lib/notifications";
import { trackEvent } from "@/lib/analytics";
import { useAppColors } from "@/contexts/ThemeContext";
import { Task } from "@/lib/types";

const DURATIONS = [30, 60, 90, 120];

export default function FirstTaskScreen() {
  const appColors = useAppColors();
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(60);
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [phase, setPhase] = useState<"input" | "loading" | "success" | "error">("input");
  const [scheduledSlot, setScheduledSlot] = useState<{ start: string; end: string } | null>(null);
  const titleRef = useRef<TextInput>(null);

  useEffect(() => {
    trackEvent("first_task_screen_viewed");
    setTimeout(() => titleRef.current?.focus(), 300);
  }, []);

  const handleSchedule = async () => {
    if (!title.trim()) return;
    setPhase("loading");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user");

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (!profile) throw new Error("No profile");

      const { data: existingTasks } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .neq("status", "completed");

      // Insert the new task first so we have an ID
      const { data: newTask, error: insertError } = await supabase
        .from("tasks")
        .insert({
          user_id: user.id,
          title: title.trim(),
          estimated_duration: duration,
          priority: "medium",
          status: "pending",
          due_date: dueDate ? format(dueDate, "yyyy-MM-dd") : null,
          scheduling_method: "SMART",
        })
        .select()
        .single();

      if (insertError || !newTask) throw insertError ?? new Error("Insert failed");

      const result = await scheduleTask({
        task: newTask as Task,
        userProfile: profile,
        existingEvents: [],
        existingTasks: (existingTasks ?? []) as Task[],
        lookAheadDays: 14,
      });

      if (result.slots.length === 0) throw new Error("No slots found");

      const topSlot = result.slots[0];
      const saved = await saveScheduledSlot(newTask as Task, topSlot);
      if (!saved) throw new Error("Save failed");

      await trackEvent("first_task_scheduled", { source: "first_task_screen" });
      setScheduledSlot({ start: topSlot.start, end: topSlot.end });
      setPhase("success");
    } catch (err) {
      console.error("[FirstTask] scheduling error:", err);
      setPhase("error");
    }
  };

  const handleContinue = async () => {
    await AsyncStorage.setItem("showPostOnboardingTooltips", "true");
    await scheduleDay2ReEngagement();
    await scheduleDailyNudge();
    router.replace("/(tabs)/home");
  };

  const handleSkipToHome = () => {
    router.replace("/(tabs)/home");
  };

  const formatSlotLabel = () => {
    if (!scheduledSlot) return "";
    const start = new Date(scheduledSlot.start);
    return format(start, "EEEE 'at' h:mm a");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.surface }]}>
      {phase === "loading" ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={appColors.primary} />
          <Text style={[styles.loadingText, { color: appColors.textSecondary }]}>
            Finding your best time…
          </Text>
        </View>
      ) : phase === "success" ? (
        <View style={styles.successCenter}>
          <View style={[styles.successIcon, { backgroundColor: appColors.successLight }]}>
            <MaterialCommunityIcons name="check-circle-outline" size={52} color={appColors.success} />
          </View>
          <Text style={[styles.successHeadline, { color: appColors.textPrimary }]}>
            Scheduled for {formatSlotLabel()}
          </Text>
          <Text style={[styles.successSub, { color: appColors.textSecondary }]}>
            DayWise picked the best slot based on your focus patterns.
          </Text>
          <Button
            mode="contained"
            onPress={handleContinue}
            style={[styles.ctaButton, { backgroundColor: appColors.primary }]}
            contentStyle={styles.ctaContent}
            labelStyle={styles.ctaLabel}
          >
            Let's see what DayWise can do →
          </Button>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={[styles.headline, { color: appColors.textPrimary }]}>
              Let's schedule your first task
            </Text>
            <Text style={[styles.sub, { color: appColors.textSecondary }]}>
              Give DayWise something real to work with.
            </Text>
          </View>

          <View style={[styles.inputWrapper, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]}>
            <TextInput
              ref={titleRef}
              value={title}
              onChangeText={setTitle}
              placeholder="What do you need to get done?"
              placeholderTextColor={appColors.textTertiary}
              style={[styles.titleInput, { color: appColors.textPrimary }]}
              returnKeyType="done"
              autoCapitalize="sentences"
              multiline={false}
            />
          </View>

          {phase === "error" && (
            <View style={[styles.errorBox, { backgroundColor: `${appColors.error}15`, borderColor: `${appColors.error}40` }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color={appColors.error} />
              <Text style={[styles.errorText, { color: appColors.error }]}>
                Couldn't find a slot right now. You can schedule manually from the home screen.
              </Text>
            </View>
          )}

          <Text style={[styles.sectionLabel, { color: appColors.textSecondary }]}>How long will it take?</Text>
          <View style={styles.durationRow}>
            {DURATIONS.map((d) => (
              <Pressable
                key={d}
                onPress={() => setDuration(d)}
                style={[
                  styles.durationChip,
                  {
                    backgroundColor: duration === d ? appColors.primary : appColors.inputBg,
                    borderColor: duration === d ? appColors.primary : appColors.border,
                  },
                ]}
              >
                <Text style={[styles.durationChipText, { color: duration === d ? "#FFFFFF" : appColors.textSecondary }]}>
                  {d < 60 ? `${d}m` : `${d / 60}h`}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: appColors.textSecondary }]}>Due date (optional)</Text>
          <Pressable
            onPress={() => setShowDatePicker(true)}
            style={[styles.dateButton, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]}
          >
            <MaterialCommunityIcons name="calendar-outline" size={18} color={appColors.textTertiary} />
            <Text style={[styles.dateButtonText, { color: dueDate ? appColors.textPrimary : appColors.textTertiary }]}>
              {dueDate ? format(dueDate, "EEE, MMM d") : "No due date"}
            </Text>
            {dueDate && (
              <Pressable onPress={() => setDueDate(null)} hitSlop={8}>
                <MaterialCommunityIcons name="close-circle" size={16} color={appColors.textTertiary} />
              </Pressable>
            )}
          </Pressable>

          {showDatePicker && (
            <DateTimePicker
              value={dueDate ?? new Date()}
              mode="date"
              minimumDate={new Date()}
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(_, date) => {
                setShowDatePicker(false);
                if (date) setDueDate(date);
              }}
            />
          )}

          {title.trim().length > 0 && (
            <Button
              mode="contained"
              onPress={handleSchedule}
              style={[styles.ctaButton, { backgroundColor: appColors.primary, marginTop: 8 }]}
              contentStyle={styles.ctaContent}
              labelStyle={styles.ctaLabel}
            >
              Schedule It →
            </Button>
          )}

          {phase === "error" && (
            <Pressable onPress={handleSkipToHome} style={styles.skipLink}>
              <Text style={[styles.skipText, { color: appColors.textTertiary }]}>Try manually →</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: 28,
    paddingTop: 48,
    flexGrow: 1,
  },
  header: {
    marginBottom: 32,
  },
  headline: {
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
    marginBottom: 8,
  },
  sub: {
    fontSize: 16,
    lineHeight: 22,
  },
  inputWrapper: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 28,
  },
  titleInput: {
    fontSize: 17,
    lineHeight: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  durationRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 28,
  },
  durationChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 10,
    alignItems: "center",
  },
  durationChipText: {
    fontSize: 14,
    fontWeight: "600",
  },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 32,
  },
  dateButtonText: {
    flex: 1,
    fontSize: 15,
  },
  ctaButton: {
    borderRadius: 14,
  },
  ctaContent: {
    height: 52,
  },
  ctaLabel: {
    fontSize: 16,
    fontWeight: "700",
  },
  skipLink: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 8,
  },
  skipText: {
    fontSize: 14,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 20,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  loadingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
  },
  successCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successHeadline: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 30,
  },
  successSub: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
});
