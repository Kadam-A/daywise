import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Dimensions,
} from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { startFreeTrial } from "@/lib/purchases";
import { trackEvent } from "@/lib/analytics";
import { useAppColors } from "@/contexts/ThemeContext";
import { useSubscription } from "@/contexts/SubscriptionContext";

interface TrialBottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
}

const FEATURES = [
  { icon: "brain", label: "AI Scheduling", desc: "Finds your perfect time slot automatically" },
  { icon: "calendar-refresh", label: "Auto-Reschedule", desc: "Missed tasks moved for you without lifting a finger" },
  { icon: "chart-line", label: "Advanced Analytics", desc: "See exactly when and how you work best" },
];

export default function TrialBottomSheet({ visible, onDismiss }: TrialBottomSheetProps) {
  const appColors = useAppColors();
  const insets = useSafeAreaInsets();
  const { refresh: refreshSubscription } = useSubscription();
  const [starting, setStarting] = useState(false);

  const handleStartTrial = async () => {
    setStarting(true);
    try {
      const result = await startFreeTrial();
      if (result.success) {
        await refreshSubscription();
      }
      await trackEvent("trial_started", { source: "post_onboarding_bottom_sheet" });
    } catch {
      // Best-effort refresh even on failure
      await refreshSubscription().catch(() => {});
    } finally {
      setStarting(false);
      onDismiss();
    }
  };

  const handleMaybeLater = async () => {
    await trackEvent("trial_skipped", { source: "post_onboarding_bottom_sheet" });
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleMaybeLater}
    >
      <Pressable style={styles.backdrop} onPress={handleMaybeLater}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: appColors.surface, paddingBottom: Math.max(insets.bottom, 24) },
          ]}
          onPress={() => {}}
        >
          <View style={[styles.handle, { backgroundColor: appColors.border }]} />

          <View style={styles.iconRow}>
            <View style={[styles.starCircle, { backgroundColor: `${appColors.primary}15` }]}>
              <MaterialCommunityIcons name="star-circle-outline" size={44} color={appColors.primary} />
            </View>
          </View>

          <Text style={[styles.headline, { color: appColors.textPrimary }]}>
            7 days of Pro, free
          </Text>

          <View style={[styles.badge, { backgroundColor: appColors.successLight }]}>
            <MaterialCommunityIcons name="shield-check-outline" size={14} color={appColors.success} />
            <Text style={[styles.badgeText, { color: appColors.success }]}>
              No credit card · cancel anytime
            </Text>
          </View>

          <View style={styles.featureList}>
            {FEATURES.map((f) => (
              <View key={f.label} style={[styles.featureRow, { backgroundColor: appColors.inputBg }]}>
                <View style={[styles.featureIcon, { backgroundColor: `${appColors.primary}15` }]}>
                  <MaterialCommunityIcons name={f.icon as any} size={20} color={appColors.primary} />
                </View>
                <View style={styles.featureText}>
                  <Text style={[styles.featureLabel, { color: appColors.textPrimary }]}>{f.label}</Text>
                  <Text style={[styles.featureDesc, { color: appColors.textTertiary }]}>{f.desc}</Text>
                </View>
                <MaterialCommunityIcons name="check-circle" size={18} color={appColors.success} />
              </View>
            ))}
          </View>

          <Pressable
            onPress={handleStartTrial}
            disabled={starting}
            style={[styles.ctaButton, { backgroundColor: appColors.primary, opacity: starting ? 0.7 : 1 }]}
          >
            {starting ? (
              <ActivityIndicator size={20} color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaText}>Start My Free Trial</Text>
            )}
          </Pressable>

          <Pressable onPress={handleMaybeLater} style={styles.laterLink}>
            <Text style={[styles.laterText, { color: appColors.textTertiary }]}>Maybe later</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 24,
    maxHeight: Dimensions.get("window").height * 0.72,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 24,
  },
  iconRow: {
    alignItems: "center",
    marginBottom: 16,
  },
  starCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headline: {
    fontSize: 26,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 20,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  featureList: {
    gap: 8,
    marginBottom: 24,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 12,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    flex: 1,
  },
  featureLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  featureDesc: {
    fontSize: 12,
    marginTop: 1,
  },
  ctaButton: {
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  laterLink: {
    alignItems: "center",
    paddingVertical: 14,
  },
  laterText: {
    fontSize: 14,
  },
});
