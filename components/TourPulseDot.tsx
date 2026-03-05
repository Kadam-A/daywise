/**
 * TourPulseDot
 *
 * Pulsing indicator dot placed next to target fields during guided tour.
 * Two layers: solid inner dot + fading outer ring.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { useAppColors } from '@/contexts/ThemeContext';

interface TourPulseDotProps {
  visible: boolean;
  color?: string;
  size?: number;
}

export default function TourPulseDot({ visible, color, size = 10 }: TourPulseDotProps) {
  const appColors = useAppColors();
  const dotColor = color ?? appColors.primary;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(1);
      opacityAnim.setValue(1);
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(scaleAnim, { toValue: 1.5, duration: 600, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(scaleAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          ]),
        ])
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      scaleAnim.setValue(1);
      opacityAnim.setValue(1);
    }
    return () => {
      loopRef.current?.stop();
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={[styles.container, { width: size * 2.4, height: size * 2.4 }]}>
      {/* Outer fading ring */}
      <Animated.View
        style={[
          styles.outerRing,
          {
            width: size * 2.4,
            height: size * 2.4,
            borderRadius: size * 1.2,
            backgroundColor: dotColor,
            opacity: opacityAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      />
      {/* Inner solid dot */}
      <View
        style={[
          styles.innerDot,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: dotColor,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRing: {
    position: 'absolute',
  },
  innerDot: {
    position: 'absolute',
  },
});
