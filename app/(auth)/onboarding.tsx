/**
 * Onboarding Screen
 *
 * Personality quiz with intuitive multiple-choice questions
 * Each answer maps to a numeric value for the scheduling algorithm
 */

import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { Button, Text, ActivityIndicator, RadioButton } from "react-native-paper";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Question option type
type Option = {
  label: string;
  value: number;
  description?: string;
};

// Question component with radio buttons
function PersonalityQuestion({
  question,
  options,
  selected,
  onSelect,
}: {
  question: string;
  options: Option[];
  selected: number | null;
  onSelect: (value: number) => void;
}) {
  return (
    <View style={styles.questionContainer}>
      <Text variant="titleMedium" style={styles.questionText}>
        {question}
      </Text>
      <View style={styles.optionsContainer}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            style={[
              styles.optionButton,
              selected === option.value && styles.optionButtonSelected,
            ]}
            onPress={() => onSelect(option.value)}
          >
            <View style={styles.optionContent}>
              <RadioButton
                value={String(option.value)}
                status={selected === option.value ? "checked" : "unchecked"}
                onPress={() => onSelect(option.value)}
                color="#2563eb"
              />
              <View style={styles.optionTextContainer}>
                <Text
                  variant="bodyMedium"
                  style={[
                    styles.optionLabel,
                    selected === option.value && styles.optionLabelSelected,
                  ]}
                >
                  {option.label}
                </Text>
                {option.description && (
                  <Text variant="bodySmall" style={styles.optionDescription}>
                    {option.description}
                  </Text>
                )}
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// Question definitions with options that map to algorithm values
const QUESTIONS = {
  chronotype: {
    question: "When do you feel most productive?",
    options: [
      { label: "Early morning (6-9am)", value: 90, description: "I'm a morning person" },
      { label: "Late morning (9am-12pm)", value: 70, description: "After I've warmed up" },
      { label: "Afternoon (12-5pm)", value: 50, description: "Mid-day works best" },
      { label: "Evening (5-9pm)", value: 30, description: "I hit my stride later" },
      { label: "Night (after 9pm)", value: 10, description: "Night owl" },
    ],
  },
  focusDuration: {
    question: "How long can you focus before needing a break?",
    options: [
      { label: "15-25 minutes", value: 15, description: "Short focused bursts" },
      { label: "30-45 minutes", value: 35, description: "Pomodoro-style sessions" },
      { label: "1-2 hours", value: 60, description: "Solid work blocks" },
      { label: "2-3 hours", value: 85, description: "Deep focus sessions" },
      { label: "3+ hours", value: 100, description: "Extended deep work" },
    ],
  },
  deadlineStyle: {
    question: "How do you work best with deadlines?",
    options: [
      { label: "Start immediately", value: 10, description: "I like having buffer time" },
      { label: "Steady progress", value: 40, description: "Spread work evenly" },
      { label: "Closer to deadline", value: 70, description: "Some pressure helps" },
      { label: "Right before deadline", value: 95, description: "I thrive under pressure" },
    ],
  },
  breakFrequency: {
    question: "How often do you need breaks?",
    options: [
      { label: "Every 15-20 minutes", value: 10, description: "Frequent short breaks" },
      { label: "Every 30-45 minutes", value: 35, description: "Regular breaks" },
      { label: "Every 1-2 hours", value: 65, description: "Occasional breaks" },
      { label: "Every 2-3+ hours", value: 90, description: "Minimal breaks needed" },
    ],
  },
  taskSwitching: {
    question: "How do you prefer to work on tasks?",
    options: [
      { label: "One task until done", value: 10, description: "Single-minded focus" },
      { label: "A few related tasks", value: 40, description: "Some variety is good" },
      { label: "Mix of different tasks", value: 70, description: "Variety keeps me engaged" },
      { label: "Frequently switch", value: 95, description: "I like juggling multiple things" },
    ],
  },
  structurePreference: {
    question: "How structured do you like your schedule?",
    options: [
      { label: "Very structured", value: 10, description: "Exact times for everything" },
      { label: "Mostly structured", value: 35, description: "Planned with some flex" },
      { label: "Somewhat flexible", value: 65, description: "General plan, adapt as needed" },
      { label: "Very flexible", value: 90, description: "Go with the flow" },
    ],
  },
};

export default function OnboardingScreen() {
  // Track current question (0-5)
  const [currentQuestion, setCurrentQuestion] = useState(0);

  // Store answers (null = not answered yet)
  const [chronotype, setChronotype] = useState<number | null>(null);
  const [focusDuration, setFocusDuration] = useState<number | null>(null);
  const [deadlineStyle, setDeadlineStyle] = useState<number | null>(null);
  const [breakFrequency, setBreakFrequency] = useState<number | null>(null);
  const [taskSwitching, setTaskSwitching] = useState<number | null>(null);
  const [structurePreference, setStructurePreference] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map question index to state
  const questions = [
    { key: "chronotype", data: QUESTIONS.chronotype, value: chronotype, setter: setChronotype },
    { key: "focusDuration", data: QUESTIONS.focusDuration, value: focusDuration, setter: setFocusDuration },
    { key: "deadlineStyle", data: QUESTIONS.deadlineStyle, value: deadlineStyle, setter: setDeadlineStyle },
    { key: "breakFrequency", data: QUESTIONS.breakFrequency, value: breakFrequency, setter: setBreakFrequency },
    { key: "taskSwitching", data: QUESTIONS.taskSwitching, value: taskSwitching, setter: setTaskSwitching },
    { key: "structurePreference", data: QUESTIONS.structurePreference, value: structurePreference, setter: setStructurePreference },
  ];

  const currentQ = questions[currentQuestion];
  const isLastQuestion = currentQuestion === questions.length - 1;
  const canProceed = currentQ.value !== null;

  const handleNext = () => {
    if (isLastQuestion) {
      handleComplete();
    } else {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const handleBack = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleComplete = async () => {
    try {
      setLoading(true);
      setError(null);

      const personalityData = {
        chronotype: chronotype ?? 50,
        focus_duration: focusDuration ?? 50,
        deadline_style: deadlineStyle ?? 50,
        break_frequency: breakFrequency ?? 50,
        task_switching: taskSwitching ?? 50,
        structure_preference: structurePreference ?? 50,
        preferred_windows: [],
        additional_context: null,
      };

      // Update user profile with personality data
      const { error: updateError } = await supabase
        .from("user_profiles")
        .update({ personality_data: personalityData })
        .eq("id", (await supabase.auth.getUser()).data.user?.id);

      if (updateError) throw updateError;

      // Navigate to home
      router.replace("/(tabs)/home");
    } catch (err) {
      console.error("[Onboarding Error]", err);
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress indicator */}
      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              { width: `${((currentQuestion + 1) / questions.length) * 100}%` },
            ]}
          />
        </View>
        <Text variant="bodySmall" style={styles.progressText}>
          {currentQuestion + 1} of {questions.length}
        </Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <PersonalityQuestion
          question={currentQ.data.question}
          options={currentQ.data.options}
          selected={currentQ.value}
          onSelect={currentQ.setter}
        />
      </ScrollView>

      <View style={styles.footer}>
        {error && (
          <Text variant="bodySmall" style={styles.error}>
            {error}
          </Text>
        )}
        <View style={styles.buttonRow}>
          {currentQuestion > 0 && (
            <Button
              mode="outlined"
              onPress={handleBack}
              style={styles.backButton}
              contentStyle={styles.buttonContent}
            >
              Back
            </Button>
          )}
          <Button
            mode="contained"
            onPress={handleNext}
            style={[styles.nextButton, currentQuestion === 0 && styles.fullWidth]}
            contentStyle={styles.buttonContent}
            disabled={!canProceed || loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : isLastQuestion ? (
              "Complete"
            ) : (
              "Next"
            )}
          </Button>
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
  progressContainer: {
    padding: 24,
    paddingBottom: 16,
  },
  progressBar: {
    height: 4,
    backgroundColor: "#e2e8f0",
    borderRadius: 2,
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#2563eb",
    borderRadius: 2,
  },
  progressText: {
    color: "#64748b",
    textAlign: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingTop: 8,
  },
  questionContainer: {
    marginBottom: 16,
  },
  questionText: {
    fontWeight: "600",
    marginBottom: 20,
    fontSize: 20,
    lineHeight: 28,
  },
  optionsContainer: {
    gap: 12,
  },
  optionButton: {
    borderWidth: 2,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    backgroundColor: "#ffffff",
  },
  optionButtonSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
  },
  optionTextContainer: {
    flex: 1,
    marginLeft: 4,
  },
  optionLabel: {
    fontWeight: "500",
  },
  optionLabelSelected: {
    color: "#2563eb",
  },
  optionDescription: {
    color: "#64748b",
    marginTop: 2,
  },
  error: {
    color: "#dc2626",
    textAlign: "center",
    marginBottom: 12,
  },
  footer: {
    padding: 24,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  backButton: {
    flex: 1,
  },
  nextButton: {
    flex: 2,
  },
  fullWidth: {
    flex: 1,
  },
  buttonContent: {
    paddingVertical: 8,
  },
});
