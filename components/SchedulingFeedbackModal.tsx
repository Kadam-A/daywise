/**
 * SchedulingFeedbackModal - Post-task feedback for AI scheduling
 *
 * Shown after completing an AI-scheduled task to collect feedback
 * about whether the scheduled time worked well for the user.
 */

import React, { useState } from "react";
import { View, StyleSheet, Modal, Pressable } from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { format } from "date-fns";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  submitSchedulingFeedback,
  FeedbackReason,
} from "@/lib/scheduling-feedback";
import { useAppColors } from "@/contexts/ThemeContext";

export const SCHEDULING_FEEDBACK_DISABLED_KEY = "schedulingFeedbackDisabled";

const FEEDBACK_REASONS: { value: FeedbackReason; label: string; icon: string }[] = [
  { value: "earlier", label: "Earlier in the day", icon: "weather-sunset-up" },
  { value: "later", label: "Later in the day", icon: "weather-sunset-down" },
  { value: "different_day", label: "Different day entirely", icon: "calendar-arrow-right" },
  { value: "other", label: "Other", icon: "dots-horizontal" },
];

interface SchedulingFeedbackModalProps {
  visible: boolean;
  onComplete: () => void;
  taskId: string;
  taskTitle: string;
  scheduledStart: string;
  scheduledEnd: string;
}

export default function SchedulingFeedbackModal({
  visible,
  onComplete,
  taskId,
  taskTitle,
  scheduledStart,
  scheduledEnd,
}: SchedulingFeedbackModalProps) {
  const appColors = useAppColors();
  const [step, setStep] = useState<"initial" | "reason">("initial");
  const [selectedReason, setSelectedReason] = useState<FeedbackReason | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const scheduledTime = format(new Date(scheduledStart), "h:mm a");

  const handlePositive = async () => {
    setIsSubmitting(true);
    await submitSchedulingFeedback({
      taskId,
      wasGoodTime: true,
      scheduledStart,
      scheduledEnd,
    });
    setIsSubmitting(false);
    resetAndClose();
  };

  const handleNegative = () => {
    setStep("reason");
  };

  const handleReasonSubmit = async () => {
    if (!selectedReason) return;

    setIsSubmitting(true);
    await submitSchedulingFeedback({
      taskId,
      wasGoodTime: false,
      scheduledStart,
      scheduledEnd,
      feedbackReason: selectedReason,
    });
    setIsSubmitting(false);
    resetAndClose();
  };

  const handleSkip = () => {
    // Still record that they saw the modal but skipped
    submitSchedulingFeedback({
      taskId,
      wasGoodTime: false,
      scheduledStart,
      scheduledEnd,
      feedbackReason: "other",
    });
    resetAndClose();
  };

  const handleDisable = async () => {
    await AsyncStorage.setItem(SCHEDULING_FEEDBACK_DISABLED_KEY, "true");
    resetAndClose();
  };

  const resetAndClose = () => {
    setStep("initial");
    setSelectedReason(null);
    onComplete();
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={() => {
        // Prevent dismissing by back button
      }}
    >
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: appColors.surface }]}>
          {step === "initial" ? (
            <>
              {/* Success Icon */}
              <View style={styles.iconContainer}>
                <LinearGradient
                  colors={[appColors.success, "#4DAF6E"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.iconGradient}
                >
                  <MaterialCommunityIcons
                    name="check-bold"
                    size={40}
                    color="#FFFFFF"
                  />
                </LinearGradient>
              </View>

              {/* Title */}
              <Text style={[styles.title, { color: appColors.textPrimary }]}>Task completed!</Text>

              {/* Question */}
              <Text style={[styles.question, { color: appColors.textPrimary }]}>
                Was {scheduledTime} a good time for this?
              </Text>

              {/* Task title hint */}
              <Text style={[styles.taskHint, { color: appColors.textSecondary }]} numberOfLines={1}>
                "{taskTitle}"
              </Text>

              {/* Response Buttons */}
              <View style={styles.buttonsContainer}>
                <Pressable
                  style={styles.responseButton}
                  onPress={handlePositive}
                  disabled={isSubmitting}
                >
                  <LinearGradient
                    colors={[appColors.success, "#4DAF6E"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.positiveGradient}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <MaterialCommunityIcons
                          name="thumb-up"
                          size={24}
                          color="#FFFFFF"
                        />
                        <Text style={styles.positiveText}>Yes, perfect!</Text>
                      </>
                    )}
                  </LinearGradient>
                </Pressable>

                <Pressable
                  style={[styles.responseButton, styles.negativeButton, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]}
                  onPress={handleNegative}
                  disabled={isSubmitting}
                >
                  <MaterialCommunityIcons
                    name="thumb-down-outline"
                    size={24}
                    color={appColors.textSecondary}
                  />
                  <Text style={[styles.negativeText, { color: appColors.textSecondary }]}>Not ideal</Text>
                </Pressable>
              </View>

              {/* Helper text */}
              <Text style={[styles.helperText, { color: appColors.textTertiary }]}>
                This helps me schedule better next time
              </Text>

              {/* Opt-out link */}
              <Pressable onPress={handleDisable} style={styles.disableLink}>
                <Text style={[styles.disableLinkText, { color: appColors.textTertiary }]}>
                  Don't ask again
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              {/* Back button */}
              <Pressable style={styles.backButton} onPress={() => setStep("initial")}>
                <MaterialCommunityIcons
                  name="arrow-left"
                  size={24}
                  color={appColors.textSecondary}
                />
              </Pressable>

              {/* Question */}
              <Text style={[styles.reasonTitle, { color: appColors.textPrimary }]}>
                What would've been better?
              </Text>

              {/* Reason Options */}
              <View style={styles.reasonsContainer}>
                {FEEDBACK_REASONS.map((reason) => (
                  <Pressable
                    key={reason.value}
                    style={[
                      styles.reasonOption,
                      { backgroundColor: appColors.inputBg, borderColor: appColors.border },
                      selectedReason === reason.value && { backgroundColor: appColors.primaryLight, borderColor: appColors.gradientStart },
                    ]}
                    onPress={() => setSelectedReason(reason.value)}
                  >
                    <MaterialCommunityIcons
                      name={reason.icon as any}
                      size={20}
                      color={
                        selectedReason === reason.value
                          ? appColors.gradientStart
                          : appColors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.reasonText,
                        { color: appColors.textPrimary },
                        selectedReason === reason.value && { color: appColors.gradientStart, fontWeight: "500" },
                      ]}
                    >
                      {reason.label}
                    </Text>
                    {selectedReason === reason.value && (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={20}
                        color={appColors.gradientStart}
                      />
                    )}
                  </Pressable>
                ))}
              </View>

              {/* Action Buttons */}
              <View style={styles.actionButtons}>
                <Pressable style={[styles.skipButton, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]} onPress={handleSkip}>
                  <Text style={[styles.skipText, { color: appColors.textSecondary }]}>Skip</Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.submitButton,
                    { backgroundColor: appColors.gradientStart },
                    !selectedReason && { backgroundColor: appColors.border },
                  ]}
                  onPress={handleReasonSubmit}
                  disabled={!selectedReason || isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitText}>Submit</Text>
                  )}
                </Pressable>
              </View>

              {/* Helper text */}
              <Text style={[styles.helperText, { color: appColors.textTertiary }]}>
                This helps me learn your preferences
              </Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modal: {
    borderRadius: 24,
    padding: 28,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
  },
  iconContainer: {
    marginBottom: 20,
  },
  iconGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
  },
  question: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  taskHint: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
    fontStyle: "italic",
    maxWidth: "90%",
  },
  buttonsContainer: {
    width: "100%",
    gap: 12,
  },
  responseButton: {
    borderRadius: 14,
    overflow: "hidden",
  },
  positiveGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 10,
  },
  positiveText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  negativeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 10,
    borderWidth: 1,
  },
  negativeText: {
    fontSize: 17,
    fontWeight: "600",
  },
  helperText: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 20,
  },
  disableLink: {
    marginTop: 12,
    paddingVertical: 4,
  },
  disableLinkText: {
    fontSize: 12,
    textDecorationLine: "underline",
  },
  // Reason selection step
  backButton: {
    position: "absolute",
    top: 16,
    left: 16,
    padding: 8,
  },
  reasonTitle: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 24,
    marginBottom: 20,
  },
  reasonsContainer: {
    width: "100%",
    gap: 10,
    marginBottom: 20,
  },
  reasonOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  reasonText: {
    flex: 1,
    fontSize: 15,
  },
  actionButtons: {
    flexDirection: "row",
    width: "100%",
    gap: 12,
  },
  skipButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
  },
  skipText: {
    fontSize: 16,
    fontWeight: "600",
  },
  submitButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 12,
  },
  submitText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
