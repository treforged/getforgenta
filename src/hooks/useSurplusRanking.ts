import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useSavingsGoals, useCarFunds, useProfile, useAccounts, useDebts, useRecurringRules } from '@/hooks/useSupabaseData';
import {
  buildSurplusRankRows, isSurplusRankWritesEmpty, planAutoExtraDeselect, planCardRankModeWrites,
  planCardSeparationWrites,
  planLiabilityRankWrites, planSurplusRankWrites,
  type SurplusRankRow, type SurplusRankWrites,
} from '@/lib/surplus-ranking';
import { buildRankableLiabilities, type RankableLiability } from '@/lib/ranked-extra-payment-targets';
import { computeEssentialMonthlyExpenses } from '@/lib/essential-monthly-expenses';
import { resolveFundingAccountId } from '@/lib/funding-account';
import type { LiabilityDebtInput } from '@/lib/non-cc-liabilities';
import { linkedLoanAccountIds } from '@/lib/vehicle-loan-link';
import { usePersistedState } from '@/hooks/usePersistedState';

/**
 * Targets this app session has already switched `auto_extra` off for.
 *
 * ⚠️ MODULE SCOPE, NOT A REF, and the difference is the whole guard. The flag itself is the primary
 * idempotence — once the write lands the row no longer plans — but it cannot cover the one case
 * that would be a FIGHT: a user who deliberately re-ticks a finished row. A per-instance ref forgets
 * that the moment they navigate away and back, so their tick would be undone on the next visit;
 * held here it survives every remount for as long as the app is open.
 *
 * It used to be the ONLY memory of this decision, with a documented known limit: no provenance
 * column on `savings_goals` or `car_funds`, so a page reload rebuilt this `Set` empty and re-fought
 * a deliberate re-tick. `20260826_auto_extra_auto_cleared.sql` closes that: `planAutoExtraDeselect`
 * now also skips a row whose live `auto_extra_auto_cleared` is already true. This `Set` stays, as
 * the fast, same-tick guard before a refetch has landed the persisted value.
 */
const autoExtraDeselected = new Set<string>();

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
  const { data: accounts, loading: accountsLoading } = useAccounts();
  const { data: profile } = useProfile();
  const { data: debts } = useDebts();
  const { data: rules } = useRecurringRules();

  /** Demo mode has no database to write to; the list is shown read-only there. */
  const readOnly = isDemo || !user;

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

  /**
   * Every non-CC liability that can be ranked at all — an active student loan / mortgage /
   * other-liability account paired to a `debts` row, minus the ones a vehicle loan is linked to
   * (the car fund carries those, and it already has its own row).
   *
   * ⚠️ `listDebtServiceLiabilities` is the SAME function the forecast and `useCardProjection` use
   * to decide which debts leave cash, so the list a user can rank cannot drift from the list the
   * engine actually pays. The two ranking columns are joined back on here because that helper is
   * about debt service and knows nothing about ranks.
   */
  const liabilities = useMemo<RankableLiability[]>(() => buildRankableLiabilities({
    accounts,
    debts: debts as unknown as LiabilityDebtInput[],
    rules,
    excludedAccountIds: linkedLoanAccountIds(carFunds ?? [], accounts),
  }), [accounts, debts, rules, carFunds]);

  /**
   * One month of essential cost, for a STAGED emergency goal's thresholds.
   *
   * ⚠️ THIS EXISTS SO THE LIST AND THE FORECAST PRINT THE SAME NUMBER. `forecast-engine` sizes a
   * staged goal's stage 1 from exactly this figure; without it here the same row would show its
   * base `target_amount` in the list while the engine reserved against stage 1, and a user reading
   * two screens would see two different remaining needs for one goal.
   *
   * The funding account is resolved the same way `CardProjectionContext` resolves it — the
   * validated `profiles.default_deposit_account`, else the first active checking account — so the
   * "paid from another bank account" exclusion lands on the same rules in both places. Null is
   * safe: `computeEssentialMonthlyExpenses` then excludes nothing, which over-reports rather than
   * under-funds a runway.
   */
  const essentialMonthlyExpenses = useMemo(() => {
    const fundingAccountId = resolveFundingAccountId(accounts ?? [], profile?.default_deposit_account)
      ?? ((accounts ?? []).find(a => a.active && a.account_type === 'checking')?.id as string | undefined)
      ?? null;
    return computeEssentialMonthlyExpenses({
      rules: rules ?? [],
      accounts: accounts ?? [],
      carFunds: carFunds ?? [],
      fundingAccountId,
    });
  }, [rules, accounts, carFunds, profile?.default_deposit_account]);

  /**
   * The payoff strategy the /debt tab is set to — it orders the NOT-YET-OPEN cards in the list
   * (Tre, 2026-08-26: "ordered by the payoff method").
   *
   * ⚠️ READ FROM THE SAME `localStorage` KEY `CardProjectionContext` reads, not from the context
   * itself. This hook is rendered directly by its own tests with a plain query-client wrapper, so a
   * context dependency here would make the hook impossible to mount without the whole projection
   * provider. The key IS the storage; the context is another reader of it, not its owner.
   */
  const [debtStrategy] = usePersistedState<'avalanche' | 'snowball'>('tre:debt:strategy', 'avalanche');

  const rows = useMemo(
    () => buildSurplusRankRows({
      goals,
      carFunds,
      cards,
      liabilities,
      cardsSortOrder: profile?.cards_sort_order ?? 0,
      cardsShare: profile?.cards_surplus_share ?? null,
      accountBalances,
      essentialMonthlyExpenses,
      cardPayoffStrategy: debtStrategy,
    }),
    [goals, carFunds, cards, liabilities, profile?.cards_sort_order, profile?.cards_surplus_share, accountBalances, essentialMonthlyExpenses, debtStrategy],
  );

  const save = useMutation({
    mutationFn: async (writes: SurplusRankWrites) => {
      if (isDemo || !user) throw new Error('Demo mode');
      // ── A STOP'S RANK AND TICK LIVE INSIDE `savings_goals.stages` ────────────
      //
      // So a stop write is READ-MODIFY-WRITE on one jsonb column, not a column patch, and every
      // stop of one goal has to be folded into a SINGLE update: two concurrent patches of the same
      // array would each write their own copy of it and the second would silently discard the
      // first. Grouping by goal is what makes "drag stop 2 and stop 3 in one go" safe.
      //
      // The array is patched from the goal row this hook already holds, never re-fetched: a fetch
      // here would race the optimistic list the user is looking at, and the rows below were built
      // from exactly these `goals`.
      // ⚠️ `surplus_share: null` IS A WRITE, not an absent one — it is how a stop leaves a split —
      // so every key is spread on `!== undefined`, never on truthiness.
      const stagePatchesByGoal = new Map<string, Map<string, { sort_order?: number; auto_extra?: boolean; surplus_share?: number | null }>>();
      for (const w of writes.goalStages) {
        const forGoal = stagePatchesByGoal.get(w.goalId) ?? new Map();
        forGoal.set(w.stageId, { ...forGoal.get(w.stageId), ...(w.sort_order === undefined ? {} : { sort_order: w.sort_order }), ...(w.auto_extra === undefined ? {} : { auto_extra: w.auto_extra }), ...(w.surplus_share === undefined ? {} : { surplus_share: w.surplus_share }) });
        stagePatchesByGoal.set(w.goalId, forGoal);
      }
      const stageUpdates = [...stagePatchesByGoal].flatMap(([goalId, patches]) => {
        const goal = goals.find(g => g.id === goalId);
        const stored = Array.isArray(goal?.stages) ? (goal.stages as unknown[]) : null;
        // A goal whose stages we cannot read is skipped rather than overwritten with a guess: the
        // write would replace a real plan with a fabricated one.
        if (stored == null) return [];
        const nextStages = stored.map(entry => {
          if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
          const row = entry as { id?: unknown };
          const patch = typeof row.id === 'string' ? patches.get(row.id) : undefined;
          return patch ? { ...row, ...patch } : entry;
        });
        return [supabase.from('savings_goals')
          .update({ stages: nextStages as unknown as Json })
          .eq('id', goalId).eq('user_id', user.id)];
      });
      const results = await Promise.all([
        ...stageUpdates,
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

  /**
   * Put a non-CC liability on the ranked list, or take it off. Separate from `commit` for the same
   * reason `setCardSeparated` is: until `accounts.surplus_sort_order` is non-null the liability has
   * no row in `rows` to diff.
   */
  /**
   * Switch the WHOLE card set between one block and one row each.
   *
   * The per-card `setCardSeparated` above still exists because the planner still
   * supports it, but the UI no longer offers it: a half-separated list is two
   * answers to the same question on one screen. See `planCardRankModeWrites`.
   */
  const setCardRankMode = useCallback((mode: 'block' | 'individual') => {
    saveMutate(planCardRankModeWrites(rows, cards, mode));
  }, [rows, cards, saveMutate]);

  const setLiabilityRanked = useCallback((accountId: string, ranked: boolean) => {
    saveMutate(planLiabilityRankWrites(rows, accountId, ranked));
  }, [rows, saveMutate]);

  // ── AUTO-DESELECT ────────────────────────────────────────────────────────
  //
  // "once it comes true it should auto deselect" (Tre, 2026-08-25). A target that has met its goal
  // has its `auto_extra` switched off, so the ranked list reads as "this one is next" instead of
  // five ticked rows where only one is being funded.
  //
  // ⚠️ AN EFFECT, NOT A RENDER. A write issued from a render body would fire on every re-render and
  // race its own refetch. This settles after exactly one pass: the write clears the flag, the plan
  // is then empty, and nothing re-enters. `planAutoExtraDeselect` documents why it can never move a
  // dollar — the flag it clears was already inert — which is what makes an automatic write here
  // safe at all.
  //
  // ⚠️ IT ONLY RUNS WHERE THE LIST IS ON SCREEN, and that is enough. The flag is presentational, so
  // a user who has not opened the ranked list has nothing to be shown a stale tick on. Mounting it
  // app-wide would buy a write nobody could observe.
  const deselectInFlight = useRef(false);
  const dataReady = !goalsLoading && !carFundsLoading && !accountsLoading;

  useEffect(() => {
    if (readOnly || !user || !dataReady || deselectInFlight.current) return;
    const plan = planAutoExtraDeselect(rows, autoExtraDeselected);
    if (plan.length === 0) return;

    deselectInFlight.current = true;
    void (async () => {
      try {
        // A STAGED GOAL'S STOP carries its tick inside `savings_goals.stages`, so its deselect is a
        // patch of that array rather than of the goal's `auto_extra` column -- and every stop of one
        // goal has to ride ONE update, or two concurrent writes of the same array would each keep
        // only their own change. `auto_extra_auto_cleared` stays a goal-level column: it records
        // that automation touched this goal, which is true whichever stop it touched.
        const stopPlan = plan.filter(t => t.goalId != null && t.stageId != null);
        const stopsByGoal = new Map<string, Set<string>>();
        for (const t of stopPlan) {
          const set = stopsByGoal.get(t.goalId!) ?? new Set<string>();
          set.add(t.stageId!);
          stopsByGoal.set(t.goalId!, set);
        }
        const stopWrites = [...stopsByGoal].flatMap(([goalId, stageIds]) => {
          const goal = goals.find(g => g.id === goalId);
          const stored = Array.isArray(goal?.stages) ? (goal.stages as unknown[]) : null;
          if (stored == null) return [];
          const nextStages = stored.map(entry => {
            if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
            const row = entry as { id?: unknown };
            return typeof row.id === 'string' && stageIds.has(row.id)
              ? { ...row, auto_extra: false }
              : entry;
          });
          return [supabase.from('savings_goals')
            .update({ stages: nextStages as unknown as Json, auto_extra_auto_cleared: true })
            .eq('id', goalId).eq('user_id', user.id)];
        });
        const results = await Promise.all([
          ...stopWrites,
          ...plan.filter(t => t.goalId == null || t.stageId == null).map(t =>
            supabase
              .from(t.kind === 'goal' ? 'savings_goals' : 'car_funds')
              // `auto_extra_auto_cleared` (20260826_auto_extra_auto_cleared.sql) is what makes this
              // decision survive a reload -- see the module-scoped Set above.
              .update({ auto_extra: false, auto_extra_auto_cleared: true })
              .eq('id', t.id)
              .eq('user_id', user.id)),
        ]);
        const failed = results.find(r => r.error);
        if (failed?.error) throw failed.error;
        // Only marked once the write has actually landed, so a failed pass genuinely retries
        // instead of quietly deciding it is already done.
        for (const t of plan) autoExtraDeselected.add(t.id);
        qc.invalidateQueries({ queryKey: ['savings_goals'] });
        qc.invalidateQueries({ queryKey: ['car_funds'] });
        toast.info(plan.length === 1
          ? `${plan[0].name} is done. Auto extra moved to the next item.`
          : `${plan.length} targets are done. Auto extra moved on.`);
      } catch (err) {
        // Not silent, and not a raw database error in the user's face for a pass they did not ask
        // for. The next mount re-plans from scratch, so a failure costs a delay and nothing else.
        // Same call the sibling background write (`useAutoEndReconcile`) makes.
        console.error('auto-extra deselect failed:', err);
      } finally {
        deselectInFlight.current = false;
      }
    })();
  }, [rows, readOnly, user, dataReady, qc]);

  return {
    rows,
    /** Every active credit card, so the UI can offer the ones still inside the block. */
    cards,
    /** Every rankable non-CC liability, ranked or not, so the UI can offer the ones not yet on
     *  the list. A ranked one also has a row in `rows`; this is the full set either way. */
    liabilities,
    commit,
    setCardSeparated,
    setCardRankMode,
    setLiabilityRanked,
    saving: save.isPending,
    loading: goalsLoading || carFundsLoading,
    readOnly,
  };
}
