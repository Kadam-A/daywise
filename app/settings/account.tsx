/**
 * Account Settings Screen
 *
 * Manages user account including subscription status and account deletion.
 * Account deletion is a legal requirement (GDPR, App Store).
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  TextInput,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { logoutPurchases } from '@/lib/purchases';
import { useAppColors } from '@/contexts/ThemeContext';

// Design System
const COLORS = {
  background: '#F8F9FB',
  surface: '#FFFFFF',
  textPrimary: '#1A1D23',
  textSecondary: '#5C6370',
  textTertiary: '#9CA3AF',
  border: '#E5E7EB',
  error: '#E25555',
  errorLight: '#FEF2F2',
  success: '#5FBF73',
  gradientStart: '#4A90E2',
};

export default function AccountSettingsScreen() {
  const appColors = useAppColors();
  const insets = useSafeAreaInsets();
  const { subscription, isPro, isTrialing, trialDaysRemaining } = useSubscription();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  React.useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUserEmail(user?.email || null);
    };
    fetchUser();
  }, []);

  const resetModal = () => {
    setConfirmingDelete(false);
    setConfirmText('');
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== 'DELETE') return;

    setIsDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      console.log('[DeleteFlow] — calling delete-account edge function');
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const result = await response.json();
      console.log('[DeleteFlow] — edge function response:', result.success, result.error ?? '');
      if (!result.success) throw new Error(result.error || 'Failed to delete account');

      console.log('[DeleteFlow] — deletion complete, signing out');
      await logoutPurchases();
      await supabase.auth.signOut();
      resetModal();
      Alert.alert(
        'Account Deleted',
        'Your account and all data have been permanently deleted.',
        [{ text: 'OK', onPress: () => router.replace('/(auth)/login') }]
      );
    } catch (err) {
      console.error('[Account] Delete error:', err);
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to delete account. Please try again.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleManageSubscription = () => {
    if (isPro || isTrialing) {
      // Would typically link to App Store/Play Store subscription management
      Alert.alert(
        'Manage Subscription',
        'To manage or cancel your subscription, go to your device Settings > Subscriptions.',
        [{ text: 'OK' }]
      );
    } else {
      router.push({ pathname: '/paywall', params: { source: 'account' } });
    }
  };

  const getPlanDisplayName = () => {
    if (isTrialing) {
      return `Pro Trial (${trialDaysRemaining} day${trialDaysRemaining !== 1 ? 's' : ''} left)`;
    }
    if (!subscription || subscription.plan_id === 'free') {
      return 'Free';
    }
    if (subscription.plan_id === 'pro_monthly') {
      return 'Pro Monthly';
    }
    if (subscription.plan_id === 'pro_yearly') {
      return 'Pro Annual';
    }
    return 'Free';
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: appColors.surface, borderBottomColor: appColors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={appColors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: appColors.textPrimary }]}>Account</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        {/* When confirming deletion, show only the confirm card near the top */}
        {confirmingDelete ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: appColors.error }]}>Confirm Deletion</Text>
            <View style={[styles.dangerCard, { backgroundColor: appColors.surface, borderColor: `${appColors.error}40` }]}>
              <Text style={[styles.dangerLabel, { color: appColors.textPrimary, marginBottom: 4 }]}>This cannot be undone</Text>
              <Text style={[styles.dangerDescription, { color: appColors.textSecondary, marginBottom: 16 }]}>
                All your tasks, calendar connections, and settings will be permanently deleted.
              </Text>
              {isPro && (
                <View style={[styles.subscriptionWarning, { backgroundColor: appColors.warningLight }]}>
                  <MaterialCommunityIcons name="information" size={16} color={appColors.textSecondary} />
                  <Text style={[styles.subscriptionWarningText, { color: appColors.textSecondary }]}>
                    Your subscription will be cancelled automatically
                  </Text>
                </View>
              )}
              <Text style={[styles.confirmLabel, { color: appColors.textSecondary, marginBottom: 8 }]}>
                Type <Text style={{ color: appColors.error, fontWeight: '700' }}>DELETE</Text> to confirm
              </Text>
              <TextInput
                style={[styles.deleteConfirmInput, {
                  borderColor: confirmText === 'DELETE' ? appColors.error : appColors.border,
                  color: appColors.textPrimary,
                  backgroundColor: appColors.inputBg,
                }]}
                value={confirmText}
                onChangeText={setConfirmText}
                placeholder="DELETE"
                placeholderTextColor={appColors.textTertiary}
                autoCapitalize="characters"
              />
              <View style={styles.modalActions}>
                <Pressable style={[styles.cancelButton, { backgroundColor: appColors.chipBg }]} onPress={resetModal}>
                  <Text style={[styles.cancelButtonText, { color: appColors.textSecondary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.confirmDeleteButton, { backgroundColor: confirmText === 'DELETE' ? appColors.error : appColors.chipBg }]}
                  onPress={handleDeleteAccount}
                  disabled={isDeleting || confirmText !== 'DELETE'}
                >
                  {isDeleting
                    ? <ActivityIndicator size="small" color="#FFFFFF" />
                    : <Text style={[styles.confirmDeleteButtonText, confirmText !== 'DELETE' && { color: appColors.textTertiary }]}>Delete Forever</Text>
                  }
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          <>
            {/* Account Info */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: appColors.textSecondary }]}>Account Info</Text>
              <View style={[styles.infoCard, { backgroundColor: appColors.surface }]}>
                <View style={styles.infoRow}>
                  <MaterialCommunityIcons name="email-outline" size={20} color={appColors.textSecondary} />
                  <View style={styles.infoContent}>
                    <Text style={[styles.infoLabel, { color: appColors.textTertiary }]}>Email</Text>
                    <Text style={[styles.infoValue, { color: appColors.textPrimary }]}>{userEmail || 'Loading...'}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Subscription */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: appColors.textSecondary }]}>Subscription</Text>
              <View style={[styles.subscriptionCard, { backgroundColor: appColors.surface }]}>
                <View style={styles.subscriptionHeader}>
                  <View style={[
                    styles.planBadge,
                    { backgroundColor: appColors.chipBg },
                    isPro && { backgroundColor: appColors.primary },
                    isTrialing && { backgroundColor: appColors.success },
                  ]}>
                    <Text style={[
                      styles.planBadgeText,
                      { color: appColors.textSecondary },
                      (isPro || isTrialing) && styles.planBadgeTextPro,
                    ]}>
                      {isPro ? 'PRO' : isTrialing ? 'TRIAL' : 'FREE'}
                    </Text>
                  </View>
                  <Text style={[styles.planName, { color: appColors.textPrimary }]}>{getPlanDisplayName()}</Text>
                </View>
                {subscription?.cancel_at_period_end && (
                  <View style={[styles.cancelNotice, { backgroundColor: appColors.errorLight }]}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={18} color={appColors.error} />
                    <Text style={[styles.cancelNoticeText, { color: appColors.error }]}>
                      Subscription will end on {subscription.current_period_end
                        ? new Date(subscription.current_period_end).toLocaleDateString()
                        : 'period end'}
                    </Text>
                  </View>
                )}
                <Pressable style={[styles.manageButton, { borderTopColor: appColors.border }]} onPress={handleManageSubscription}>
                  <Text style={[styles.manageButtonText, { color: appColors.primary }]}>
                    {isPro || isTrialing ? 'Manage Subscription' : 'Upgrade to Pro'}
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={appColors.primary} />
                </Pressable>
              </View>
            </View>

            {/* Danger Zone */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: appColors.error }]}>Danger Zone</Text>
              <View style={[styles.dangerCard, { backgroundColor: appColors.surface, borderColor: `${appColors.error}40` }]}>
                <View style={styles.dangerContent}>
                  <Text style={[styles.dangerLabel, { color: appColors.textPrimary }]}>Delete Account</Text>
                  <Text style={[styles.dangerDescription, { color: appColors.textSecondary }]}>
                    Permanently delete your account and all associated data. This cannot be undone.
                  </Text>
                </View>
                <Pressable style={[styles.deleteButton, { backgroundColor: appColors.error }]} onPress={() => setConfirmingDelete(true)}>
                  <Text style={styles.deleteButtonText}>Delete Account</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  headerSpacer: {
    width: 32,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 20,
    paddingBottom: 40,
  },

  // Sections
  section: {
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Info Card
  infoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },

  // Subscription Card
  subscriptionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
  },
  subscriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  planBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  planBadgePro: {
    backgroundColor: COLORS.gradientStart,
  },
  planBadgeTrial: {
    backgroundColor: COLORS.success,
  },
  planBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  planBadgeTextPro: {
    color: '#FFFFFF',
  },
  planName: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  cancelNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.errorLight,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  cancelNoticeText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.error,
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  manageButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.gradientStart,
  },

  // Danger Zone
  dangerTitle: {
    color: COLORS.error,
  },
  dangerCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  dangerContent: {
    marginBottom: 16,
  },
  dangerLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  dangerDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  deleteButton: {
    backgroundColor: COLORS.error,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  subscriptionWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  subscriptionWarningText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
  },
  confirmLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  deleteConfirmInput: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    marginBottom: 20,
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 4,
    width: '100%',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  confirmDeleteButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: COLORS.error,
    alignItems: 'center',
  },
  confirmDeleteButtonDisabled: {
    backgroundColor: '#F3F4F6',
  },
  confirmDeleteButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
