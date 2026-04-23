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
 * - pages[] enables a paginated slide view within the same sheet
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Animated,
  Dimensions,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppColors } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_WIDTH = Dimensions.get('window').width;

export interface TourPage {
  icon: string;
  iconColor: string;
  title: string;
  body: string | React.ReactNode;
}

interface TourTooltipProps {
  visible: boolean;
  icon: string;
  iconColor?: string;
  title: string;
  body: string | React.ReactNode;
  ctaLabel: string;
  onCta: () => void;
  onSkip?: () => void;
  showSkip?: boolean;
  /** Show a bouncing up-arrow above the card pointing at content above */
  showUpArrow?: boolean;
  /** Extra bottom padding so the tooltip floats above something (e.g. FAB) */
  bottomOffset?: number;
  /** Extra top padding when position is 'top' — pushes tooltip down from the top edge */
  topOffset?: number;
  /** Pin to top of screen instead of bottom — use when tooltip would cover content below */
  position?: 'top' | 'bottom';
  /** Multi-page mode — replaces icon/title/body with paginated slides */
  pages?: TourPage[];
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
  topOffset = 0,
  position = 'bottom',
  pages,
}: TourTooltipProps) {
  const appColors = useAppColors();
  const insets = useSafeAreaInsets();

  // Paged state
  const [pageIndex, setPageIndex] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const isMultiPage = pages && pages.length > 1;
  const currentPage = isMultiPage ? pages![pageIndex] : null;
  const activeIconColor = currentPage?.iconColor ?? iconColor ?? appColors.primary;

  const offscreen = position === 'top' ? -300 : 300;
  const translateY = useRef(new Animated.Value(offscreen)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const accentOpacity = useRef(new Animated.Value(1)).current;
  const arrowBounce = useRef(new Animated.Value(0)).current;
  const accentLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const arrowLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Reset page when tooltip becomes visible
  useEffect(() => {
    if (visible) setPageIndex(0);
  }, [visible]);

  useEffect(() => {
    if (visible) {
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

      accentLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(accentOpacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(accentOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      accentLoopRef.current.start();

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
      Animated.parallel([
        Animated.timing(translateY, { toValue: offscreen, duration: 220, useNativeDriver: true }),
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

  const goToPage = (next: number) => {
    const direction = next > pageIndex ? -1 : 1;
    // Slide out current
    Animated.timing(slideAnim, {
      toValue: direction * (SCREEN_WIDTH * 0.7),
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      setPageIndex(next);
      slideAnim.setValue(-direction * (SCREEN_WIDTH * 0.7));
      // Slide in next
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 160,
        friction: 18,
        useNativeDriver: true,
      }).start();
    });
  };

  const handleCta = () => {
    if (isMultiPage && pageIndex < pages!.length - 1) {
      goToPage(pageIndex + 1);
    } else {
      onCta();
    }
  };

  const ctaButtonColor = activeIconColor;
  const ctaText = isMultiPage && pageIndex < pages!.length - 1 ? 'Next' : ctaLabel;

  const renderBody = (b: string | React.ReactNode) =>
    typeof b === 'string'
      ? <Text style={[styles.body, { color: appColors.textSecondary }]}>{b}</Text>
      : <View style={styles.body}>{b}</View>;

  return (
    <View
      style={[
        styles.outerWrapper,
        position === 'top' ? [styles.outerWrapperTop, { paddingTop: insets.top + 8 + topOffset }] : styles.outerWrapperBottom,
        position === 'bottom' ? { paddingBottom: insets.bottom + 16 + bottomOffset } : undefined,
      ]}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      {showUpArrow && (
        <Animated.View
          style={[styles.arrowContainer, { transform: [{ translateY: arrowBounce }], opacity }]}
          pointerEvents="none"
        >
          <View style={[styles.arrowBadge, { backgroundColor: `${activeIconColor}22` }]}>
            <MaterialCommunityIcons name="chevron-up" size={22} color={activeIconColor} />
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
            opacity: position === 'top' ? opacity.interpolate({ inputRange: [0, 1], outputRange: [0, 0.93] }) : opacity,
            transform: [{ translateY }],
          },
        ]}
        pointerEvents="auto"
      >
        {/* Pulsing accent line — colour changes per page */}
        <Animated.View
          style={[styles.accentLine, { backgroundColor: activeIconColor, opacity: accentOpacity }]}
        />

        {/* Paginated content */}
        {isMultiPage ? (
          <Animated.View style={[styles.content, { transform: [{ translateX: slideAnim }] }]}>
            <View style={[styles.iconBadge, { backgroundColor: `${currentPage!.iconColor}22` }]}>
              <MaterialCommunityIcons name={currentPage!.icon as any} size={28} color={currentPage!.iconColor} />
            </View>
            <View style={styles.textBlock}>
              <Text style={[styles.title, { color: appColors.textPrimary }]}>{currentPage!.title}</Text>
              {renderBody(currentPage!.body)}
            </View>
          </Animated.View>
        ) : (
          <View style={styles.content}>
            <View style={[styles.iconBadge, { backgroundColor: `${activeIconColor}22` }]}>
              <MaterialCommunityIcons name={icon as any} size={28} color={activeIconColor} />
            </View>
            <View style={styles.textBlock}>
              <Text style={[styles.title, { color: appColors.textPrimary }]}>{title}</Text>
              {renderBody(body)}
            </View>
          </View>
        )}

        {/* Page dots */}
        {isMultiPage && (
          <View style={styles.dotsRow}>
            {pages!.map((p, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { backgroundColor: i === pageIndex ? p.iconColor : appColors.border },
                  i === pageIndex && styles.dotActive,
                ]}
              />
            ))}
          </View>
        )}

        <View style={styles.footer}>
          <Pressable
            style={[styles.ctaButton, { backgroundColor: ctaButtonColor }]}
            onPress={handleCta}
          >
            <Text style={styles.ctaLabel}>{ctaText}</Text>
            {isMultiPage && pageIndex < pages!.length - 1 && (
              <MaterialCommunityIcons name="arrow-right" size={16} color="#FFFFFF" style={{ marginLeft: 4 }} />
            )}
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
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingHorizontal: 12,
  },
  outerWrapperBottom: {
    bottom: 0,
  },
  outerWrapperTop: {
    top: 0,
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
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 18,
    borderRadius: 3,
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
    flexDirection: 'row',
    justifyContent: 'center',
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
