import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { supabase } from '@/integrations/supabase/client';
import { lookupMilestone } from '@/lib/milestone-achievements';

/**
 * Asks the server what this account has earned, and GRANTS anything newly earned in the same call.
 *
 * ⚠️ THE CALL IS A WRITE, WHICH IS WHY IT IS NOT A PLAIN READ HOOK. `claim_milestone_achievements`
 * is `SECURITY DEFINER` and inserts any badge whose threshold the caller has passed. It is
 * idempotent — `on conflict do nothing` — so running it on every visit to the dashboard costs one
 * round trip and can never produce a duplicate.
 *
 * ⚠️ THE CLIENT CANNOT MINT THESE ITSELF, AND THAT IS THE POINT. The `achievements` INSERT policy
 * still allows only `lesson:%` and the two social ids, deliberately unwidened. A milestone is a
 * claim the database can check, so it is checked there rather than asserted here.
 *
 * ⚠️ A FAILURE HERE MUST NOT BREAK THE TROPHY CASE. Badges already held are read by
 * `useAchievements` straight from the table; this hook only adds the *unearned* half and the
 * progress numbers. So it returns an empty list on error rather than throwing — a person who has
 * earned badges still sees them if the grant call is having a bad day.
 */

export const MILESTONES_QUERY_KEY = 'achievements:milestones';

export interface MilestoneProgress {
  id: string;
  name: string;
  description: string;
  /** The number the SERVER compared against — never restated on the client, so it cannot drift. */
  threshold: number;
  progress: number;
  earned: boolean;
}

interface MilestoneRow {
  id: string;
  threshold: number;
  progress: number;
  earned: boolean;
  earned_at: string | null;
}

export function useMilestoneAchievements(): { data: MilestoneProgress[]; loading: boolean } {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  const query = useQuery({
    queryKey: [MILESTONES_QUERY_KEY, isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<MilestoneRow[]> => {
      const { data, error } = await supabase.rpc('claim_milestone_achievements');
      if (error) throw error;
      return (data ?? []) as MilestoneRow[];
    },
  });

  const rows = query.data ?? [];

  return {
    data: rows.map(row => {
      const def = lookupMilestone(row.id);
      return {
        id: row.id,
        // An id this build has no definition for still reports its progress rather than vanishing.
        name: def?.name ?? row.id,
        description: def?.description ?? 'A milestone this version does not have a description for.',
        threshold: row.threshold,
        progress: row.progress,
        earned: row.earned,
      };
    }),
    loading: query.isLoading && !isDemo && !!user,
  };
}
