import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import type { RuleRow } from '@/hooks/useSupabaseData';
import {
  applyFloorBuffers, buildVariableBillBuffers, type HistoryCharge, type HistoryReview,
} from '@/lib/variable-bill-history';

/**
 * The rules the MONEY ENGINES read: the user's rules, with a `floor_buffer` stamped on a copy of
 * each variable bill whose own linked payments run above its plan (Tre, 2026-09-05; see
 * docs/dynamic-cash-floor.md s.3 and lib/variable-bill-history.ts for the design).
 *
 * ⚠️ USE IT AT EVERY COMPUTE ENTRY POINT, OR THE SIM AND THE ENGINE DISAGREE. The floor is read by
 * fourteen call sites. They all take `rules` from one of four places - CardProjectionContext (the
 * sim), useForecastEngineInputs (the engine), Dashboard, and DebtPayoff (CreditCardEngine) - and
 * each of those runs its rules through this hook. A fifth surface computing a floor from raw
 * `useRecurringRules()` would reserve less and show a different payoff date with nothing going red.
 *
 * ⚠️ NEVER FEED THE RESULT TO A WRITE. `floor_buffer` is not a column, `sanitizePayload` passes
 * unknown keys through, and a write spreading one of these rows would send it to Postgres. That is
 * why this returns copies and the query cache keeps the plain rows.
 *
 * Returns the SAME array it was given while the history is loading, in demo, and for anyone with no
 * variable bill above plan - which is what keeps every such user's floor byte-identical. The cost is
 * one recompute when the history lands for a user who does have a buffer.
 */
export function useFloorBufferedRules<T extends RuleRow>(rules: T[]): T[];
export function useFloorBufferedRules<T extends RuleRow>(rules: T[] | undefined): T[] | undefined;
export function useFloorBufferedRules<T extends RuleRow>(rules: T[] | undefined): T[] | undefined {
  const { data: history } = useLinkedRulePayments();

  return useMemo(() => {
    if (!rules || !history) return rules;
    const buffers = buildVariableBillBuffers(rules, history.reviews, history.charges);
    return applyFloorBuffers(rules, buffers) as T[];
  }, [rules, history]);
}

/**
 * Every "this charge paid that rule" decision the user has made, with the charge it names.
 *
 * One embedded select over the review table rather than the user's whole bank history: only the
 * linked charges are ever read, and fetching every synced transaction on every money page would
 * cost a paginated download to reach a few dozen rows.
 *
 * A PENDING charge is left out on purpose: its amount can still change, and a floor sized from a
 * number the bank has not settled is the confident figure this app refuses to print. It then counts
 * as `chargeNotFound` in the builder rather than vanishing.
 */
export function useLinkedRulePayments() {
  const { user } = useAuth();
  const { isDemo } = useDemo();
  const { viewedUserId } = useViewedProfile();
  return useQuery({
    // Under the reviews prefix on purpose: every review write already invalidates
    // ['synced_transaction_reviews'], and that prefix match is what refreshes a buffer after a link.
    queryKey: ['synced_transaction_reviews', 'linked_rule_payments', isDemo ? 'demo' : (viewedUserId ?? user?.id)],
    enabled: isDemo || !!user,
    queryFn: async (): Promise<{ reviews: HistoryReview[]; charges: HistoryCharge[] }> => {
      if (isDemo || !user) return { reviews: [], charges: [] };
      const { data, error } = await supabase
        .from('synced_transaction_reviews')
        .select('status, rule_id, synced_transaction_id, occurrence_month, occurrence_date, synced_transactions(id, amount, date, pending)')
        .eq('user_id', viewedUserId ?? user.id)
        .eq('status', 'linked_rule');
      if (error) throw error;

      const reviews: HistoryReview[] = [];
      const charges: HistoryCharge[] = [];
      for (const row of data ?? []) {
        reviews.push({
          status: row.status, rule_id: row.rule_id, synced_transaction_id: row.synced_transaction_id,
          occurrence_month: row.occurrence_month, occurrence_date: row.occurrence_date,
        });
        const st = row.synced_transactions as { id: string; amount: number; date: string; pending: boolean | null } | null;
        if (st && !st.pending) charges.push({ id: st.id, amount: st.amount, date: st.date });
      }
      return { reviews, charges };
    },
  });
}
