/**
 * FeedbackFormModal - Quick feedback form for review flow
 *
 * Shown when user clicks "It's okay" in the HappinessCheckModal.
 * Simpler than ComprehensiveFeedbackModal - just category + optional text.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, TextInput, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';

import { FeedbackCategory } from '@/lib/types';
import {
  submitQuickFeedback,
  QUICK_FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_CATEGORY_ICONS,
} from '@/lib/feedback';
import { useAppColors } from '@/contexts/ThemeContext';

interface FeedbackFormModalProps {
  visible: boolean;
  onSubmit: () => void;
  onSkip: () => void;
}

export default function FeedbackFormModal({
  visible,
  onSubmit,
  onSkip,
}: FeedbackFormModalProps) {
  const appColors = useAppColors();
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setCategory(null);
      setFeedback('');
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (!category) {
      Toast.show({
        type: 'info',
        text1: 'Please select a category',
        position: 'bottom',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await submitQuickFeedback(
        category,
        feedback.trim() || undefined
      );

      if (result.success) {
        onSubmit();
      } else {
        Toast.show({
          type: 'error',
          text1: 'Failed to submit feedback',
          text2: 'Please try again',
          position: 'bottom',
        });
      }
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Something went wrong',
        position: 'bottom',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={() => {
        // Prevent dismissing by back button
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.overlay}>
          <View style={[styles.modal, { backgroundColor: appColors.surface }]}>
            {/* Header */}
            <View style={styles.header}>
              <MaterialCommunityIcons
                name="comment-question-outline"
                size={28}
                color={appColors.aiPurple}
              />
              <Text style={[styles.title, { color: appColors.textPrimary }]}>Help us improve</Text>
            </View>

            <Text style={[styles.subtitle, { color: appColors.textSecondary }]}>
              What could be better? Select all that apply.
            </Text>

            {/* Category Selection */}
            <View style={styles.categoryGrid}>
              {QUICK_FEEDBACK_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat}
                  style={[
                    styles.categoryChip,
                    { borderColor: appColors.border, backgroundColor: appColors.surface },
                    category === cat && { borderColor: appColors.aiPurple, backgroundColor: `${appColors.aiPurple}10` },
                  ]}
                  onPress={() => setCategory(cat)}
                >
                  <MaterialCommunityIcons
                    name={FEEDBACK_CATEGORY_ICONS[cat] as any}
                    size={18}
                    color={category === cat ? appColors.aiPurple : appColors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.categoryText,
                      { color: appColors.textSecondary },
                      category === cat && { color: appColors.aiPurple, fontWeight: '500' },
                    ]}
                  >
                    {FEEDBACK_CATEGORY_LABELS[cat]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Optional Feedback Text */}
            <TextInput
              mode="outlined"
              placeholder="Tell us more (optional)..."
              value={feedback}
              onChangeText={setFeedback}
              multiline
              numberOfLines={3}
              maxLength={300}
              style={[styles.textInput, { backgroundColor: appColors.surface }]}
              outlineColor={appColors.border}
              activeOutlineColor={appColors.aiPurple}
              textColor={appColors.textPrimary}
              placeholderTextColor={appColors.textTertiary}
            />
            <Text style={[styles.charCount, { color: appColors.textTertiary }]}>{feedback.length}/300</Text>

            {/* Buttons */}
            <View style={styles.buttonsContainer}>
              <Button
                mode="contained"
                onPress={handleSubmit}
                loading={isSubmitting}
                disabled={isSubmitting || !category}
                style={styles.submitButton}
                buttonColor={appColors.aiPurple}
              >
                Send Feedback
              </Button>

              <Pressable
                onPress={onSkip}
                style={styles.skipButton}
                disabled={isSubmitting}
              >
                <Text style={[styles.skipText, { color: appColors.textSecondary }]}>Skip for now</Text>
              </Pressable>
            </View>

            {/* Incentive message */}
            <View style={[styles.incentiveContainer, { borderTopColor: appColors.border }]}>
              <MaterialCommunityIcons
                name="gift-outline"
                size={16}
                color={appColors.aiPurple}
              />
              <Text style={[styles.incentiveText, { color: appColors.aiPurple }]}>
                Get 7 days of Pro free, either way
              </Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 380,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    marginBottom: 20,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  categoryText: {
    fontSize: 14,
  },
  textInput: {
    maxHeight: 100,
  },
  charCount: {
    fontSize: 11,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 16,
  },
  buttonsContainer: {
    gap: 12,
  },
  submitButton: {
    borderRadius: 12,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 15,
  },
  incentiveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  incentiveText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
