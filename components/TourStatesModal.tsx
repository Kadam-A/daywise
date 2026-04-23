/**
 * TourStatesModal
 *
 * Animated walkthrough explaining task states — scheduled → missed slot → overdue.
 * Uses a "time passing" progress bar animation to show how states transition.
 *
 * Phase 0: Scheduled task card (starting point)
 * Phase 1: Time-passing animation → transitions to Missed Slot
 * Phase 2: Missed Slot explanation + auto-reschedule info
 * Phase 3: Time-passing animation → transitions to Overdue
 * Phase 4: Overdue explanation + Bulk Reschedule CTA
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppColors } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Mock task card ────────────────────────────────────────────────────────────

type CardState = 'scheduled' | 'missed' | 'overdue';

function MockTaskCard({ state, cardOpacity }: { state: CardState; cardOpacity: Animated.Value }) {
  const appColors = useAppColors();

  const config = {
    scheduled: {
      icon: 'clock-outline',
      color: appColors.primary,
      bg: appColors.primaryLight,
      label: 'Scheduled',
      time: '2:00 PM – 3:00 PM',
      title: 'Quarterly report draft',
    },
    missed: {
      icon: 'clock-alert-outline',
      color: appColors.warning,
      bg: appColors.warningLight,
      label: 'Missed slot',
      time: 'Slot passed — due tomorrow',
      title: 'Quarterly report draft',
    },
    overdue: {
      icon: 'alert-circle-outline',
      color: appColors.error,
      bg: appColors.errorLight,
      label: 'Overdue',
      time: 'Due date passed',
      title: 'Quarterly report draft',
    },
  }[state];

  return (
    <Animated.View
      style={[
        styles.mockCard,
        { backgroundColor: appColors.surface, borderColor: config.color + '40', opacity: cardOpacity },
      ]}
    >
      <View style={[styles.mockCardLeft, { backgroundColor: config.bg, borderRadius: 12 }]}>
        <MaterialCommunityIcons name={config.icon as any} size={24} color={config.color} />
      </View>
      <View style={styles.mockCardContent}>
        <View style={styles.mockCardHeader}>
          <Text style={[styles.mockCardTitle, { color: appColors.textPrimary }]} numberOfLines={1}>
            {config.title}
          </Text>
          <View style={[styles.mockStatusBadge, { backgroundColor: config.bg }]}>
            <Text style={[styles.mockStatusText, { color: config.color }]}>{config.label}</Text>
          </View>
        </View>
        <Text style={[styles.mockCardTime, { color: appColors.textSecondary }]}>{config.time}</Text>
      </View>
    </Animated.View>
  );
}

// ─── Time-passing progress bar ─────────────────────────────────────────────────

function TimePassingBar({
  progress,
  label,
  color,
}: {
  progress: Animated.Value;
  label: string;
  color: string;
}) {
  const appColors = useAppColors();
  return (
    <View style={styles.timeBar}>
      <View style={styles.timeBarRow}>
        <MaterialCommunityIcons name="clock-fast" size={14} color={appColors.textTertiary} />
        <Text style={[styles.timeBarLabel, { color: appColors.textTertiary }]}>{label}</Text>
      </View>
      <View style={[styles.timeBarTrack, { backgroundColor: appColors.border }]}>
        <Animated.View
          style={[
            styles.timeBarFill,
            {
              backgroundColor: color,
              width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            },
          ]}
        />
      </View>
    </View>
  );
}

// ─── Phase content ─────────────────────────────────────────────────────────────

interface PhaseConfig {
  cardState: CardState;
  icon: string;
  iconColor: string;
  title: string;
  body: string;
  ctaLabel: string;
  showTimeBar?: boolean;
  timeBarLabel?: string;
  timeBarColor?: string;
}

// ─── Main component ────────────────────────────────────────────────────────────

interface TourStatesModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function TourStatesModal({ visible, onClose }: TourStatesModalProps) {
  const appColors = useAppColors();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;

  // Reset when modal opens
  useEffect(() => {
    if (visible) {
      setPhase(0);
      setIsAnimating(false);
      progressAnim.setValue(0);
      cardOpacity.setValue(1);
      contentOpacity.setValue(1);
    }
  }, [visible]);

  const startTimeAnimation = useCallback((nextPhase: number) => {
    setIsAnimating(true);
    progressAnim.setValue(0);

    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 2200,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished) return;
      // Flash card to signal state change
      Animated.sequence([
        Animated.timing(cardOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start(() => {
        setIsAnimating(false);
        setPhase(nextPhase);
      });
    });
  }, []);

  const PHASES: PhaseConfig[] = [
    {
      cardState: 'scheduled',
      icon: 'calendar-check',
      iconColor: appColors.primary,
      title: 'Task is scheduled',
      body: "When AI finds a slot, the task is blocked in your calendar. Let's see what happens when time moves on...",
      ctaLabel: 'Watch time pass',
    },
    {
      cardState: 'scheduled', // shows during animation, card flips after
      icon: 'clock-fast',
      iconColor: appColors.warning,
      title: 'Time is passing...',
      body: 'The scheduled slot is approaching.',
      ctaLabel: '',
      showTimeBar: true,
      timeBarLabel: 'Hours passing...',
      timeBarColor: appColors.warning,
    },
    {
      cardState: 'missed',
      icon: 'clock-alert-outline',
      iconColor: appColors.warning,
      title: 'Slot missed — but not overdue',
      body: "The 2pm slot passed, but the due date is still tomorrow. Auto-reschedule runs twice daily and will move this to your next free slot automatically. No action needed.",
      ctaLabel: 'See what happens next',
    },
    {
      cardState: 'missed',
      icon: 'clock-fast',
      iconColor: appColors.error,
      title: 'More time passing...',
      body: 'The due date is approaching.',
      ctaLabel: '',
      showTimeBar: true,
      timeBarLabel: 'Days passing...',
      timeBarColor: appColors.error,
    },
    {
      cardState: 'overdue',
      icon: 'alert-circle-outline',
      iconColor: appColors.error,
      title: 'Now it\'s overdue',
      body: "The due date has passed. Tap the reschedule icon next to any task to move it one at a time, or use Bulk Reschedule on the home screen to set new times for all overdue tasks at once.",
      ctaLabel: 'Got it',
    },
  ];

  const current = PHASES[phase];
  const isTimePhase = phase === 1 || phase === 3;

  const handleCta = () => {
    if (phase === 0) {
      // Start time animation phase 1→2
      setPhase(1);
      startTimeAnimation(2);
    } else if (phase === 2) {
      // Start time animation phase 3→4
      setPhase(3);
      startTimeAnimation(4);
    } else if (phase === 4) {
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
    >
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
        <View style={[styles.sheet, { backgroundColor: appColors.surface, paddingBottom: insets.bottom + 24 }]}>
          {/* Header */}
          <Text style={[styles.sheetTitle, { color: appColors.textPrimary }]}>
            Understanding task states
          </Text>

          {/* Progress dots */}
          <View style={styles.dotsRow}>
            {[0, 2, 4].map((targetPhase, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  {
                    backgroundColor: phase >= targetPhase ? appColors.primary : appColors.border,
                    width: phase === targetPhase || (phase === 1 && targetPhase === 0) || (phase === 3 && targetPhase === 2) ? 20 : 8,
                  },
                ]}
              />
            ))}
          </View>

          {/* Mock task card */}
          <MockTaskCard state={current.cardState} cardOpacity={cardOpacity} />

          {/* Time passing bar (only during animation phases) */}
          {isTimePhase && (
            <TimePassingBar
              progress={progressAnim}
              label={current.timeBarLabel ?? 'Time passing...'}
              color={current.timeBarColor ?? appColors.warning}
            />
          )}

          {/* Explanation content (only on non-animation phases) */}
          {!isTimePhase && (
            <View style={[styles.explanationCard, { backgroundColor: appColors.background, borderColor: appColors.border }]}>
              <View style={[styles.explIconBadge, { backgroundColor: `${current.iconColor}18` }]}>
                <MaterialCommunityIcons name={current.icon as any} size={22} color={current.iconColor} />
              </View>
              <View style={styles.explContent}>
                <Text style={[styles.explTitle, { color: appColors.textPrimary }]}>{current.title}</Text>
                <Text style={[styles.explBody, { color: appColors.textSecondary }]}>{current.body}</Text>
              </View>
            </View>
          )}

          {/* CTA button — hidden during animations */}
          {!isTimePhase && (
            <Pressable
              style={[
                styles.ctaButton,
                { backgroundColor: phase === 4 ? appColors.success : appColors.primary },
              ]}
              onPress={handleCta}
            >
              {phase === 4 && (
                <MaterialCommunityIcons name="check" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              )}
              {phase !== 4 && (
                <MaterialCommunityIcons name="play-circle-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              )}
              <Text style={styles.ctaLabel}>{current.ctaLabel}</Text>
            </Pressable>
          )}

          {/* Waiting label during animation */}
          {isTimePhase && (
            <View style={styles.animatingRow}>
              <Text style={[styles.animatingLabel, { color: appColors.textTertiary }]}>
                Watch the task state change...
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 80,
  },
  sheet: {
    borderRadius: 24,
    paddingTop: 24,
    paddingHorizontal: 20,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 16,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  // Mock task card
  mockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    gap: 12,
    marginBottom: 16,
  },
  mockCardLeft: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  mockCardContent: {
    flex: 1,
  },
  mockCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  mockCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  mockStatusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  mockStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  mockCardTime: {
    fontSize: 13,
  },
  // Time bar
  timeBar: {
    marginBottom: 20,
    gap: 6,
  },
  timeBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeBarLabel: {
    fontSize: 12,
  },
  timeBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  timeBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  // Explanation card
  explanationCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  explIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  explContent: {
    flex: 1,
  },
  explTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  explBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  // CTA
  ctaButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  animatingRow: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  animatingLabel: {
    fontSize: 14,
    fontStyle: 'italic',
  },
});
