import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { SOCIAL_LINKS } from '@/lib/social-links';
import type { SocialAchievementId } from '@/lib/social-links';

/**
 * The two badges the app cannot verify, kept apart from the Learn ones on purpose.
 *
 * They live in the same `achievements` table — one system, not three — but they are read with
 * their own query rather than folded into `useLearnProgress`, because the Learn ring counts
 * lessons and a follow is not one. Mixing them would put the ring at 14/12.
 *
 * ⚠️ CLAIM-BASED BY NECESSITY. Neither platform lets a consumer app check whether a follow
 * happened, so the client writes these itself and the RLS policy allows exactly these two ids.
 * That means they must never unlock anything of value — see `social-links.ts` for the rule and
 * docs/og-cohort.md for why it is written down rather than left as folklore.
 */

export const SOCIAL_ACHIEVEMENTS_QUERY_KEY = 'achievements:social';

const SOCIAL_IDS: readonly string[] = SOCIAL_LINKS.map(link => link.id);

export interface SocialAchievements {
  loading: boolean;
  /** Ids already claimed on this account. */
  claimed: readonly SocialAchievementId[];
  /** False in demo or signed out, where a claim would fail or land on the wrong account. */
  canClaim: boolean;
}

export function useSocialAchievements(): SocialAchievements {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  const query = useQuery({
    queryKey: [SOCIAL_ACHIEVEMENTS_QUERY_KEY, isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<SocialAchievementId[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('achievements')
        .select('achievement_id')
        .eq('user_id', user.id)
        .in('achievement_id', SOCIAL_IDS as string[]);
      if (error) throw error;
      return (data ?? []).map(row => row.achievement_id as SocialAchievementId);
    },
  });

  return useMemo(() => ({
    loading: query.isLoading,
    claimed: query.data ?? [],
    canClaim: !isDemo && !!user,
  }), [query.isLoading, query.data, isDemo, user]);
}

/**
 * Record that the user tapped through. Fire-and-forget by design: the tap's real job is to open
 * the profile, and a failed badge write must never be the reason that does not happen.
 */
export function useClaimSocialAchievement() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: SocialAchievementId): Promise<void> => {
      if (isDemo || !user) return;
      // Guarded here as well as in RLS. The policy is the security boundary; this is the one that
      // keeps an obvious mistake from ever reaching it.
      if (!SOCIAL_IDS.includes(id)) throw new Error('Unknown social achievement.');

      const { error } = await supabase
        .from('achievements')
        .insert({ user_id: user.id, achievement_id: id });
      // 23505 is "already claimed", which is a success from the user's point of view.
      if (error && error.code !== '23505') throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [SOCIAL_ACHIEVEMENTS_QUERY_KEY] });
    },
    // NO ERROR TOAST. A badge nobody asked for failing to save is not worth interrupting someone
    // who is halfway to Instagram. The tap still worked; that is what they wanted.
    onError: () => { /* deliberately silent — see above */ },
  });
}
