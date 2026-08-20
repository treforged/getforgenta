import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useSavingsGoals, useCarFunds, useProfile, useAccounts } from '@/hooks/useSupabaseData';
import {
  buildSurplusRankRows, isSurplusRankWritesEmpty, planSurplusRankWrites,
  type SurplusRankRow, type SurplusRankWrites,
} from '@/lib/surplus-ranking';

/**
 * The ranked "where the extra money goes" list, wired to the three places it is stored.
 *
 * ⚠️ ONE MUTATION, NOT THREE HOOKS' WORTH. `useSavingsGoals().update`, `useCarFunds().update` and
 * `useProfile().update` each toast on success, so a drag that touches four rows would fire four
 * toasts and four cache invalidations. This writes them in one `Promise.all` and reports once —
 * the same shape `useCarBuildPhases().reorder` already uses for the builds list.
 *
 * ⚠️ BOTH LIST QUERIES `.order('created_at')`, NOT `sort_order`. The ordering is done here, by
 * `buildSurplusRankRows`; reading `data` straight off either hook gives the wrong order.
 */
export function useSurplusRanking() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const qc = useQueryClient();
  const { data: goals, loading: goalsLoading } = useSavingsGoals();
  const { data: carFunds, loading: carFundsLoading } = useCarFunds();
  const { data: accounts } = useAccounts();
  const { data: profile } = useProfile();

  const accountBalances = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of accounts) map[a.id] = Number(a.balance) || 0;
    return map;
  }, [accounts]);

  const rows = useMemo(
    () => buildSurplusRankRows({
      goals,
      carFunds,
      cardsSortOrder: profile?.cards_sort_order ?? 0,
      accountBalances,
    }),
    [goals, carFunds, profile?.cards_sort_order, accountBalances],
  );

  const save = useMutation({
    mutationFn: async (writes: SurplusRankWrites) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const results = await Promise.all([
        ...writes.goals.map(({ id, ...patch }) =>
          supabase.from('savings_goals').update(patch).eq('id', id).eq('user_id', user.id)),
        ...writes.carFunds.map(({ id, ...patch }) =>
          supabase.from('car_funds').update(patch).eq('id', id).eq('user_id', user.id)),
        ...(writes.cardsSortOrder === null ? [] : [
          supabase.from('profiles')
            .update({ cards_sort_order: writes.cardsSortOrder })
            .eq('user_id', user.id),
        ]),
      ]);
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['savings_goals'] });
      qc.invalidateQueries({ queryKey: ['car_funds'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Priority saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { mutate: saveMutate } = save;

  /**
   * Persist a reordered / re-toggled list. Sends only what actually changed, and nothing at all
   * when nothing did — a drag that lands a row back where it started is silent.
   */
  const commit = useCallback((next: readonly SurplusRankRow[]) => {
    const writes = planSurplusRankWrites(rows, next);
    if (isSurplusRankWritesEmpty(writes)) return;
    saveMutate(writes);
  }, [rows, saveMutate]);

  return {
    rows,
    commit,
    saving: save.isPending,
    loading: goalsLoading || carFundsLoading,
    /** Demo mode has no database to write to; the list is shown read-only there. */
    readOnly: isDemo || !user,
  };
}
