/**
 * HappinessCheckModal - Pre-filter modal before native review
 *
 * Shown after user has completed 5+ tasks and been using app 7+ days.
 * Routes happy users to native review, unhappy users to feedback form.
 */

import React from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { HappinessResponse } from '@/lib/types';
import { useAppColors } from '@/contexts/ThemeContext';

interface HappinessCheckModalProps {
  visible: boolean;
  onResponse: (response: HappinessResponse) => void;
  tasksCompleted?: number;
}

export default function HappinessCheckModal({
  visible,
  onResponse,
  tasksCompleted = 5,
}: HappinessCheckModalProps) {
  const appColors = useAppColors();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={true}
      onRequestClose={() => {
        // Prevent dismissing by back button - user must choose
      }}
    >
      <View style={styles.overlay}>
        <View style={[styles.modal, { backgroundColor: appColors.surface }]}>
          {/* Celebration Icon */}
          <View style={styles.iconContainer}>
            <LinearGradient
              colors={[appColors.gradientStart, appColors.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.iconGradient}
            >
              <MaterialCommunityIcons
                name="party-popper"
                size={40}
                color="#FFFFFF"
              />
            </LinearGradient>
          </View>

          {/* Congratulations */}
          <Text style={[styles.title, { color: appColors.textPrimary }]}>
            {tasksCompleted} tasks done!
          </Text>

          <Text style={[styles.subtitle, { color: appColors.textSecondary }]}>
            You're making great progress
          </Text>

          {/* Question */}
          <Text style={[styles.question, { color: appColors.textPrimary }]}>
            How's DayWise working for you?
          </Text>

          {/* Response Buttons */}
          <View style={styles.buttonsContainer}>
            <Pressable
              style={styles.responseButton}
              onPress={() => onResponse('loving_it')}
            >
              <LinearGradient
                colors={[appColors.gradientStart, appColors.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.lovingItGradient}
              >
                <MaterialCommunityIcons
                  name="heart"
                  size={24}
                  color="#FFFFFF"
                />
                <Text style={styles.lovingItText}>Loving it!</Text>
              </LinearGradient>
            </Pressable>

            <Pressable
              style={[styles.responseButton, styles.itsOkayButton, { backgroundColor: appColors.inputBg, borderColor: appColors.border }]}
              onPress={() => onResponse('its_okay')}
            >
              <MaterialCommunityIcons
                name="emoticon-neutral-outline"
                size={24}
                color={appColors.textSecondary}
              />
              <Text style={[styles.itsOkayText, { color: appColors.textSecondary }]}>It's okay</Text>
            </Pressable>
          </View>

          {/* Helper text */}
          <Text style={[styles.helperText, { color: appColors.textTertiary }]}>
            Your feedback helps us improve
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 20,
  },
  iconGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  question: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  buttonsContainer: {
    width: '100%',
    gap: 12,
  },
  responseButton: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  lovingItGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 10,
  },
  lovingItText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  itsOkayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 10,
    borderWidth: 1,
  },
  itsOkayText: {
    fontSize: 17,
    fontWeight: '600',
  },
  helperText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 20,
  },
});
