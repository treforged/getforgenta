import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';

/**
 * The 30-day-streak Premium reward, from the client's side.
 *
 * ⚠️ THIS HOOK DECIDES NOTHING. It asks. `claim_streak_reward()` takes no arguments — the identity
 * is `auth.uid()` and the streak is counted inside the database — so there is no user id and no day
 * count for this file to send, and nothing here that a modified client could lie about. That is
 * deliberate and it is the whole security story: a client may only claim what it cannot profit by
 * faking (docs/og-cohort.md). See 20260905_streak_reward_grant.sql.
 *
 * The number shown on screen still comes from `useLearnProgress`, which counts locally. The two can
 * briefly disagree across a midnight, and that is fine — the local one is a display, the server one
 * is the one that pays out, and the button simply reports whatever the server said.
 */

export const STREAK_REWARD_QUERY_KEY = 'streak_reward';

/** Days of reading required. Mirrors the constant the database enforces; it is not the authority. */
export const STREAK_REWARD_DAYS = 30;

export type StreakRewardGrant = {
  granted_at: string;
  expires_at: string;
  streak_days: number;
};

type ClaimResult = {
  granted: boolean;
  reason?: 'not_signed_in' | 'already_active' | 'streak_too_short' | 'already_paying';
  streak_days?: number;
  needed?: number;
  expires_at?: string;
};

/** The reasons a refusal is worth SAYING. "already_active" and "already_paying" are not failures —
 * the person already has what the button offers, so the button is not shown in those states and a
 * toast would be noise. A short streak is the one a person can act on. */
const REFUSAL_COPY: Record<string, string> = {
  streak_too_short: 'Keep reading — the reward needs a full 30 days in a row.',
  not_signed_in: 'Sign in to claim your reward.',
};

export function useStreakReward() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { refetch: refetchSubscription } = useSubscription();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [STREAK_REWARD_QUERY_KEY, isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<StreakRewardGrant | null> => {
      if (!user) return null;
      // RLS restricts this to the caller's own rows; the filter is stated anyway, as every other
      // read in this app does.
      const { data, error } = await supabase
        .from('streak_rewards')
        .select('granted_at, expires_at, streak_days')
        .eq('user_id', user.id)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('granted_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as StreakRewardGrant | undefined) ?? null;
    },
  });

  const claim = useMutation({
    mutationFn: async (): Promise<ClaimResult> => {
      if (isDemo) throw new Error('Sign in to claim your reward.');
      const { data, error } = await supabase.rpc('claim_streak_reward');
      if (error) throw error;
      return data as unknown as ClaimResult;
    },
    onSuccess: async (result) => {
      if (result.granted) {
        toast.success('30 days of Premium unlocked. Nice streak.');
        // The entitlement lives in `user_subscriptions`, which the whole app reads through the
        // subscription context — so refresh THAT, not just this hook, or the user is told they have
        // Premium while every gated surface still says they do not.
        await refetchSubscription();
      } else if (result.reason && REFUSAL_COPY[result.reason]) {
        toast.info(REFUSAL_COPY[result.reason]);
      }
      qc.invalidateQueries({ queryKey: [STREAK_REWARD_QUERY_KEY] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    /** The open grant, or null when there is none. Never a fabricated "expired" placeholder. */
    grant: query.data ?? null,
    loading: query.isLoading,
    claim,
  };
}
