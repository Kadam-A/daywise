/**
 * TourRewardModal
 *
 * Full blocking overlay shown after first AI-scheduled task.
 * Confetti animation + AI usage visual bar.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Animated,
  Easing,
  Pressable,
  StyleSheet as RNStyleSheet,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppColors } from '@/contexts/ThemeContext';

// ─── Confetti (32 particles, same pattern as onboarding.tsx) ──────────────────

const CONFETTI_COLORS = ['#4A90E2', '#7C6FBF', '#5FBF73', '#F5A962', '#E25555', '#F472B6'];

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
    <View style={RNStyleSheet.absoluteFillObject} pointerEvents="none">
      {particles.map((p) => (
        <Animated.View key={p.id} style={{
          position: 'absolute', left: p.x, top: 0,
          width: p.size, height: p.size, borderRadius: p.size / 2,
          backgroundColor: p.color, opacity: p.opacity,
          transform: [{ translateY: p.translateY }],
        }} />
      ))}
    </View>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface TourRewardModalProps {
  visible: boolean;
  onCta: () => void;
}

export default function TourRewardModal({ visible, onCta }: TourRewardModalProps) {
  const appColors = useAppColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
        <Confetti />
        <View style={[styles.card, { backgroundColor: appColors.surface }]}>
          {/* Large gift icon */}
          <View style={[styles.iconCircle, { backgroundColor: `${appColors.primary}20` }]}>
            <MaterialCommunityIcons name="gift" size={52} color={appColors.primary} />
          </View>

          <Text style={[styles.headline, { color: appColors.textPrimary }]}>
            AI schedule used!
          </Text>
          <Text style={[styles.sub, { color: appColors.textSecondary }]}>
            Your AI credits recharge throughout the day. You have plenty more to go.
          </Text>

          {/* 3/3 filled circles visual bar */}
          <View style={styles.creditRow}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={[
                  styles.creditDot,
                  { backgroundColor: appColors.success, borderColor: appColors.success },
                ]}
              >
                <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" />
              </View>
            ))}
          </View>
          <Text style={[styles.creditLabel, { color: appColors.textTertiary }]}>
            3/3 AI schedules — recharged
          </Text>

          <Pressable
            style={[styles.ctaButton, { backgroundColor: appColors.primary }]}
            onPress={onCta}
          >
            <Text style={styles.ctaLabel}>Got it — keep going</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  headline: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8,
  },
  sub: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  creditRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  creditDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creditLabel: {
    fontSize: 13,
    marginBottom: 28,
  },
  ctaButton: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
});
