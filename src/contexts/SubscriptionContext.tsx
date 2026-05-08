import React, { createContext, useContext } from 'react';
import { useQuery, type QueryObserverResult } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type UserSubscription = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string;
  subscription_status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  purchase_provider: 'stripe' | 'apple' | 'google' | null;
  revenuecat_app_user_id: string | null;
  apple_original_transaction_id: string | null;
};

type SubscriptionContextType = {
  subscription: UserSubscription | null | undefined;
  isPremium: boolean;
  hasStripeCustomer: boolean;
  isLoading: boolean;
  refetch: () => Promise<QueryObserverResult<UserSubscription | null, Error>>;
};

const SubscriptionContext = createContext<SubscriptionContextType>({
  subscription: undefined,
  isPremium: false,
  hasStripeCustomer: false,
  isLoading: true,
  refetch: () => Promise.resolve({} as QueryObserverResult<UserSubscription | null, Error>),
});

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, isDemo } = useAuth();

  const query = useQuery({
    queryKey: ['user_subscription', isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('user_subscriptions' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown) as UserSubscription | null;
    },
  });

  const isPremium = isDemo
    ? false
    : query.data?.plan === 'premium' &&
      ['active', 'trialing'].includes(query.data?.subscription_status || '');

  return (
    <SubscriptionContext.Provider value={{
      subscription: query.data,
      isPremium,
      hasStripeCustomer: !!query.data?.stripe_customer_id,
      isLoading: query.isLoading,
      refetch: query.refetch,
    }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscriptionContext(): SubscriptionContextType {
  return useContext(SubscriptionContext);
}
