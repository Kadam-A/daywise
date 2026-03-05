/**
 * Paywall Screen
 *
 * Clean, non-pushy subscription screen with clear pricing.
 * Shows Free vs Pro comparison and handles purchases via RevenueCat.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { PurchasesPackage } from 'react-native-purchases';
import {
  getPackages,
  purchasePackage,
  restorePurchases,
  startFreeTrial,
  formatPrice,
  getYearlySavings,
  PRODUCT_IDS,
} from '@/lib/purchases';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { trackPaywallViewed, trackPaywallDismissed } from '@/lib/analytics';
import { useAppColors } from '@/contexts/ThemeContext';

// Design System
const COLORS = {
  gradientStart: '#4A90E2',
  gradientEnd: '#7C6FBF',
  background: '#F8F9FB',
  surface: '#FFFFFF',
  textPrimary: '#1A1D23',
  textSecondary: '#5C6370',
  textTertiary: '#9CA3AF',
  border: '#E5E7EB',
  success: '#5FBF73',
  aiPurple: '#7C6FBF',
  aiPurpleLight: '#E8E5F5',
};

interface FeatureRow {
  icon: string;
  title: string;
  free: string | boolean;
  pro: string | boolean;
}

const FEATURES: FeatureRow[] = [
  { icon: 'brain', title: 'AI Scheduling', free: '3/week', pro: 'Unlimited' },
  { icon: 'calendar-check', title: 'Local Scheduling', free: true, pro: true },
  { icon: 'repeat', title: 'Recurring Tasks', free: '3 max', pro: 'Unlimited' },
  { icon: 'history', title: 'Task History', free: '30 days', pro: 'Unlimited' },
  { icon: 'clock-edit-outline', title: 'Auto-Reschedule', free: '1/week', pro: 'Unlimited' },
  { icon: 'google', title: 'Google Calendar Sync', free: false, pro: true },
  { icon: 'chart-line', title: 'Advanced Analytics', free: false, pro: true },
];

export default function PaywallScreen() {
  const appColors = useAppColors();
  const { refresh, isTrialing, trialDaysRemaining } = useSubscription();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('yearly');
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    trackPaywallViewed();
    loadPackages();
  }, []);

  const loadPackages = async () => {
    try {
      const availablePackages = await getPackages();
      setPackages(availablePackages);
    } catch (err) {
      console.error('[Paywall] Error loading packages:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    trackPaywallDismissed();
    router.back();
  };

  const monthlyPackage = packages.find(
    (p) => p.identifier.includes('monthly') || p.product.identifier === PRODUCT_IDS.PRO_MONTHLY
  );
  const yearlyPackage = packages.find(
    (p) => p.identifier.includes('yearly') || p.identifier.includes('annual') || p.product.identifier === PRODUCT_IDS.PRO_YEARLY
  );

  const selectedPackage = selectedPlan === 'monthly' ? monthlyPackage : yearlyPackage;
  const yearlySavings = monthlyPackage && yearlyPackage
    ? getYearlySavings(monthlyPackage, yearlyPackage)
    : 29;

  const handlePurchase = async () => {
    if (!selectedPackage) {
      Alert.alert('Error', 'Please select a plan');
      return;
    }

    setIsPurchasing(true);
    try {
      const result = await purchasePackage(selectedPackage);

      if (result.success) {
        await refresh();
        Alert.alert('Success', 'Welcome to DayWise Pro!', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else if (result.error !== 'cancelled') {
        Alert.alert('Purchase Failed', result.error || 'Please try again');
      }
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleStartTrial = async () => {
    setIsPurchasing(true);
    try {
      const result = await startFreeTrial();

      if (result.success) {
        await refresh();
        Alert.alert('Trial Started!', 'You have 7 days of Pro features. No credit card required.', [
          { text: 'Get Started', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Error', result.error || 'Could not start trial');
      }
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    try {
      const result = await restorePurchases();

      if (result.success) {
        await refresh();
        Alert.alert('Restored!', 'Your subscription has been restored.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('No Subscription Found', result.error || 'No active subscription to restore');
      }
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appColors.background }]} edges={['top', 'bottom']}>
      {/* Close Button */}
      <Pressable style={[styles.closeButton, { backgroundColor: appColors.surface }]} onPress={handleClose}>
        <MaterialCommunityIcons name="close" size={24} color={appColors.textSecondary} />
      </Pressable>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <LinearGradient
            colors={[COLORS.gradientStart, COLORS.gradientEnd]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconContainer}
          >
            <MaterialCommunityIcons name="robot-outline" size={40} color="#FFFFFF" />
          </LinearGradient>
          <Text style={[styles.title, { color: appColors.textPrimary }]}>Unlock AI Scheduling</Text>
          <Text style={[styles.subtitle, { color: appColors.textSecondary }]}>
            Let AI find your perfect time based on your energy patterns
          </Text>
        </View>

        {/* Trial Badge */}
        {!isTrialing && (
          <View style={[styles.trialBadge, { backgroundColor: appColors.secondaryLight }]}>
            <MaterialCommunityIcons name="gift-outline" size={18} color={appColors.secondary} />
            <Text style={[styles.trialBadgeText, { color: appColors.secondary }]}>7-day free trial • No credit card required</Text>
          </View>
        )}

        {/* Already on trial */}
        {isTrialing && trialDaysRemaining !== null && (
          <View style={[styles.trialBadge, { backgroundColor: appColors.successLight }]}>
            <MaterialCommunityIcons name="clock-outline" size={18} color={appColors.success} />
            <Text style={[styles.trialBadgeText, { color: COLORS.success }]}>
              {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} left in trial
            </Text>
          </View>
        )}

        {/* Plan Selection */}
        <View style={styles.planSection}>
          <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>Choose your plan</Text>

          {isLoading ? (
            <ActivityIndicator size="large" color={appColors.primary} style={{ marginVertical: 20 }} />
          ) : (
            <View style={styles.planCards}>
              {/* Yearly Plan */}
              <Pressable
                style={[styles.planCard, { backgroundColor: appColors.surface, borderColor: appColors.border }, selectedPlan === 'yearly' && { borderColor: appColors.primary, backgroundColor: `${appColors.primary}08` }]}
                onPress={() => setSelectedPlan('yearly')}
              >
                <View style={[styles.savingsBadge, { backgroundColor: appColors.success }]}>
                  <Text style={styles.savingsText}>Save {yearlySavings}%</Text>
                </View>
                <View style={styles.planCardContent}>
                  <Text style={[styles.planName, { color: appColors.textPrimary }]}>Annual</Text>
                  <Text style={[styles.planPrice, { color: appColors.textPrimary }]}>
                    {yearlyPackage ? formatPrice(yearlyPackage) : '$59.99'}/year
                  </Text>
                  <Text style={[styles.planPriceMonthly, { color: appColors.textTertiary }]}>
                    ~{yearlyPackage ? `$${(yearlyPackage.product.price / 12).toFixed(2)}` : '$5.00'}/month
                  </Text>
                </View>
                {selectedPlan === 'yearly' && (
                  <MaterialCommunityIcons name="check-circle" size={24} color={appColors.primary} />
                )}
              </Pressable>

              {/* Monthly Plan */}
              <Pressable
                style={[styles.planCard, { backgroundColor: appColors.surface, borderColor: appColors.border }, selectedPlan === 'monthly' && { borderColor: appColors.primary, backgroundColor: `${appColors.primary}08` }]}
                onPress={() => setSelectedPlan('monthly')}
              >
                <View style={styles.planCardContent}>
                  <Text style={[styles.planName, { color: appColors.textPrimary }]}>Monthly</Text>
                  <Text style={[styles.planPrice, { color: appColors.textPrimary }]}>
                    {monthlyPackage ? formatPrice(monthlyPackage) : '$6.99'}/month
                  </Text>
                </View>
                {selectedPlan === 'monthly' && (
                  <MaterialCommunityIcons name="check-circle" size={24} color={appColors.primary} />
                )}
              </Pressable>
            </View>
          )}
        </View>

        {/* Features Comparison */}
        <View style={styles.featuresSection}>
          <Text style={[styles.sectionTitle, { color: appColors.textPrimary }]}>What you get</Text>
          <View style={[styles.featureTable, { backgroundColor: appColors.surface }]}>
            {/* Header */}
            <View style={[styles.featureHeaderRow, { backgroundColor: appColors.inputBg }]}>
              <View style={styles.featureNameCol} />
              <View style={styles.featureValueCol}>
                <Text style={[styles.featureHeaderText, { color: appColors.textSecondary }]}>Free</Text>
              </View>
              <View style={styles.featureValueCol}>
                <LinearGradient
                  colors={[COLORS.gradientStart, COLORS.gradientEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.proHeader}
                >
                  <Text style={styles.proHeaderText}>Pro</Text>
                </LinearGradient>
              </View>
            </View>

            {/* Rows */}
            {FEATURES.map((feature, index) => (
              <View key={index} style={[styles.featureRow, { borderBottomColor: appColors.border }]}>
                <View style={styles.featureNameCol}>
                  <MaterialCommunityIcons
                    name={feature.icon as any}
                    size={18}
                    color={appColors.textSecondary}
                  />
                  <Text style={[styles.featureName, { color: appColors.textPrimary }]}>{feature.title}</Text>
                </View>
                <View style={styles.featureValueCol}>
                  {typeof feature.free === 'boolean' ? (
                    <MaterialCommunityIcons
                      name={feature.free ? 'check' : 'close'}
                      size={20}
                      color={feature.free ? appColors.success : appColors.textTertiary}
                    />
                  ) : (
                    <Text style={[styles.featureValue, { color: appColors.textSecondary }]}>{feature.free}</Text>
                  )}
                </View>
                <View style={styles.featureValueCol}>
                  {typeof feature.pro === 'boolean' ? (
                    <MaterialCommunityIcons
                      name="check"
                      size={20}
                      color={appColors.success}
                    />
                  ) : (
                    <Text style={[styles.featureValue, { color: appColors.secondary, fontWeight: '600' }]}>{feature.pro}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Social Proof */}
        <View style={styles.socialProof}>
          <MaterialCommunityIcons name="account-group" size={20} color={COLORS.textTertiary} />
          <Text style={styles.socialProofText}>Join 10,000+ users who schedule smarter</Text>
        </View>
      </ScrollView>

      {/* Bottom Actions */}
      <View style={[styles.bottomActions, { backgroundColor: appColors.surface, borderTopColor: appColors.border }]}>
        {/* Main CTA */}
        {!isTrialing ? (
          <Pressable
            style={styles.trialButton}
            onPress={handleStartTrial}
            disabled={isPurchasing}
          >
            <LinearGradient
              colors={[COLORS.gradientStart, COLORS.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.trialButtonGradient}
            >
              {isPurchasing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.trialButtonText}>Start 7-Day Free Trial</Text>
                  <Text style={styles.trialButtonSubtext}>No credit card required</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable
            style={styles.trialButton}
            onPress={handlePurchase}
            disabled={isPurchasing || !selectedPackage}
          >
            <LinearGradient
              colors={[COLORS.gradientStart, COLORS.gradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.trialButtonGradient}
            >
              {isPurchasing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.trialButtonText}>
                  Subscribe {selectedPlan === 'yearly' ? 'Annually' : 'Monthly'}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
        )}

        {/* Secondary actions */}
        <View style={styles.secondaryActions}>
          <Pressable onPress={handleRestore} disabled={isRestoring}>
            <Text style={[styles.restoreText, { color: appColors.primary }]}>
              {isRestoring ? 'Restoring...' : 'Restore Purchases'}
            </Text>
          </Pressable>
          <Text style={[styles.dot, { color: appColors.textTertiary }]}>•</Text>
          <Pressable>
            <Text style={[styles.termsText, { color: appColors.textTertiary }]}>Terms</Text>
          </Pressable>
          <Text style={[styles.dot, { color: appColors.textTertiary }]}>•</Text>
          <Pressable>
            <Text style={[styles.termsText, { color: appColors.textTertiary }]}>Privacy</Text>
          </Pressable>
        </View>

        {/* Free forever note */}
        <Text style={[styles.freeNote, { color: appColors.textTertiary }]}>
          Free plan always available • Cancel anytime
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 20,
    paddingBottom: 20,
  },

  // Header
  header: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },

  // Trial Badge
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.aiPurpleLight,
    borderRadius: 12,
    marginBottom: 24,
  },
  trialActiveBadge: {
    backgroundColor: '#D1FAE5',
  },
  trialBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.aiPurple,
  },

  // Plan Section
  planSection: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  planCards: {
    gap: 12,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  planCardSelected: {
    borderColor: COLORS.gradientStart,
    backgroundColor: '#F8FAFF',
  },
  planCardContent: {
    flex: 1,
  },
  planName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  planPrice: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  planPriceMonthly: {
    fontSize: 14,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  savingsBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: COLORS.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  savingsText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Features Section
  featuresSection: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  featureTable: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    overflow: 'hidden',
  },
  featureHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F8F9FB',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  featureHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  proHeader: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  proHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  featureNameCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureName: {
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  featureValueCol: {
    width: 70,
    alignItems: 'center',
  },
  featureValue: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  featureValuePro: {
    color: COLORS.aiPurple,
    fontWeight: '600',
  },

  // Social Proof
  socialProof: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  socialProofText: {
    fontSize: 14,
    color: COLORS.textTertiary,
  },

  // Bottom Actions
  bottomActions: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  trialButton: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  trialButtonGradient: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  trialButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  trialButtonSubtext: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 4,
  },
  secondaryActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  restoreText: {
    fontSize: 14,
    color: COLORS.gradientStart,
    fontWeight: '500',
  },
  termsText: {
    fontSize: 14,
    color: COLORS.textTertiary,
  },
  dot: {
    color: COLORS.textTertiary,
  },
  freeNote: {
    fontSize: 13,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },
});
