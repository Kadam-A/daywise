/**
 * TourTooltip
 *
 * Bottom-sheet tooltip for guided tour. Does NOT block the screen —
 * pointerEvents="box-none" on outer wrapper so users can tap through.
 * Springs up from bottom. Pulsing accent line at top.
 *
 * Key design decisions:
 * - Component stays mounted (never returns null) so exit animation plays fully
 * - showUpArrow adds a bouncing chevron above the card pointing to UI above
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppColors } from '@/contexts/ThemeContext';

interface TourTooltipProps {
  visible: boolean;
  icon: string;
  iconColor?: string;
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
  onSkip?: () => void;
  showSkip?: boolean;
  /** Show a bouncing up-arrow above the card pointing at content above */
  showUpArrow?: boolean;
  /** Extra bottom padding so the tooltip floats above something (e.g. FAB) */
  bottomOffset?: number;
}

export default function TourTooltip({
  visible,
  icon,
  iconColor,
  title,
  body,
  ctaLabel,
  onCta,
  onSkip,
  showSkip = false,
  showUpArrow = false,
  bottomOffset = 0,
}: TourTooltipProps) {
  const appColors = useAppColors();
  const iconBgColor = iconColor ?? appColors.primary;

  const translateY = useRef(new Animated.Value(300)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const accentOpacity = useRef(new Animated.Value(1)).current;
  const arrowBounce = useRef(new Animated.Value(0)).current;
  const accentLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const arrowLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (visible) {
      // Slide in with a gentler spring (less bounce = no glitch)
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          tension: 120,
          friction: 14,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();

      // Accent line pulse
      accentLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(accentOpacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(accentOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      accentLoopRef.current.start();

      // Bouncing arrow — loops: drop 8px, bounce back
      if (showUpArrow) {
        arrowLoopRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(arrowBounce, { toValue: -10, duration: 400, useNativeDriver: true }),
            Animated.timing(arrowBounce, { toValue: 0, duration: 400, useNativeDriver: true }),
            Animated.delay(300),
          ])
        );
        arrowLoopRef.current.start();
      }
    } else {
      // Slide out — component stays mounted so this actually plays
      Animated.parallel([
        Animated.timing(translateY, { toValue: 300, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
      accentLoopRef.current?.stop();
      arrowLoopRef.current?.stop();
      arrowBounce.setValue(0);
    }
    return () => {
      accentLoopRef.current?.stop();
      arrowLoopRef.current?.stop();
    };
  }, [visible]);

  // Always render — never unmount mid-animation.
  // pointerEvents controls interactivity.
  return (
    <View
      style={[styles.outerWrapper, bottomOffset ? { paddingBottom: 28 + bottomOffset } : undefined]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      {/* Bouncing up-arrow above the card */}
      {showUpArrow && (
        <Animated.View
          style={[
            styles.arrowContainer,
            { transform: [{ translateY: arrowBounce }], opacity },
          ]}
          pointerEvents="none"
        >
          <View style={[styles.arrowBadge, { backgroundColor: `${iconBgColor}22` }]}>
            <MaterialCommunityIcons name="chevron-up" size={22} color={iconBgColor} />
          </View>
        </Animated.View>
      )}

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: appColors.surface,
            borderColor: appColors.border,
            shadowColor: appColors.textPrimary,
            opacity,
            transform: [{ translateY }],
          },
        ]}
        pointerEvents="auto"
      >
        {/* Pulsing accent line */}
        <Animated.View
          style={[
            styles.accentLine,
            { backgroundColor: iconBgColor, opacity: accentOpacity },
          ]}
        />

        <View style={styles.content}>
          {/* Icon badge */}
          <View style={[styles.iconBadge, { backgroundColor: `${iconBgColor}22` }]}>
            <MaterialCommunityIcons
              name={icon as any}
              size={28}
              color={iconBgColor}
            />
          </View>

          <View style={styles.textBlock}>
            <Text style={[styles.title, { color: appColors.textPrimary }]}>{title}</Text>
            <Text style={[styles.body, { color: appColors.textSecondary }]}>{body}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Pressable
            style={[styles.ctaButton, { backgroundColor: iconBgColor }]}
            onPress={onCta}
          >
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          </Pressable>

          {showSkip && onSkip && (
            <Pressable onPress={onSkip} hitSlop={8} style={styles.skipButton}>
              <Text style={[styles.skipLabel, { color: appColors.textTertiary }]}>Skip tour</Text>
            </Pressable>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingHorizontal: 12,
    paddingBottom: 28,
  },
  arrowContainer: {
    alignItems: 'center',
    marginBottom: 6,
  },
  arrowBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  accentLine: {
    height: 3,
    borderRadius: 2,
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    paddingTop: 12,
    gap: 12,
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
    lineHeight: 22,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  ctaButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  ctaLabel: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  skipButton: {
    paddingHorizontal: 4,
  },
  skipLabel: {
    fontSize: 13,
  },
});
