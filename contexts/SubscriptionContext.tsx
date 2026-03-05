/**
 * SubscriptionContext
 *
 * Provides subscription state throughout the app.
 * Determines if user can use AI scheduling and other Pro features.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { UserSubscription, PlanId, PlanFeatures } from '@/lib/types';
import { useAuth } from './AuthContext';

interface AIUsage {
  used: number;
  limit: number;
  isUnlimited: boolean;
  resetsOn: Date | null;
}

interface SubscriptionContextValue {
  // Subscription state
  subscription: UserSubscription | null;
  isLoading: boolean;
  error: string | null;

  // Convenience flags
  isPro: boolean;
  canUseAI: boolean;
  isTrialing: boolean;
  trialDaysRemaining: number | null;

  // AI usage for freemium limit
  aiUsage: AIUsage | null;

  // Plan limits
  features: PlanFeatures;

  // Actions
  refresh: () => Promise<void>;
  refreshAIUsage: () => Promise<void>;
}

const DEFAULT_FREE_FEATURES: PlanFeatures = {
  ai_scheduling: false,
  recurring_tasks: 3,
  task_history_days: 30,
  auto_reschedule_per_week: 1,
};

const DEFAULT_PRO_FEATURES: PlanFeatures = {
  ai_scheduling: true,
  recurring_tasks: -1,
  task_history_days: -1,
  auto_reschedule_per_week: -1,
};

const SubscriptionContext = createContext<SubscriptionContextValue>({
  subscription: null,
  isLoading: true,
  error: null,
  isPro: false,
  canUseAI: false,
  isTrialing: false,
  trialDaysRemaining: null,
  aiUsage: null,
  features: DEFAULT_FREE_FEATURES,
  refresh: async () => {},
  refreshAIUsage: async () => {},
});

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiUsage, setAIUsage] = useState<AIUsage | null>(null);

  const fetchSubscription = useCallback(async () => {
    try {
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setSubscription(null);
        setIsLoading(false);
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (fetchError) {
        // If no subscription found, user is on free plan (might be new user)
        if (fetchError.code === 'PGRST116') {
          setSubscription(null);
        } else {
          throw fetchError;
        }
      } else {
        setSubscription(data as UserSubscription);
      }
    } catch (err) {
      console.error('[SubscriptionContext] Error fetching subscription:', err);
      setError(err instanceof Error ? err.message : 'Failed to load subscription');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchAIUsage = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setAIUsage(null);
        return;
      }

      // Admins always get unlimited AI access
      if (isAdmin) {
        setAIUsage({ used: 0, limit: 0, isUnlimited: true, resetsOn: null });
        return;
      }

      const { data, error: fetchError } = await supabase.rpc(
        'can_use_ai_scheduling',
        { p_user_id: user.id }
      );

      if (fetchError) {
        console.error('[SubscriptionContext] Error fetching AI usage:', fetchError);
        return;
      }

      if (data) {
        setAIUsage({
          used: data.used || 0,
          limit: data.limit || 3,
          isUnlimited: data.is_pro || false,
          resetsOn: data.resets_on ? new Date(data.resets_on) : null,
        });
      }
    } catch (err) {
      console.error('[SubscriptionContext] Error fetching AI usage:', err);
    }
  }, [isAdmin]);

  // Calculate derived values
  const isPro = React.useMemo(() => {
    // Admins always get pro access
    if (isAdmin) return true;

    if (!subscription) return false;

    const { plan_id, status, trial_ends_at } = subscription;

    // Active paid plan
    if ((plan_id === 'pro_monthly' || plan_id === 'pro_yearly') && status === 'active') {
      return true;
    }

    // Active trial
    if (status === 'trial' && trial_ends_at) {
      return new Date(trial_ends_at) > new Date();
    }

    return false;
  }, [subscription, isAdmin]);

  const isTrialing = React.useMemo(() => {
    if (!subscription) return false;
    return subscription.status === 'trial' &&
           subscription.trial_ends_at !== null &&
           new Date(subscription.trial_ends_at) > new Date();
  }, [subscription]);

  const trialDaysRemaining = React.useMemo(() => {
    if (!isTrialing || !subscription?.trial_ends_at) return null;
    const endDate = new Date(subscription.trial_ends_at);
    const now = new Date();
    const diff = endDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }, [isTrialing, subscription?.trial_ends_at]);

  const features = React.useMemo(() => {
    return isPro ? DEFAULT_PRO_FEATURES : DEFAULT_FREE_FEATURES;
  }, [isPro]);

  const canUseAI = aiUsage !== null && (aiUsage.isUnlimited || aiUsage.used < aiUsage.limit);

  // Fetch on mount and auth changes
  useEffect(() => {
    fetchSubscription();
    fetchAIUsage();

    // Listen for auth changes
    const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          fetchSubscription();
          fetchAIUsage();
        } else if (event === 'SIGNED_OUT') {
          setSubscription(null);
          setAIUsage(null);
          setIsLoading(false);
        }
      }
    );

    return () => {
      authSubscription.unsubscribe();
    };
  }, [fetchSubscription, fetchAIUsage]);

  // Listen for realtime subscription changes
  useEffect(() => {
    const channel = supabase
      .channel('subscription-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_subscriptions',
        },
        (payload) => {
          console.log('[SubscriptionContext] Subscription changed:', payload);
          fetchSubscription();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSubscription]);

  return (
    <SubscriptionContext.Provider
      value={{
        subscription,
        isLoading,
        error,
        isPro,
        canUseAI,
        isTrialing,
        trialDaysRemaining,
        aiUsage,
        features,
        refresh: fetchSubscription,
        refreshAIUsage: fetchAIUsage,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}
