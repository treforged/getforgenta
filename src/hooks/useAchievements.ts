import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { supabase } from '@/integrations/supabase/client';
import { resolveAchievements, type AchievementRow, type ResolvedAchievement } from '@/lib/achievements';

/**
 * EVERY badge this person holds — not just the lesson ones.
 *
 * ⚠️ DELIBERATELY NOT `useLearnProgress`. That hook filters to `lesson:%` on purpose, because the
 * Learn card's ring would read 14/12 if it counted the social and founder badges. **This one must
 * NOT filter**, or a trophy case would omit the two families it exists to show — and omitting a
 * badge somebody earned is the failure the whole surface is a fix for.
 *
 * Demo returns nothing rather than fixtures: an invented trophy case is a claim about somebody's
 * history, and the empty state below says so honestly.
 */

export const ACHIEVEMENTS_QUERY_KEY = 'achievements-all';

export function useAchievements(): { data: ResolvedAchievement[]; loading: boolean } {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  const query = useQuery({
    queryKey: [ACHIEVEMENTS_QUERY_KEY, isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<AchievementRow[]> => {
      if (!user) return [];
      // RLS already restricts this to the caller's rows; the filter is stated anyway, matching
      // every other read in the app.
      const { data, error } = await supabase
        .from('achievements')
        .select('achievement_id, earned_at')
        .eq('user_id', user.id)
        .order('earned_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  return {
    data: resolveAchievements(query.data ?? []),
    // A disabled query is not loading — it has no work to do. Reporting otherwise would leave demo
    // and signed-out on a spinner for ever.
    loading: query.isLoading && !isDemo && !!user,
  };
}
