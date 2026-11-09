import React, { useState, useEffect } from "react";
import { View, StyleSheet, Pressable, Modal, Dimensions } from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { trackEvent } from "@/lib/analytics";
import { useAppColors } from "@/contexts/ThemeContext";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PostOnboardingTooltipsProps {
  nextUpCardRect: LayoutRect | null;
  fabRect: LayoutRect | null;
  onComplete: () => void;
}

type Step = 0 | 1 | 2;

const TOOLTIPS: {
  title: string;
  body: string;
  cta: string;
  icon: string;
  event: "post_onboarding_tooltip_1_seen" | "post_onboarding_tooltip_2_seen" | "post_onboarding_tooltip_3_seen";
}[] = [
  {
    title: "Your first task is scheduled",
    body: "DayWise picked the best time based on your focus patterns.",
    cta: "Next →",
    icon: "calendar-check",
    event: "post_onboarding_tooltip_1_seen",
  },
  {
    title: "Check your calendar",
    body: "See how your tasks fit into your week — and where you have room.",
    cta: "Next →",
    icon: "calendar-month-outline",
    event: "post_onboarding_tooltip_2_seen",
  },
  {
    title: "Add tasks anytime",
    body: "Quick-add from here, or describe what you need in plain English.",
    cta: "Got it →",
    icon: "plus-circle-outline",
    event: "post_onboarding_tooltip_3_seen",
  },
];

export default function PostOnboardingTooltips({
  nextUpCardRect,
  fabRect,
  onComplete,
}: PostOnboardingTooltipsProps) {
  const appColors = useAppColors();
  const [step, setStep] = useState<Step>(0);

  const current = TOOLTIPS[step];

  const handleNext = async () => {
    await trackEvent(current.event);
    if (step === 2) {
      await trackEvent("post_onboarding_tooltips_completed");
      onComplete();
    } else {
      setStep((s) => (s + 1) as Step);
    }
  };

  // Compute card position relative to the highlighted element.
  // Cards appear above the target when target is in lower half of screen,
  // and below when target is in upper half.
  const getCardStyle = () => {
    const CARD_HEIGHT_APPROX = 160;
    const CARD_MARGIN = 12;

    if (step === 0 && nextUpCardRect) {
      const targetBottom = nextUpCardRect.y + nextUpCardRect.height;
      if (targetBottom > SCREEN_HEIGHT / 2) {
        return { top: nextUpCardRect.y - CARD_HEIGHT_APPROX - CARD_MARGIN };
      }
      return { top: targetBottom + CARD_MARGIN };
    }

    if (step === 1) {
      // Calendar tab — always in bottom nav bar, show card above bottom tab area
      return { bottom: 90 };
    }

    if (step === 2 && fabRect) {
      return { top: fabRect.y - CARD_HEIGHT_APPROX - CARD_MARGIN };
    }

    // Fallback: center vertically
    return { top: SCREEN_HEIGHT / 2 - CARD_HEIGHT_APPROX / 2 };
  };

  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={[styles.card, getCardStyle(), { backgroundColor: appColors.surface }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: `${appColors.primary}18` }]}>
              <MaterialCommunityIcons name={current.icon as any} size={24} color={appColors.primary} />
            </View>
            <View style={styles.stepPips}>
              {TOOLTIPS.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pip,
                    { backgroundColor: i === step ? appColors.primary : `${appColors.primary}30` },
                  ]}
                />
              ))}
            </View>
          </View>

          <Text style={[styles.cardTitle, { color: appColors.textPrimary }]}>{current.title}</Text>
          <Text style={[styles.cardBody, { color: appColors.textSecondary }]}>{current.body}</Text>

          <Pressable
            onPress={handleNext}
            style={[styles.ctaButton, { backgroundColor: appColors.primary }]}
          >
            <Text style={styles.ctaText}>{current.cta}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  card: {
    position: "absolute",
    left: 20,
    right: 20,
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  stepPips: {
    flexDirection: "row",
    gap: 6,
  },
  pip: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 18,
  },
  ctaButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
});
