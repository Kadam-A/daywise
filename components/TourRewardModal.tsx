/**
 * TourRewardModal
 *
 * Full blocking overlay shown after first AI-scheduled task.
 * Confetti animation + tip about due dates.
 */

import React, { useEffect, useMemo } from 'react';
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

// ─── Confetti ─────────────────────────────────────────────────────────────────

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
      <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.65)' }]}>
        <Confetti />
        <View style={[styles.card, { backgroundColor: appColors.surface }]}>

          {/* Purple accent bar at top */}
          <View style={[styles.accentBar, { backgroundColor: appColors.secondary }]} />

          {/* Icon */}
          <View style={styles.iconWrapper}>
            <View style={[styles.iconRing, { borderColor: `${appColors.secondary}30` }]}>
              <View style={[styles.iconCircle, { backgroundColor: `${appColors.secondary}18` }]}>
                <MaterialCommunityIcons name="brain" size={48} color={appColors.secondary} />
              </View>
            </View>
          </View>

          <Text style={[styles.headline, { color: appColors.textPrimary }]}>
            Task scheduled!
          </Text>
          <Text style={[styles.sub, { color: appColors.textSecondary }]}>
            Always set a due date when adding tasks. The AI uses it to prioritise your day and make sure nothing slips through.
          </Text>

          {/* Tip row with left accent border */}
          <View style={[styles.tipRow, { backgroundColor: `${appColors.secondary}10`, borderLeftColor: appColors.secondary }]}>
            <MaterialCommunityIcons name="lightbulb-outline" size={16} color={appColors.secondary} />
            <Text style={[styles.tipText, { color: appColors.textSecondary }]}>
              Tighter deadlines = higher priority in your schedule
            </Text>
          </View>

          <Pressable
            style={[styles.ctaButton, { backgroundColor: appColors.secondary }]}
            onPress={onCta}
          >
            <MaterialCommunityIcons name="arrow-right" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
            <Text style={styles.ctaLabel}>Got it, keep going</Text>
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
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
    paddingBottom: 28,
  },
  accentBar: {
    height: 4,
    alignSelf: 'stretch',
    marginBottom: 28,
  },
  iconWrapper: {
    marginBottom: 20,
  },
  iconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  sub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
    paddingHorizontal: 28,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderLeftWidth: 3,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 24,
    marginHorizontal: 28,
    alignSelf: 'stretch',
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 14,
    marginHorizontal: 28,
    alignSelf: 'stretch',
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
});
