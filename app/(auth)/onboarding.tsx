/**
 * Onboarding Screen — 12-step carousel
 *
 * Step 0:    Welcome
 * Steps 1–3: Feature showcase (AI scheduling, Calendar views, Smart states)
 * Steps 4–9: Personality questions (one per screen)
 * Step 10:   Work hours (native time picker)
 * Step 11:   Completion + confetti
 */

import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Easing,
  Platform,
} from "react-native";
import { Button, Text, ActivityIndicator, RadioButton } from "react-native-paper";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState, useEffect, useRef, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { trackOnboardingCompleted, trackOnboardingStep, trackOnboardingScreenViewed, trackOnboardingAbandoned } from "@/lib/analytics";
import { createDemoTasks } from "@/lib/tourDemo";
import { useAppColors } from "@/contexts/ThemeContext";
import { useGuidedTour } from "@/contexts/GuidedTourContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { startFreeTrial } from "@/lib/purchases";
import { requestNotificationPermissions } from "@/lib/notifications";

// ─── Feature Screens ──────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: "brain",
    headline: "It thinks so you don't have to.",
    sub: "Tell DayWise what you need to get done. It scores your available time against your energy patterns and picks the slot where you'll actually do your best work.",
    bullets: [
      { icon: "lightning-bolt", text: "Matched to your peak focus hours every time" },
      { icon: "chart-bar", text: "Explains exactly why it chose each slot" },
      { icon: "trending-up", text: "Learns your habits and improves every week" },
    ],
  },
  {
    icon: "calendar-month",
    headline: "Your whole week, at a glance.",
    sub: "Switch between day, week, and month views to see exactly where your time is going and where you have room to breathe.",
    bullets: [
      { icon: "view-list", text: "Day view: your tasks laid out hour by hour" },
      { icon: "calendar-week", text: "Week view: spot gaps and crunch days instantly" },
      { icon: "calendar-month-outline", text: "Month view: plan ahead without the guesswork" },
    ],
  },
  {
    icon: "shield-refresh",
    headline: "Life changes. Your plan keeps up.",
    sub: "Missed a slot? Behind on a deadline? DayWise handles both differently and fixes them automatically so nothing falls through the cracks.",
    bullets: [
      { icon: "calendar-sync", text: "Missed a slot? Auto-rescheduled before you even notice" },
      { icon: "alert-circle-outline", text: "Overdue pile? Clear it all in a single tap" },
      { icon: "check-circle-outline", text: "Every completion tracked. Your streak grows with you." },
    ],
  },
];

// ─── Personality Questions ─────────────────────────────────────────────────────

type Option = { label: string; value: number; description?: string };

// Peak window options (for multi-select chronotype replacement)
type PeakWindow = { start: number; end: number };
const PEAK_WINDOW_OPTIONS: { label: string; description: string; value: PeakWindow }[] = [
  { label: "Early morning", description: "6–9am", value: { start: 6, end: 9 } },
  { label: "Morning", description: "9am–12pm", value: { start: 9, end: 12 } },
  { label: "Early afternoon", description: "12–3pm", value: { start: 12, end: 15 } },
  { label: "Afternoon", description: "3–6pm", value: { start: 15, end: 18 } },
  { label: "Evening", description: "6–9pm", value: { start: 18, end: 21 } },
  { label: "Late night", description: "9pm–midnight", value: { start: 21, end: 24 } },
];

const QUESTIONS = [
  {
    key: "peak_windows",
    preamble: "Let's start with what makes you tick.",
    question: "When do you actually do your best work?",
    options: [] as Option[], // handled separately (multi-select)
  },
  {
    key: "focusDuration",
    preamble: "Think about a single stretch of work. Sitting down and going deep on one thing.",
    question: "How long before you naturally want to stop?",
    options: [
      { label: "15–25 minutes", value: 15, description: "Short, sharp bursts" },
      { label: "30–45 minutes", value: 35, description: "Pomodoro-style" },
      { label: "1–2 hours", value: 60, description: "Solid blocks of focus" },
      { label: "2–3 hours", value: 85, description: "Deep work sessions" },
      { label: "3+ hours", value: 100, description: "I can go all day" },
    ],
  },
  {
    key: "deadlineStyle",
    preamble: "No judgment here. Everyone has their thing.",
    question: "When do you honestly tend to start things?",
    options: [
      { label: "Right away", value: 10, description: "Buffer time keeps me calm" },
      { label: "Steady progress", value: 40, description: "I spread it out evenly" },
      { label: "Closer to the date", value: 70, description: "A bit of pressure helps" },
      { label: "Last minute", value: 95, description: "Deadlines are my fuel" },
    ],
  },
  {
    key: "breakFrequency",
    preamble: "Now zoom out to your whole day. Not one session, the full thing.",
    question: "How often do you need a proper step-away break?",
    options: [
      { label: "Very often", value: 10, description: "I need to reset regularly" },
      { label: "Every hour or so", value: 35, description: "A few good breaks a day" },
      { label: "A couple of times", value: 65, description: "Morning and afternoon" },
      { label: "Barely at all", value: 90, description: "I just keep going" },
    ],
  },
  {
    key: "taskSwitching",
    preamble: "Think about how you naturally move through your workload.",
    question: "Do you stay locked on one thing, or jump between several?",
    options: [
      { label: "One at a time", value: 10, description: "Finish, then move on" },
      { label: "A few related things", value: 40, description: "Rotate when stuck" },
      { label: "Mix it up often", value: 70, description: "Variety keeps me sharp" },
      { label: "Always multitasking", value: 95, description: "More going, more energy" },
    ],
  },
  {
    key: "structurePreference",
    preamble: "Last one. I promise.",
    question: "Do you like having a predictable daily routine?",
    options: [
      { label: "Yes, same pattern every day", value: 10, description: "Consistency helps me focus" },
      { label: "Mostly, with some variety", value: 35, description: "A familiar rhythm is nice" },
      { label: "Not really", value: 65, description: "Depends what each day brings" },
      { label: "No, every day is different", value: 90, description: "I adapt as things come up" },
    ],
  },
];

// ─── Confetti ─────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ["#4A90E2", "#7C6FBF", "#5FBF73", "#F5A962", "#E25555", "#F472B6"];

function Confetti() {
  const particles = useMemo(() =>
    Array.from({ length: 32 }, (_, i) => ({
      id: i,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      x: Math.random() * 360,
      size: 6 + Math.random() * 8,
      delay: i * 70,
      duration: 1200 + Math.random() * 800,
      translateY: new Animated.Value(-20),
      opacity: new Animated.Value(0),
    })), []);

  useEffect(() => {
    Animated.stagger(0, particles.map((p) =>
      Animated.sequence([
        Animated.delay(p.delay),
        Animated.parallel([
          Animated.timing(p.opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
          Animated.timing(p.translateY, { toValue: 640, duration: p.duration, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.timing(p.opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ])
    )).start();
  }, []);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {particles.map((p) => (
        <Animated.View key={p.id} style={{
          position: "absolute", left: p.x, top: 0,
          width: p.size, height: p.size, borderRadius: p.size / 2,
          backgroundColor: p.color, opacity: p.opacity,
          transform: [{ translateY: p.translateY }],
        }} />
      ))}
    </View>
  );
}

// ─── PersonalityQuestion ───────────────────────────────────────────────────────

function PersonalityQuestion({
  question, options, selected, onSelect,
}: {
  question: string; options: Option[]; selected: number | null; onSelect: (v: number) => void;
}) {
  const appColors = useAppColors();
  return (
    <View style={styles.questionContainer}>
      <Text style={[styles.questionText, { color: appColors.textPrimary }]}>{question}</Text>
      <View style={styles.optionsContainer}>
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            style={[
              styles.optionButton,
              { borderColor: appColors.border, backgroundColor: appColors.surface },
              selected === opt.value && { borderColor: appColors.primary, backgroundColor: appColors.primaryLight },
            ]}
            onPress={() => onSelect(opt.value)}
          >
            <View style={styles.optionContent}>
              <RadioButton
                value={String(opt.value)}
                status={selected === opt.value ? "checked" : "unchecked"}
                onPress={() => onSelect(opt.value)}
                color={appColors.primary}
              />
              <View style={styles.optionTextContainer}>
                <Text style={[styles.optionLabel, { color: appColors.textPrimary }, selected === opt.value && { color: appColors.primary }]}>
                  {opt.label}
                </Text>
                {opt.description && (
                  <Text style={[styles.optionDescription, { color: appColors.textSecondary }]}>{opt.description}</Text>
                )}
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ─── Peak Windows Picker ──────────────────────────────────────────────────────

function PeakWindowsPicker({
  selected, onToggle,
}: {
  selected: PeakWindow[];
  onToggle: (w: PeakWindow) => void;
}) {
  const appColors = useAppColors();
  const isSelected = (w: PeakWindow) => selected.some((s) => s.start === w.start);

  return (
    <View style={styles.questionContainer}>
      <Text style={[styles.questionText, { color: appColors.textPrimary }]}>
        When do you feel most energised and focused?
      </Text>
      <Text style={[{ color: appColors.textSecondary, fontSize: 13, marginBottom: 16 }]}>
        Pick 1 or 2 that feel right
      </Text>
      <View style={styles.peakWindowsGrid}>
        {PEAK_WINDOW_OPTIONS.map((opt) => {
          const active = isSelected(opt.value);
          const atMax = selected.length >= 2 && !active;
          return (
            <Pressable
              key={opt.value.start}
              style={[
                styles.peakWindowChip,
                { borderColor: appColors.border, backgroundColor: appColors.surface },
                active && { borderColor: appColors.primary, backgroundColor: appColors.primaryLight },
                atMax && { opacity: 0.45 },
              ]}
              onPress={() => !atMax && onToggle(opt.value)}
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
  );
}

// ─── TimePicker row ───────────────────────────────────────────────────────────

function TimePickerRow({
  label, value, onChange,
}: {
  label: string; value: Date; onChange: (d: Date) => void;
}) {
  const appColors = useAppColors();
  const [showPicker, setShowPicker] = useState(Platform.OS === "ios");

  const formatted = value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={[styles.timeCard, { backgroundColor: appColors.primaryLight, borderColor: `${appColors.primary}30` }]}>
      <Text style={[styles.timeLabel, { color: appColors.textSecondary }]}>{label}</Text>

      {Platform.OS === "android" && (
        <Pressable
          onPress={() => setShowPicker(true)}
          style={[styles.timeDisplayBtn, { backgroundColor: appColors.surface, borderColor: appColors.border }]}
        >
          <Text style={[styles.timeDisplayText, { color: appColors.primary }]}>{formatted}</Text>
          <Text style={[styles.timeEditHint, { color: appColors.textTertiary }]}>tap to change</Text>
        </Pressable>
      )}

      {(Platform.OS === "ios" || showPicker) && (
        <DateTimePicker
          mode="time"
          value={value}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_, selected) => {
            setShowPicker(false);
            if (selected) onChange(selected);
          }}
          style={Platform.OS === "ios" ? styles.iosTimePicker : undefined}
          textColor={appColors.textPrimary}
        />
      )}
    </View>
  );
}

// ─── Shared Progress Header ───────────────────────────────────────────────────

function ProgressHeader({
  label, fillPercent, onBack, appColors,
}: {
  label: string; fillPercent: number; onBack: () => void; appColors: any;
}) {
  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressRow}>
        <Pressable onPress={onBack} style={styles.backArrow} hitSlop={8}>
          <Text style={[styles.backArrowText, { color: appColors.textSecondary }]}>←</Text>
        </Pressable>
        <View style={styles.progressBarWrapper}>
          <View style={[styles.progressBarTrack, { backgroundColor: appColors.border }]}>
            <View style={[styles.progressBarFill, { width: `${fillPercent}%`, backgroundColor: appColors.primary }]} />
          </View>
          <Text style={[styles.progressLabel, { color: appColors.textSecondary }]}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Hero Icon ────────────────────────────────────────────────────────────────

function HeroIcon({ name, appColors }: { name: string; appColors: any }) {
  return (
    <MaterialCommunityIcons
      name={name as any}
      size={52}
      color={appColors.primary}
      style={styles.heroIcon}
    />
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

// Step map:
//  0         = Welcome
//  1–3       = Feature screens (FEATURES[step - 1])
//  4–9       = Questions (QUESTIONS[step - 4])
//  10        = Work hours
//  11        = Completion

const TOTAL_STEPS = 12;
const QUESTION_START = 4;
const WORK_HOURS_STEP = 10;
const COMPLETION_STEP = 11;

export default function OnboardingScreen() {
  const appColors = useAppColors();
  const { advanceTour, skipTour } = useGuidedTour();
  const { refresh: refreshSubscription } = useSubscription();
  const { retake } = useLocalSearchParams<{ retake?: string }>();
  const isRetake = retake === "true";
  const [currentStep, setCurrentStep] = useState(isRetake ? QUESTION_START : 0);

  // Personality answers
  const [answers, setAnswers] = useState<Record<string, number | null>>({
    focusDuration: null, deadlineStyle: null,
    breakFrequency: null, taskSwitching: null, structurePreference: null,
  });
  // Peak windows (multi-select, replaces chronotype)
  const [peakWindows, setPeakWindows] = useState<PeakWindow[]>([]);

  // Work hours as Date objects (time only)
  const [workStart, setWorkStart] = useState(() => {
    const d = new Date(); d.setHours(9, 0, 0, 0); return d;
  });
  const [workEnd, setWorkEnd] = useState(() => {
    const d = new Date(); d.setHours(18, 0, 0, 0); return d;
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track screen views for analytics
  useEffect(() => {
    const names: Record<number, string> = {
      0: "welcome",
      1: "feature_ai",
      2: "feature_calendar",
      3: "feature_recovery",
      10: "work_hours",
      11: "completion",
    };
    const name = names[currentStep] ?? `question_${currentStep - QUESTION_START}`;
    trackOnboardingScreenViewed(currentStep, name).catch(() => {});
  }, [currentStep]);

  // Slide animation
  const slideAnim = useRef(new Animated.Value(0)).current;
  const prevStep = useRef(0);

  const animateToStep = (next: number) => {
    const dir = next > prevStep.current ? 1 : -1;
    slideAnim.setValue(dir * 320);
    prevStep.current = next;
    setCurrentStep(next);
    Animated.timing(slideAnim, {
      toValue: 0, duration: 280,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  };

  const goNext = () => animateToStep(currentStep + 1);
  const goBack = () => {
    if (isRetake && currentStep === QUESTION_START) {
      router.back();
    } else if (currentStep === 0) {
      const names: Record<number, string> = { 0: 'welcome', 1: 'feature_ai', 2: 'feature_calendar', 3: 'feature_recovery', 10: 'work_hours', 11: 'completion' };
      const name = names[currentStep] ?? `question_${currentStep - QUESTION_START}`;
      trackOnboardingAbandoned(currentStep, name).catch(() => {});
      router.back();
    } else {
      animateToStep(currentStep - 1);
    }
  };

  // ── Derived state ──

  const isFeatureStep = currentStep >= 1 && currentStep <= 3;
  const isQuestionStep = currentStep >= QUESTION_START && currentStep < WORK_HOURS_STEP;
  const questionIndex = currentStep - QUESTION_START;   // 0–5
  const currentQ = isQuestionStep ? QUESTIONS[questionIndex] : null;
  const currentAnswer = currentQ ? answers[currentQ.key] : null;
  const isPeakWindowsStep = currentQ?.key === "peak_windows";
  const canProceed = isPeakWindowsStep ? peakWindows.length > 0 : currentAnswer !== null;

  const handleQuestionNext = () => {
    if (!currentQ) return;
    const answerValue = currentQ.key === 'peak_windows'
      ? peakWindows.join(',')
      : String(answers[currentQ.key] ?? '');
    trackOnboardingStep(currentStep, currentQ.key, answerValue).catch(() => {});
    goNext();
  };

  // Progress bar fill for question steps: 0–100% across 6 questions
  const questionFill = isQuestionStep ? ((questionIndex + 1) / QUESTIONS.length) * 100 : 100;

  // ── Save & complete ──

  const handleComplete = async () => {
    try {
      setLoading(true);
      setError(null);

      const pad = (n: number) => n.toString().padStart(2, "0");
      const startStr = `${pad(workStart.getHours())}:${pad(workStart.getMinutes())}`;
      const endStr   = `${pad(workEnd.getHours())}:${pad(workEnd.getMinutes())}`;
      const preferredWindows = [1, 2, 3, 4, 5].map((day) => ({ day, start: startStr, end: endStr }));

      // Derive chronotype from peak_windows for backward compat
      const derivedChronotype =
        peakWindows.length === 0 ? 50 :
        peakWindows.every((w) => w.end <= 12) ? 80 :   // all windows before noon → early bird
        peakWindows.every((w) => w.start >= 15) ? 20 : // all windows 3pm+ → night owl
        50;                                              // mixed → neutral

      const personalityData = {
        chronotype:           derivedChronotype,
        focus_duration:       answers.focusDuration       ?? 50,
        deadline_style:       answers.deadlineStyle       ?? 50,
        break_frequency:      answers.breakFrequency      ?? 50,
        task_switching:       answers.taskSwitching       ?? 50,
        structure_preference: answers.structurePreference ?? 50,
        peak_windows:         peakWindows.length > 0 ? peakWindows : undefined,
        preferred_windows: preferredWindows,
        additional_context: null,
      };

      const { data: { user } } = await supabase.auth.getUser();
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({ personality_data: personalityData })
        .eq("id", user?.id);

      if (updateError) throw updateError;
      if (isRetake) {
        router.back();
        return;
      }
      await trackOnboardingCompleted();
      router.replace("/(auth)/first-task");
    } catch (err) {
      console.error("[Onboarding Error]", err);
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  };

  const [trialStarting, setTrialStarting] = useState(false);
  const [trialStarted, setTrialStarted] = useState(false);

  const handleStartTrial = async () => {
    setTrialStarting(true);
    try {
      const result = await startFreeTrial();
      if (result.success) {
        await refreshSubscription(); // so home screen sees isTrialing=true immediately
        setTrialStarted(true);
      }
    } catch {
      // Still show choice screen — trial may have worked
      await refreshSubscription();
      setTrialStarted(true);
    } finally {
      setTrialStarting(false);
    }
  };

  const [choosingTour, setChoosingTour] = useState(false);
  const [choosingExplore, setChoosingExplore] = useState(false);

  const handleChooseTour = async () => {
    setChoosingTour(true);
    await requestNotificationPermissions();
    await advanceTour("tour_welcome");
    await createDemoTasks();
    router.replace("/(tabs)/home");
  };

  const handleChooseExplore = async () => {
    setChoosingExplore(true);
    await requestNotificationPermissions();
    await skipTour();
    router.replace("/(tabs)/home");
  };

  const handleSkipTrial = async () => {
    await requestNotificationPermissions();
    await skipTour();
    router.replace("/(tabs)/home");
  };

  // ── Renders ──

  // ── Step 0: Welcome ──────────────────────────────────────────────────────────
  if (currentStep === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.surface }]}>
        <ScrollView contentContainerStyle={styles.welcomeContent} showsVerticalScrollIndicator={false}>
          <View style={styles.welcomeHero}>
            <HeroIcon name="calendar-clock" appColors={appColors} />
            <Text style={[styles.welcomeHeadline, { color: appColors.textPrimary }]}>
              Your work,{"\n"}finally in order.
            </Text>
            <Text style={[styles.welcomeSub, { color: appColors.textSecondary }]}>
              Most people lose hours every week just deciding when to do things. DayWise plans it for you. In seconds.
            </Text>
          </View>

          <View style={[styles.bulletCard, { backgroundColor: appColors.primaryLight, borderColor: `${appColors.primary}20` }]}>
            {[
              { icon: "brain", text: "Learns when you focus best, automatically" },
              { icon: "clock-fast", text: "Picks the right time so you don't have to" },
              { icon: "calendar-refresh", text: "Reschedules missed tasks without you lifting a finger" },
              { icon: "trending-up", text: "Gets sharper every week you use it" },
            ].map((b) => (
              <View key={b.text} style={styles.bulletRow}>
                <MaterialCommunityIcons name={b.icon as any} size={20} color={appColors.primary} style={styles.bulletIconView} />
                <Text style={[styles.bulletText, { color: appColors.textPrimary }]}>{b.text}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: appColors.border }]}>
          <Button mode="contained" onPress={goNext} style={styles.ctaButton} contentStyle={styles.ctaContent} labelStyle={styles.ctaLabel}>
            Show me how it works →
          </Button>
          <Text style={[styles.footerHint, { color: appColors.textTertiary }]}>Takes 2 minutes to set up</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Steps 1–3: Feature screens ───────────────────────────────────────────────
  if (isFeatureStep) {
    const feature = FEATURES[currentStep - 1];
    const dotFill = `${(currentStep / 3) * 100}%`;

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.surface }]}>
        {/* Dot progress */}
        <View style={styles.dotRow}>
          {FEATURES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i < currentStep ? appColors.primary : appColors.border },
              ]}
            />
          ))}
        </View>

        <Animated.View style={[styles.flex, { transform: [{ translateX: slideAnim }] }]}>
          <ScrollView contentContainerStyle={styles.featureContent} showsVerticalScrollIndicator={false}>
            <HeroIcon name={feature.icon} appColors={appColors} />
            <Text style={[styles.featureHeadline, { color: appColors.textPrimary }]}>{feature.headline}</Text>
            <Text style={[styles.featureSub, { color: appColors.textSecondary }]}>{feature.sub}</Text>

            <View style={[styles.featureBulletCard, { backgroundColor: appColors.primaryLight, borderColor: `${appColors.primary}25` }]}>
              {feature.bullets.map((b) => (
                <View key={b.text} style={styles.bulletRow}>
                  <MaterialCommunityIcons name={b.icon as any} size={20} color={appColors.primary} style={styles.bulletIconView} />
                  <Text style={[styles.bulletText, { color: appColors.textPrimary }]}>{b.text}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: appColors.border }]}>
            <View style={styles.footerRow}>
              <Pressable onPress={goBack} style={styles.ghostBack} hitSlop={8}>
                <MaterialCommunityIcons name="arrow-left" size={24} color={appColors.textSecondary} />
              </Pressable>
              <Button
                mode="contained"
                onPress={goNext}
                style={[styles.ctaButton, { flex: 1 }]}
                contentStyle={styles.ctaContent}
                labelStyle={styles.ctaLabel}
              >
                {currentStep === 3 ? "Make it mine →" : "Next →"}
              </Button>
              {currentStep < 3 && (
                <Pressable onPress={() => animateToStep(QUESTION_START)} style={styles.skipBtn} hitSlop={8}>
                  <Text style={[styles.skipText, { color: appColors.textTertiary }]}>Skip</Text>
                </Pressable>
              )}
            </View>
          </View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // ── Steps 4–9: Personality questions ────────────────────────────────────────
  if (isQuestionStep && currentQ) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.surface }]}>
        <ProgressHeader
          label={`Question ${questionIndex + 1} of ${QUESTIONS.length}`}
          fillPercent={questionFill}
          onBack={goBack}
          appColors={appColors}
        />

        <Animated.View style={[styles.flex, { transform: [{ translateX: slideAnim }] }]}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={[styles.preamble, { color: appColors.textSecondary }]}>{currentQ.preamble}</Text>
            {isPeakWindowsStep ? (
              <PeakWindowsPicker
                selected={peakWindows}
                onToggle={(w) => {
                  setPeakWindows((prev) =>
                    prev.some((s) => s.start === w.start)
                      ? prev.filter((s) => s.start !== w.start)
                      : [...prev, w],
                  );
                }}
              />
            ) : (
              <PersonalityQuestion
                question={currentQ.question}
                options={currentQ.options}
                selected={answers[currentQ.key]}
                onSelect={(val) => setAnswers((prev) => ({ ...prev, [currentQ.key]: val }))}
              />
            )}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: appColors.border }]}>
            <Button
              mode="contained"
              onPress={handleQuestionNext}
              style={styles.ctaButton}
              contentStyle={styles.ctaContent}
              disabled={!canProceed}
            >
              Next
            </Button>
          </View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // ── Step 10: Work hours ──────────────────────────────────────────────────────
  if (currentStep === WORK_HOURS_STEP) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.surface }]}>
        <ProgressHeader
          label="Almost done!"
          fillPercent={100}
          onBack={goBack}
          appColors={appColors}
        />

        <Animated.View style={[styles.flex, { transform: [{ translateX: slideAnim }] }]}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={[styles.questionText, { color: appColors.textPrimary, marginBottom: 8 }]}>
              When does your day start and end?
            </Text>
            <Text style={[styles.preamble, { color: appColors.textSecondary, marginBottom: 28 }]}>
              I'll keep everything inside these hours. You can shift them anytime in Settings.
            </Text>

            <TimePickerRow label="Work starts" value={workStart} onChange={setWorkStart} />
            <View style={{ height: 16 }} />
            <TimePickerRow label="Work ends" value={workEnd} onChange={setWorkEnd} />
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: appColors.border }]}>
            {error && <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>}
            <Button
              mode="contained"
              onPress={handleComplete}
              style={styles.ctaButton}
              contentStyle={styles.ctaContent}
              labelStyle={styles.ctaLabel}
              loading={loading}
              disabled={loading}
            >
              Finish Setup →
            </Button>
          </View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // ── Step 11: Trial opt-in / choice (DISABLED — new flow routes to first-task screen) ──
  // Phase 2: Trial started — choose experience
  if (false && trialStarted) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.surface }]}>
        <Confetti />
        <ScrollView contentContainerStyle={{ padding: 28, paddingTop: 48, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <View style={{ alignItems: "center", marginBottom: 32 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🎉</Text>
            <Text style={[styles.completionHeadline, { color: appColors.textPrimary, textAlign: "center" }]}>
              Your Pro trial is active
            </Text>
            <Text style={[styles.completionSub, { color: appColors.textSecondary, textAlign: "center" }]}>
              7 days of everything, free. How would you like to get started?
            </Text>
          </View>

          {/* Option A: Tour */}
          <Pressable
            onPress={handleChooseTour}
            disabled={choosingTour || choosingExplore}
            style={[{
              borderRadius: 16, padding: 20, marginBottom: 12,
              borderWidth: 2, borderColor: appColors.primary,
              backgroundColor: appColors.primaryLight,
            }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
              {choosingTour
                ? <ActivityIndicator size={20} color={appColors.primary} />
                : <MaterialCommunityIcons name="map-marker-path" size={24} color={appColors.primary} />}
              <Text style={{ fontSize: 17, fontWeight: "700", color: appColors.primary }}>Show me around</Text>
            </View>
            <Text style={{ fontSize: 14, color: appColors.textSecondary, lineHeight: 20 }}>
              A quick guided walkthrough. I'll create some tasks and show you exactly how AI and manual scheduling work together.
            </Text>
          </Pressable>

          {/* Option B: Feature list */}
          <Pressable
            onPress={handleChooseExplore}
            disabled={choosingTour || choosingExplore}
            style={[{
              borderRadius: 16, padding: 20, marginBottom: 32,
              borderWidth: 1, borderColor: appColors.border,
              backgroundColor: appColors.surface,
            }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 }}>
              {choosingExplore
                ? <ActivityIndicator size={20} color={appColors.textPrimary} />
                : <MaterialCommunityIcons name="rocket-launch-outline" size={24} color={appColors.textPrimary} />}
              <Text style={{ fontSize: 17, fontWeight: "700", color: appColors.textPrimary }}>I'll explore myself</Text>
            </View>
            <Text style={{ fontSize: 14, color: appColors.textSecondary, lineHeight: 20 }}>
              Jump straight in. Here's what you have access to for the next 7 days:
            </Text>
            <View style={{ marginTop: 12, gap: 8 }}>
              {[
                { icon: "brain", text: "AI scheduling — finds your best time automatically" },
                { icon: "calendar-refresh", text: "Auto-reschedule — missed slots handled for you" },
                { icon: "chart-line", text: "Advanced analytics — see your productivity patterns" },
                { icon: "google", text: "Google Calendar sync — coming soon" },
              ].map((f) => (
                <View key={f.text} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <MaterialCommunityIcons name={f.icon as any} size={18} color={appColors.secondary} />
                  <Text style={{ fontSize: 13, color: appColors.textSecondary, flex: 1 }}>{f.text}</Text>
                </View>
              ))}
            </View>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Phase 1: Trial pitch (DISABLED — handled by TrialBottomSheet post-tooltips)
  if (false) return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.surface }]}>
      <ScrollView contentContainerStyle={{ padding: 28, paddingTop: 48, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: "center", marginBottom: 32 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 40, marginBottom: 20,
            backgroundColor: `${appColors.primary}15`,
            alignItems: "center", justifyContent: "center",
          }}>
            <MaterialCommunityIcons name="star-circle-outline" size={44} color={appColors.primary} />
          </View>
          <Text style={[styles.completionHeadline, { color: appColors.textPrimary, textAlign: "center" }]}>
            Try Pro free for 7 days
          </Text>
          <View style={{
            flexDirection: "row", alignItems: "center", gap: 6,
            marginTop: 10, backgroundColor: appColors.successLight,
            paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
          }}>
            <MaterialCommunityIcons name="shield-check-outline" size={16} color={appColors.success} />
            <Text style={{ fontSize: 13, fontWeight: "600", color: appColors.success }}>
              No credit card required
            </Text>
          </View>
        </View>

        <View style={{ gap: 12, marginBottom: 32 }}>
          {[
            { icon: "brain", label: "AI Scheduling", desc: "Finds your perfect time slot automatically" },
            { icon: "calendar-refresh", label: "Auto-Reschedule", desc: "Missed tasks moved for you without lifting a finger" },
            { icon: "chart-line", label: "Advanced Analytics", desc: "See exactly when and how you work best" },
            { icon: "google", label: "Google Calendar Sync", desc: "Coming soon" },
          ].map((f) => (
            <View key={f.label} style={{
              flexDirection: "row", alignItems: "center", gap: 14,
              backgroundColor: appColors.inputBg, borderRadius: 12, padding: 14,
            }}>
              <View style={{
                width: 40, height: 40, borderRadius: 12,
                backgroundColor: `${appColors.primary}15`,
                alignItems: "center", justifyContent: "center",
              }}>
                <MaterialCommunityIcons name={f.icon as any} size={22} color={appColors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: appColors.textPrimary }}>{f.label}</Text>
                <Text style={{ fontSize: 12, color: appColors.textTertiary, marginTop: 1 }}>{f.desc}</Text>
              </View>
              <MaterialCommunityIcons name="check-circle" size={20} color={appColors.success} />
            </View>
          ))}
        </View>

        <Button
          mode="contained"
          onPress={handleStartTrial}
          loading={trialStarting}
          disabled={trialStarting}
          style={[styles.ctaButton, { alignSelf: "stretch" }]}
          contentStyle={styles.ctaContent}
          labelStyle={styles.ctaLabel}
        >
          Start My Free Trial
        </Button>

        <Pressable onPress={handleSkipTrial} style={{ alignItems: "center", marginTop: 16, paddingVertical: 8 }}>
          <Text style={{ fontSize: 14, color: appColors.textTertiary }}>Skip for now — use the free version</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );

  return null;
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },

  // Welcome
  welcomeContent: {
    padding: 28,
    paddingTop: 24,
    paddingBottom: 16,
  },
  heroIcon: {
    marginBottom: 20,
  },
  welcomeHero: {
    alignItems: "center",
    marginBottom: 32,
  },
  welcomeHeadline: {
    fontSize: 34,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 42,
    marginBottom: 12,
  },
  welcomeSub: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: 4,
  },

  // Shared bullets
  bulletCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bulletIconView: {
    width: 28,
    textAlign: "center",
  },
  bulletText: {
    fontSize: 14,
    fontWeight: "500",
    flex: 1,
    lineHeight: 20,
  },

  // Feature screens
  dotRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingTop: 16,
    paddingBottom: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  featureContent: {
    padding: 28,
    paddingTop: 12,
    alignItems: "center",
  },
  featureHeadline: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 36,
    marginBottom: 12,
    marginTop: 16,
  },
  featureSub: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 23,
    marginBottom: 28,
  },
  featureBulletCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 14,
    alignSelf: "stretch",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  ghostBack: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skipBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  skipText: {
    fontSize: 14,
    fontWeight: "500",
  },
  footerHint: {
    textAlign: "center",
    fontSize: 12,
    marginTop: 8,
  },

  // Progress bar
  progressContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backArrow: { padding: 4 },
  backArrowText: { fontSize: 22 },
  progressBarWrapper: { flex: 1 },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    marginBottom: 6,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 12,
    textAlign: "right",
  },

  // Questions
  scrollContent: {
    padding: 24,
    paddingTop: 12,
  },
  preamble: {
    fontSize: 14,
    fontStyle: "italic",
    marginBottom: 16,
    lineHeight: 20,
  },
  questionContainer: { marginBottom: 16 },
  questionText: {
    fontWeight: "600",
    fontSize: 20,
    lineHeight: 28,
    marginBottom: 20,
  },
  optionsContainer: { gap: 12 },
  optionButton: {
    borderWidth: 2,
    borderRadius: 14,
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  optionTextContainer: {
    flex: 1,
    marginLeft: 4,
  },
  optionLabel: { fontWeight: "500" },
  optionDescription: { marginTop: 2 },

  // Peak windows
  peakWindowsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  peakWindowChip: {
    width: "47%",
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  peakWindowLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  peakWindowSub: {
    fontSize: 12,
  },

  // Work hours / time picker
  timeCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 0 : 16,
  },
  timeLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  timeDisplayBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  timeDisplayText: {
    fontSize: 22,
    fontWeight: "700",
  },
  timeEditHint: {
    fontSize: 11,
    marginTop: 2,
  },
  iosTimePicker: {
    width: "100%",
  },

  // Footer
  footer: {
    padding: 24,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  ctaButton: { borderRadius: 14 },
  ctaContent: { paddingVertical: 8 },
  ctaLabel: { fontSize: 16, fontWeight: "700" },
  errorText: {
    textAlign: "center",
    marginBottom: 12,
    fontSize: 14,
  },

  // Completion
  completionContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  completionHeadline: {
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 12,
  },
  completionSub: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
  },
});
