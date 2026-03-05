/**
 * OfflineBanner - Shows when device is offline
 *
 * Displays at top of screen with subtle animation
 * Shows pending operation count if any
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetwork } from '@/contexts/NetworkContext';
import { useAppColors } from '@/contexts/ThemeContext';

export default function OfflineBanner() {
  const appColors = useAppColors();
  const { top: topInset } = useSafeAreaInsets();
  const { isConnected, isChecking, pendingOperations } = useNetwork();
  const HIDDEN_Y = -120; // large enough to hide banner + any inset
  const slideAnim = useRef(new Animated.Value(HIDDEN_Y)).current;
  const wasOffline = useRef(false);

  useEffect(() => {
    if (isChecking) return;

    if (!isConnected) {
      // Slide in when offline
      wasOffline.current = true;
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 100,
        friction: 10,
        useNativeDriver: true,
      }).start();
    } else if (wasOffline.current) {
      // Show "back online" briefly, then slide out
      Animated.sequence([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.delay(2000),
        Animated.spring(slideAnim, {
          toValue: HIDDEN_Y,
          tension: 100,
          friction: 10,
          useNativeDriver: true,
        }),
      ]).start(() => {
        wasOffline.current = false;
      });
    }
  }, [isConnected, isChecking, slideAnim]);

  // Don't render when online and no offline transition in progress
  if (isConnected && !wasOffline.current) return null;
  if (isChecking && !wasOffline.current) return null;

  const isBackOnline = isConnected && wasOffline.current;

  return (
    <Animated.View
      style={[
        styles.container,
        { top: topInset, transform: [{ translateY: slideAnim }] },
        isBackOnline
          ? { backgroundColor: appColors.successLight }
          : { backgroundColor: appColors.warningLight },
      ]}
    >
      <MaterialCommunityIcons
        name={isBackOnline ? 'wifi-check' : 'wifi-off'}
        size={18}
        color={isBackOnline ? appColors.success : appColors.warning}
      />
      <View style={styles.textContainer}>
        <Text style={[styles.text, { color: isBackOnline ? appColors.success : appColors.warning }]}>
          {isBackOnline ? "You're back online" : "You're offline"}
        </Text>
        {!isConnected && pendingOperations > 0 && (
          <Text style={[styles.subtext, { color: appColors.warning }]}>
            {pendingOperations} change{pendingOperations > 1 ? 's' : ''} pending
          </Text>
        )}
      </View>
      {!isConnected && (
        <Text style={[styles.hint, { color: appColors.warning }]}>
          Changes will sync when connected
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    zIndex: 1000,
  },
  textContainer: {
    flex: 1,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
  subtext: {
    fontSize: 12,
    opacity: 0.8,
    marginTop: 2,
  },
  hint: {
    fontSize: 11,
    opacity: 0.7,
  },
});
