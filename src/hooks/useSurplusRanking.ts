import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useSavingsGoals, useCarFunds, useProfile, useAccounts } from '@/hooks/useSupabaseData';
import {
  buildSurplusRankRows, isSurplusRankWritesEmpty, planCardSeparationWrites, planSurplusRankWrites,
  type SurplusRankRow, type SurplusRankWrites,
} from '@/lib/surplus-ranking';

/**
 * The ranked "where the extra money goes" list, wired to the four places it is stored.
 *
 * ⚠️ ONE MUTATION, NOT FOUR HOOKS' WORTH. `useSavingsGoals().update`, `useCarFunds().update`,
 * `useAccounts().update` and `useProfile().update` each toast on success, so a drag that touches
 * four rows would fire four toasts and four cache invalidations. This writes them in one
 * `Promise.all` and reports once — the same shape `useCarBuildPhases().reorder` already uses for
 * the builds list.
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

  // Only ACTIVE credit cards can be ranked. A closed card has no balance to send money at, and an
  // account of any other type is not part of the debt block in the first place.
  const cards = useMemo(
    () => accounts.filter(a => a.active && a.account_type === 'credit_card'),
    [accounts],
  );

  const rows = useMemo(
    () => buildSurplusRankRows({
      goals,
      carFunds,
      cards,
      cardsSortOrder: profile?.cards_sort_order ?? 0,
      cardsShare: profile?.cards_surplus_share ?? null,
      accountBalances,
    }),
    [goals, carFunds, cards, profile?.cards_sort_order, profile?.cards_surplus_share, accountBalances],
  );

  const save = useMutation({
    mutationFn: async (writes: SurplusRankWrites) => {
      if (isDemo || !user) throw new Error('Demo mode');
      const results = await Promise.all([
        ...writes.goals.map(({ id, ...patch }) =>
          supabase.from('savings_goals').update(patch).eq('id', id).eq('user_id', user.id)),
        ...writes.carFunds.map(({ id, ...patch }) =>
          supabase.from('car_funds').update(patch).eq('id', id).eq('user_id', user.id)),
        ...writes.cards.map(({ id, ...patch }) =>
          supabase.from('accounts').update(patch).eq('id', id).eq('user_id', user.id)),
        ...(writes.cardsSortOrder === null && writes.cardsShare === undefined ? [] : [
          supabase.from('profiles')
            .update({
              ...(writes.cardsSortOrder === null ? {} : { cards_sort_order: writes.cardsSortOrder }),
              ...(writes.cardsShare === undefined ? {} : { cards_surplus_share: writes.cardsShare }),
            })
            .eq('user_id', user.id),
        ]),
      ]);
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['savings_goals'] });
      qc.invalidateQueries({ queryKey: ['car_funds'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Priority saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { mutate: saveMutate } = save;

  /**
   * Persist a reordered / re-toggled / re-split list. Sends only what actually changed, and
   * nothing at all when nothing did — a drag that lands a row back where it started is silent.
   */
  const commit = useCallback((next: readonly SurplusRankRow[]) => {
    const writes = planSurplusRankWrites(rows, next);
    if (isSurplusRankWritesEmpty(writes)) return;
    saveMutate(writes);
  }, [rows, saveMutate]);

  /**
   * Pull a card out of the credit-card block so it can be ranked on its own, or put it back.
   *
   * Separate from `commit` because the card's row does not exist in `rows` until the write lands,
   * so there is no "next list" to diff — see `planCardSeparationWrites`, which also bumps every
   * row below the new rank rather than dropping the card on top of one.
   */
  const setCardSeparated = useCallback((cardId: string, separated: boolean) => {
    saveMutate(planCardSeparationWrites(rows, cardId, separated));
  }, [rows, saveMutate]);

  return {
    rows,
    /** Every active credit card, so the UI can offer the ones still inside the block. */
    cards,
    commit,
    setCardSeparated,
    saving: save.isPending,
    loading: goalsLoading || carFundsLoading,
    /** Demo mode has no database to write to; the list is shown read-only there. */
    readOnly: isDemo || !user,
  };
}
