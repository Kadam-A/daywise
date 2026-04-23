/**
 * HelpFAQModal
 *
 * Scrollable accordion FAQ launched from Settings → Help & FAQ.
 * Grouped by topic; each question expands/collapses on tap.
 */

import { useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppColors } from "@/contexts/ThemeContext";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQSection {
  title: string;
  icon: string;
  items: FAQItem[];
}

const FAQ_SECTIONS: FAQSection[] = [
  {
    title: "Scheduling",
    icon: "calendar-clock",
    items: [
      {
        question: "How does AI scheduling work?",
        answer:
          "When you create a task with AI scheduling, the app analyses your work hours, existing calendar events, and other scheduled tasks to find the best available slot. It considers your task's priority and deadline — high-priority tasks are pushed earlier, tight deadlines move tasks sooner.",
      },
      {
        question: "What's the difference between AI and Manual scheduling?",
        answer:
          "AI scheduling automatically ranks the best time slots for you based on your schedule and preferences — you just pick one from the suggestions. Manual scheduling shows you a blank timeline so you can drag and drop or tap any open slot yourself, giving you full control.",
      },
      {
        question: "How does the due date affect AI scheduling?",
        answer:
          "The due date tells the AI how urgently to schedule your task. If something is due tomorrow, the AI will prioritise finding a slot today. Longer deadlines give the AI more flexibility to find a slot during your most productive hours.",
      },
      {
        question: "Can I change a task's scheduled time after creating it?",
        answer:
          "Yes. Tap any scheduled task to open its detail screen, then tap 'Reschedule' to pick a new time. You can also drag tasks directly on the Calendar screen to move them to a different slot.",
      },
    ],
  },
  {
    title: "Tasks",
    icon: "checkbox-marked-circle-outline",
    items: [
      {
        question: "What do the task states mean?",
        answer:
          "Pending schedule — the task has been created but not yet given a time slot.\n\nScheduled — a time slot has been assigned and it's coming up.\n\nCompleted — you've marked the task as done.\n\nMissed — the scheduled time slot passed but the due date is still in the future. The task can still be done on time — it just needs a new slot. Auto-reschedule will handle this automatically if enabled.\n\nOverdue — the due date itself has passed and the task is still incomplete. Unlike missed, overdue means the deadline is gone — these need your attention immediately.",
      },
      {
        question: "What is auto-reschedule?",
        answer:
          "If a task's scheduled time passes and it wasn't completed, auto-reschedule automatically finds it a new slot. This runs twice a day at times you configure in Settings → Auto-Reschedule. You can disable it if you prefer to reschedule manually.",
      },
    ],
  },
  {
    title: "Calendar",
    icon: "calendar-month-outline",
    items: [
      {
        question: "How does Google Calendar sync work?",
        answer:
          "Coming soon — Google Calendar sync is currently in development. Once available, DayWise will import your Google Calendar events as busy blocks so the AI never schedules over existing commitments.",
      },
      {
        question: "What are the calendar views?",
        answer:
          "The Calendar screen has three views:\n\nDay — hour-by-hour timeline for a single day.\n\nWeek — 7-day overview with task blocks. You can drag tasks between days here.\n\nMonth — full month grid showing which days have scheduled tasks.",
      },
    ],
  },
  {
    title: "Subscription & AI",
    icon: "star-four-points-outline",
    items: [
      {
        question: "What is the weekly AI limit?",
        answer:
          "The free plan includes a limited number of AI scheduling uses per week, resetting every Monday. Once the limit is reached, the AI button shows a lock icon — tap it to upgrade for unlimited AI scheduling.",
      },
      {
        question: "Does the AI learn my preferences over time?",
        answer:
          "Yes. When you rate AI-scheduled tasks (via the feedback prompt after completing a task), the app records your preferences. Over time, the AI gets better at prioritising times that match your working style.",
      },
    ],
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function HelpFAQModal({ visible, onClose }: Props) {
  const appColors = useAppColors();
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => (prev === key ? null : key));
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={["top"]}>
        {/* Header */}
        <View style={[styles.header, { backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
          <View style={styles.headerLeft}>
            <MaterialCommunityIcons name="help-circle-outline" size={22} color={appColors.primary} />
            <Text style={[styles.headerTitle, { color: appColors.textPrimary }]}>Help & FAQ</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
            <MaterialCommunityIcons name="close" size={22} color={appColors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {FAQ_SECTIONS.map((section) => (
            <View key={section.title} style={styles.section}>
              {/* Section header */}
              <View style={styles.sectionHeader}>
                <MaterialCommunityIcons name={section.icon as any} size={16} color={appColors.primary} />
                <Text style={[styles.sectionTitle, { color: appColors.primary }]}>{section.title}</Text>
              </View>

              {/* FAQ items */}
              <View style={[styles.card, { backgroundColor: appColors.surface, borderColor: appColors.border }]}>
                {section.items.map((item, idx) => {
                  const key = `${section.title}-${idx}`;
                  const isOpen = expanded === key;
                  const isLast = idx === section.items.length - 1;
                  return (
                    <View key={key}>
                      <Pressable
                        onPress={() => toggle(key)}
                        style={styles.questionRow}
                        android_ripple={{ color: `${appColors.primary}10` }}
                      >
                        <Text style={[styles.question, { color: appColors.textPrimary }]}>
                          {item.question}
                        </Text>
                        <MaterialCommunityIcons
                          name={isOpen ? "chevron-up" : "chevron-down"}
                          size={20}
                          color={appColors.textTertiary}
                        />
                      </Pressable>

                      {isOpen && (
                        <View style={[styles.answerContainer, { borderTopColor: appColors.border }]}>
                          <Text style={[styles.answer, { color: appColors.textSecondary }]}>
                            {item.answer}
                          </Text>
                        </View>
                      )}

                      {!isLast && <View style={[styles.itemDivider, { backgroundColor: appColors.border }]} />}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  closeButton: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 24,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  question: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 21,
  },
  answerContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
  },
  answer: {
    fontSize: 14,
    lineHeight: 22,
  },
  itemDivider: {
    height: 1,
    marginHorizontal: 16,
  },
});
