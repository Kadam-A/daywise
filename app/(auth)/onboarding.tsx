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
import { supabase } from "@/lib/supabase";
import { trackOnboardingCompleted, trackOnboardingStep } from "@/lib/analytics";
import { useAppColors } from "@/contexts/ThemeContext";
import { useGuidedTour } from "@/contexts/GuidedTourContext";

// ─── Feature Screens ──────────────────────────────────────────────────────────

const FEATURES = [
  {
    emoji: "🤖",
    headline: "AI finds your perfect time",
    sub: "Tell DayWise what you need to do — it scores dozens of time slots against your energy patterns and recommends the best one with a clear explanation.",
    bullets: [
      { icon: "⚡", text: "Matches every task to your peak focus hours" },
      { icon: "📊", text: "Scores each slot with a personalised reason" },
      { icon: "🔄", text: "Improves as it learns your habits over time" },
    ],
  },
  {
    emoji: "🗓️",
    headline: "See your day, week, or month",
    sub: "Switch between three views to get the exact level of detail you need — from a tight daily timeline to a big-picture monthly overview.",
    bullets: [
      { icon: "📋", text: "Day view — hour-by-hour timeline of your tasks" },
      { icon: "📆", text: "Week view — spot gaps and busy days at a glance" },
      { icon: "🗓️", text: "Month view — plan ahead and see the full picture" },
    ],
  },
  {
    emoji: "⚡",
    headline: "Smart recovery when life happens",
    sub: "DayWise knows the difference between missing a time slot and missing a deadline — and handles each one differently.",
    bullets: [
      { icon: "🔁", text: "Missed your slot but due date is fine? AI auto-reschedules it to your next free time — no action needed" },
      { icon: "🚨", text: "Past the due date? Bulk-reschedule all overdue tasks in one tap and the AI finds new times for all of them" },
      { icon: "✅", text: "Completed tasks track your streak and progress over time" },
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
    preamble: "First, let me learn your natural energy rhythms.",
    question: "When do you feel most energised and focused?",
    options: [] as Option[], // handled separately (multi-select)
  },
  {
    key: "focusDuration",
    preamble: "I'll use this to size your work blocks perfectly.",
    question: "How long can you focus before needing a break?",
    options: [
      { label: "15–25 minutes", value: 15, description: "Short focused bursts" },
      { label: "30–45 minutes", value: 35, description: "Pomodoro-style sessions" },
      { label: "1–2 hours", value: 60, description: "Solid work blocks" },
      { label: "2–3 hours", value: 85, description: "Deep focus sessions" },
      { label: "3+ hours", value: 100, description: "Extended deep work" },
    ],
  },
  {
    key: "deadlineStyle",
    preamble: "This helps me know how much buffer time you need.",
    question: "How do you work best with deadlines?",
    options: [
      { label: "Start immediately", value: 10, description: "I like having buffer time" },
      { label: "Steady progress", value: 40, description: "Spread work evenly" },
      { label: "Closer to deadline", value: 70, description: "Some pressure helps" },
      { label: "Right before deadline", value: 95, description: "I thrive under pressure" },
    ],
  },
  {
    key: "breakFrequency",
    preamble: "I'll plan rest between sessions automatically.",
    question: "How often do you need breaks?",
    options: [
      { label: "Every 15–20 minutes", value: 10, description: "Frequent short breaks" },
      { label: "Every 30–45 minutes", value: 35, description: "Regular breaks" },
      { label: "Every 1–2 hours", value: 65, description: "Occasional breaks" },
      { label: "Every 2–3+ hours", value: 90, description: "Minimal breaks needed" },
    ],
  },
  {
    key: "taskSwitching",
    preamble: "I'll avoid splitting related work across separate times.",
    question: "How do you prefer to work on tasks?",
    options: [
      { label: "One task until done", value: 10, description: "Single-minded focus" },
      { label: "A few related tasks", value: 40, description: "Some variety is good" },
      { label: "Mix of different tasks", value: 70, description: "Variety keeps me engaged" },
      { label: "Frequently switch", value: 95, description: "I like juggling multiple things" },
    ],
  },
  {
    key: "structurePreference",
    preamble: "Last one! I'll build a schedule style that feels natural.",
    question: "How structured do you like your schedule?",
    options: [
      { label: "Very structured", value: 10, description: "Exact times for everything" },
      { label: "Mostly structured", value: 35, description: "Planned with some flex" },
      { label: "Somewhat flexible", value: 65, description: "General plan, adapt as needed" },
      { label: "Very flexible", value: 90, description: "Go with the flow" },
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
        Select 1 or 2 windows
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
  const { advanceTour } = useGuidedTour();
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
    trackOnboardingStep(currentStep, currentQ.key).catch(() => {});
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
      goNext();
    } catch (err) {
      console.error("[Onboarding Error]", err);
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  };

  const handleStartTour = async () => {
    await advanceTour("tour_welcome");
    router.replace("/(tabs)/home");
  };

  // ── Renders ──

  // ── Step 0: Welcome ──────────────────────────────────────────────────────────
  if (currentStep === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.surface }]}>
        <ScrollView contentContainerStyle={styles.welcomeContent} showsVerticalScrollIndicator={false}>
          <View style={styles.welcomeHero}>
            <Text style={styles.welcomeEmoji}>⏱</Text>
            <Text style={[styles.welcomeHeadline, { color: appColors.textPrimary }]}>
              Stop guessing{"\n"}when to work.
            </Text>
            <Text style={[styles.welcomeSub, { color: appColors.textSecondary }]}>
              DayWise is an AI scheduler that learns{"\n"}when you focus best — then plans your day{"\n"}around you automatically.
            </Text>
          </View>

          <View style={[styles.bulletCard, { backgroundColor: appColors.primaryLight, borderColor: `${appColors.primary}30` }]}>
            {[
              { icon: "🧠", text: "AI that adapts to your rhythm" },
              { icon: "⏱", text: "Zero time wasted deciding when" },
              { icon: "✅", text: "Never miss a deadline again" },
              { icon: "🗓️", text: "Day, week & month views built in" },
            ].map((b) => (
              <View key={b.text} style={styles.bulletRow}>
                <Text style={styles.bulletIcon}>{b.icon}</Text>
                <Text style={[styles.bulletText, { color: appColors.textPrimary }]}>{b.text}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: appColors.border }]}>
          <Button mode="contained" onPress={goNext} style={styles.ctaButton} contentStyle={styles.ctaContent} labelStyle={styles.ctaLabel}>
            See How It Works →
          </Button>
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
            <Text style={styles.featureEmoji}>{feature.emoji}</Text>
            <Text style={[styles.featureHeadline, { color: appColors.textPrimary }]}>{feature.headline}</Text>
            <Text style={[styles.featureSub, { color: appColors.textSecondary }]}>{feature.sub}</Text>

            <View style={[styles.featureBulletCard, { backgroundColor: appColors.primaryLight, borderColor: `${appColors.primary}25` }]}>
              {feature.bullets.map((b) => (
                <View key={b.text} style={styles.bulletRow}>
                  <Text style={styles.bulletIcon}>{b.icon}</Text>
                  <Text style={[styles.bulletText, { color: appColors.textPrimary }]}>{b.text}</Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: appColors.border }]}>
            <View style={styles.footerRow}>
              <Pressable onPress={goBack} style={styles.ghostBack} hitSlop={8}>
                <Text style={[styles.ghostBackText, { color: appColors.textSecondary }]}>←</Text>
              </Pressable>
              <Button
                mode="contained"
                onPress={goNext}
                style={[styles.ctaButton, { flex: 1 }]}
                contentStyle={styles.ctaContent}
                labelStyle={styles.ctaLabel}
              >
                {currentStep === 3 ? "Personalise My AI →" : "Next →"}
              </Button>
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
              When is your workday?
            </Text>
            <Text style={[styles.preamble, { color: appColors.textSecondary, marginBottom: 28 }]}>
              I'll only schedule tasks within these hours by default. You can change this anytime in Settings.
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
              disabled={loading}
            >
              {loading ? <ActivityIndicator size="small" color="#fff" /> : "Finish Setup →"}
            </Button>
          </View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // ── Step 11: Completion ──────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.surface }]}>
      <Confetti />
      <View style={[styles.flex, styles.completionContainer]}>
        <Text style={styles.completionEmoji}>🎉</Text>
        <Text style={[styles.completionHeadline, { color: appColors.textPrimary }]}>Your AI is ready!</Text>
        <Text style={[styles.completionSub, { color: appColors.textSecondary }]}>
          I've learned your style. Let's schedule your first task and I'll show you exactly what I found.
        </Text>
        <Button
          mode="contained"
          onPress={handleStartTour}
          style={[styles.ctaButton, { marginTop: 40, alignSelf: "stretch" }]}
          contentStyle={styles.ctaContent}
          labelStyle={styles.ctaLabel}
        >
          Create Your First Task →
        </Button>
      </View>
    </SafeAreaView>
  );
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
  welcomeHero: {
    alignItems: "center",
    marginBottom: 32,
  },
  welcomeEmoji: {
    fontSize: 60,
    marginBottom: 20,
  },
  welcomeHeadline: {
    fontSize: 32,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 40,
    marginBottom: 14,
  },
  welcomeSub: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 23,
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
  bulletIcon: {
    fontSize: 20,
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
  featureEmoji: {
    fontSize: 64,
    marginBottom: 20,
    textAlign: "center",
  },
  featureHeadline: {
    fontSize: 26,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 34,
    marginBottom: 12,
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
  ghostBackText: {
    fontSize: 26,
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
  completionEmoji: {
    fontSize: 72,
    marginBottom: 24,
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
