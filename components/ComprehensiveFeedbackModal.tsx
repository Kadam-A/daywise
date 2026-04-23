/**
 * ComprehensiveFeedbackModal - Full feedback form for Settings
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TextInput,
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';

import { FeedbackCategory } from '@/lib/types';
import {
  submitComprehensiveFeedback,
  COMPREHENSIVE_FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_CATEGORY_ICONS,
} from '@/lib/feedback';
import { useAppColors } from '@/contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ComprehensiveFeedbackModalProps {
  visible: boolean;
  onClose: () => void;
  initialCategory?: FeedbackCategory;
}

export default function ComprehensiveFeedbackModal({
  visible,
  onClose,
  initialCategory,
}: ComprehensiveFeedbackModalProps) {
  const appColors = useAppColors();
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<FeedbackCategory | null>(initialCategory || null);
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCategory(initialCategory || null);
      setDescription('');
      setEmail('');
      setError(null);
    }
  }, [visible, initialCategory]);

  const handleSubmit = async () => {
    if (!category) {
      setError('Please select a category');
      return;
    }
    if (description.trim().length < 10) {
      setError('Please provide more details (at least 10 characters)');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const result = await submitComprehensiveFeedback(category, description.trim(), {
        email: email.trim() || undefined,
      });

      if (result.success) {
        Toast.show({
          type: 'success',
          text1: 'Thanks for your feedback!',
          text2: 'We appreciate you helping us improve.',
          position: 'bottom',
        });
        onClose();
      } else {
        setError(result.error || 'Failed to submit feedback');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.overlay}>
          <View style={[styles.modal, { backgroundColor: appColors.surface }]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: appColors.border }]}>
              <Text style={[styles.title, { color: appColors.textPrimary }]}>Send Feedback</Text>
              <Pressable onPress={onClose} style={styles.closeButton}>
                <MaterialCommunityIcons name="close" size={24} color={appColors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Category Selection */}
              <Text style={[styles.label, { color: appColors.textPrimary }]}>What's this about?</Text>
              <View style={styles.categoryGrid}>
                {COMPREHENSIVE_FEEDBACK_CATEGORIES.map((cat) => (
                  <Pressable
                    key={cat}
                    style={[
                      styles.categoryButton,
                      { borderColor: appColors.border, backgroundColor: appColors.chipBg },
                      category === cat && { borderColor: appColors.aiPurple, backgroundColor: `${appColors.aiPurple}12` },
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
                        category === cat && { color: appColors.aiPurple, fontWeight: '600' },
                      ]}
                      numberOfLines={2}
                    >
                      {FEEDBACK_CATEGORY_LABELS[cat]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Description */}
              <Text style={[styles.label, { color: appColors.textPrimary }]}>Tell us more *</Text>
              <View style={[styles.inputBox, { backgroundColor: appColors.chipBg, borderColor: appColors.border }]}>
                <TextInput
                  placeholder="Describe your feedback in detail..."
                  placeholderTextColor={appColors.textTertiary}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={5}
                  maxLength={500}
                  style={[styles.textArea, { color: appColors.textPrimary }]}
                  textAlignVertical="top"
                />
              </View>
              <Text style={[styles.charCount, { color: appColors.textTertiary }]}>
                {description.length}/500
              </Text>

              {/* Email */}
              <Text style={[styles.label, { color: appColors.textPrimary }]}>Email (optional)</Text>
              <View style={[styles.inputBox, { backgroundColor: appColors.chipBg, borderColor: appColors.border }]}>
                <TextInput
                  placeholder="your@email.com"
                  placeholderTextColor={appColors.textTertiary}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[styles.singleInput, { color: appColors.textPrimary }]}
                />
              </View>
              <Text style={[styles.hint, { color: appColors.textTertiary }]}>
                We'll only use this to follow up on your feedback
              </Text>

              {/* Error */}
              {error && (
                <View style={[styles.errorContainer, { backgroundColor: `${appColors.error}10` }]}>
                  <MaterialCommunityIcons name="alert-circle" size={18} color={appColors.error} />
                  <Text style={[styles.errorText, { color: appColors.error }]}>{error}</Text>
                </View>
              )}
            </ScrollView>

            {/* Footer */}
            <View style={[styles.footer, { borderTopColor: appColors.border, paddingBottom: insets.bottom + 12 }]}>
              <Button
                mode="outlined"
                onPress={onClose}
                style={[styles.cancelButton, { borderColor: appColors.border }]}
                textColor={appColors.textSecondary}
              >
                Cancel
              </Button>
              <Button
                mode="contained"
                onPress={handleSubmit}
                loading={isSubmitting}
                disabled={isSubmitting}
                style={styles.submitButton}
                buttonColor={appColors.aiPurple}
              >
                Send Feedback
              </Button>
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
    justifyContent: 'flex-end',
  },
  modal: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    maxHeight: 500,
  },
  contentContainer: {
    padding: 20,
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  categoryText: {
    fontSize: 13,
    maxWidth: 100,
  },
  inputBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  textArea: {
    fontSize: 14,
    minHeight: 100,
    lineHeight: 20,
  },
  singleInput: {
    fontSize: 14,
    paddingVertical: 4,
  },
  charCount: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
    marginTop: 4,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  cancelButton: {
    flex: 1,
  },
  submitButton: {
    flex: 2,
  },
});
