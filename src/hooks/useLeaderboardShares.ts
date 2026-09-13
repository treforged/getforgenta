import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
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
 * ⚠️ **UPDATE-THEN-INSERT, NOT UPSERT, AND THE UPSERT WAS A LIVE BUG.** Tre, 2026-09-13: "the
 * buttons are not doing anything. They just kinda click and that's it." Measured against the
 * production API the same day, signed in as him: the upsert returned **"permission denied for
 * table leaderboard_shares"**, while an insert of the granted columns and an update of the granted
 * columns both returned OK. `leaderboard_shares` had **ZERO rows** — every toggle he had ever
 * pressed wrote nothing.
 *
 * THE CAUSE IS COLUMN-LEVEL GRANTS, WHICH ARE CORRECT AND DELIBERATE.
 * `20260826_friend_links.sql` grants `insert (user_id, metric, enabled, updated_at)` but
 * `update (enabled, updated_at)` — a row's identity is not editable, which is the right call. An
 * upsert is `INSERT … ON CONFLICT DO UPDATE`, and PostgREST puts EVERY column it was given into
 * the update, so the conflict path tried to update `user_id` and `metric` and was refused. The
 * grant was never the problem; asking to update the key was.
 *
 * So the write is split to match the grants exactly: update the two mutable columns, and insert
 * only when no row was matched. The double-tap safety the upsert was chosen for is preserved by
 * the `(user_id, metric)` unique index — a racing insert loses on the key rather than creating a
 * second row, and `23505` is treated as success because the row it wanted now exists.
 */
function useSetLeaderboardShare() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ metric, enabled }: { metric: LeaderboardMetric; enabled: boolean }) => {
      if (!user) throw new Error('Not signed in');
      const now = new Date().toISOString();

      // Only the columns `update` is granted on. `.select('id')` is what makes "did a row exist?"
      // answerable — without it the result carries no rows and the insert below could never be
      // skipped, which would turn every second toggle into a duplicate-key error.
      const { data: updated, error: updateError } = await supabase
        .from('leaderboard_shares')
        .update({ enabled, updated_at: now })
        .eq('user_id', user.id)
        .eq('metric', metric)
        .select('id');
      if (updateError) throw updateError;
      if ((updated?.length ?? 0) > 0) return;

      // No row yet. Only the columns `insert` is granted on.
      const { error: insertError } = await supabase
        .from('leaderboard_shares')
        .insert({ user_id: user.id, metric, enabled, updated_at: now });
      // 23505 = another tap inserted it first. The user's intent is satisfied either way, and
      // raising here would show an error for a switch that is now in the state they asked for.
      if (insertError && insertError.code !== '23505') throw insertError;
    },
    onSuccess: () => {
      // Invalidate rather than patch the cache by hand. Turning a metric OFF is a privacy action,
      // and an optimistic update that silently failed would leave the switch reading "off" while
      // the row still says true - the one direction this must never be wrong in.
      queryClient.invalidateQueries({ queryKey: [LEADERBOARD_SHARES_QUERY_KEY] });
    },
    /**
     * ⚠️ WITHOUT THIS THE FAILURE WAS INVISIBLE, and that is why it survived to a live report.
     * Every other mutation in this app surfaces its error; this one had no `onError` at all, so a
     * refused write produced no toast, no console entry and no change — a button that "just kinda
     * clicks". A privacy switch that silently fails is worse than one that errors: the user walks
     * away believing they changed something.
     */
    onError: (e: Error) => toast.error(`Could not change sharing: ${e.message}`),
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
