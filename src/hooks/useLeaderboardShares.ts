import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import type { LeaderboardMetric } from '@/lib/leaderboard-metrics';

/**
 * The per-metric opt-in registry - `leaderboard_shares` (plan §2, Phase 2).
 *
 * ⚠️ **THIS IS THE PRECONDITION FOR THE WHOLE FEATURE, NOT A SETTING BOLTED ON AFTERWARDS.**
 * Nothing is ever published until a metric is switched on here, so a leaderboard shipped without
 * these toggles would be permanently, structurally empty - the "built, exported, never wired"
 * shape this repo keeps finding. It is built before the display for that reason.
 *
 * **NO ROW MEANS SHARE NOTHING**, which is why `isEnabled` returns false for an absent row rather
 * than treating absence as unknown and asking again later. The default is off, and it is off in
 * the database rather than only in the UI.
 *
 * Mirrors `useFriendLink`'s disciplines: explicit column list, a named query key, `enabled` gated
 * on a real session, and an invalidation on every write so a toggle can never be shown in a state
 * the database does not hold. Demo renders read-only - the table is RLS'd to `auth.uid()`, so a
 * demo write would be a dead button.
 */

export const LEADERBOARD_SHARES_QUERY_KEY = 'leaderboard_shares';

const SHARE_COLUMNS = 'user_id, metric, enabled, updated_at' as const;

export interface LeaderboardShareRow {
  user_id: string;
  metric: string;
  enabled: boolean;
  updated_at: string | null;
}

export interface LeaderboardSharesState {
  rows: LeaderboardShareRow[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  /** False for an absent row: no row means share nothing. */
  isEnabled: (metric: LeaderboardMetric) => boolean;
  /** Every metric currently switched on, in a stable order. */
  enabledMetrics: LeaderboardMetric[];
  setEnabled: ReturnType<typeof useSetLeaderboardShare>;
}

/**
 * Turn one metric on or off.
 *
 * Upsert on the `(user_id, metric)` unique key rather than insert-or-update in two steps, so a
 * double tap cannot create a second row for the same metric.
 */
function useSetLeaderboardShare() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ metric, enabled }: { metric: LeaderboardMetric; enabled: boolean }) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase
        .from('leaderboard_shares')
        .upsert(
          { user_id: user.id, metric, enabled, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,metric' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      // Invalidate rather than patch the cache by hand. Turning a metric OFF is a privacy action,
      // and an optimistic update that silently failed would leave the switch reading "off" while
      // the row still says true - the one direction this must never be wrong in.
      queryClient.invalidateQueries({ queryKey: [LEADERBOARD_SHARES_QUERY_KEY] });
    },
  });
}

export function useLeaderboardShares(): LeaderboardSharesState {
  const { user } = useAuth();
  const { isDemo } = useDemo();

  const query = useQuery({
    queryKey: [LEADERBOARD_SHARES_QUERY_KEY, isDemo ? 'demo' : user?.id],
    enabled: !isDemo && !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<LeaderboardShareRow[]> => {
      if (!user) return [];
      // RLS already restricts this to the caller's own rows; the filter is stated anyway, matching
      // every other read in the app.
      const { data, error } = await supabase
        .from('leaderboard_shares')
        .select(SHARE_COLUMNS)
        .eq('user_id', user.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);

  const isEnabled = useCallback(
    (metric: LeaderboardMetric) => rows.some((r) => r.metric === metric && r.enabled === true),
    [rows],
  );

  const enabledMetrics = useMemo(
    () =>
      rows
        .filter((r) => r.enabled === true)
        .map((r) => r.metric as LeaderboardMetric)
        .sort(),
    [rows],
  );

  return {
    rows,
    loading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    isEnabled,
    enabledMetrics,
    setEnabled: useSetLeaderboardShare(),
  };
}
