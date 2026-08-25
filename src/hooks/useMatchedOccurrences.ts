import { useMemo } from 'react';
import { useRecurringRules, useSyncedTransactions, useSyncedTransactionReviewsQuery } from '@/hooks/useSupabaseData';
import { buildMatchedOccurrenceIndex, type MatchedOccurrenceIndex } from '@/lib/auto-matched-occurrences';
import type { ConfirmedOccurrences } from '@/lib/confirmed-capture';

/**
 * The rule occurrences a real payment has already answered this month, in both the views surfaces
 * need: the bare fact, and the figures behind it.
 *
 * ── WHY ONE HOOK ─────────────────────────────────────────────────────────────
 * Four surfaces built a CONFIRMED-ONLY set of their own — Dashboard, Budget Control, Vehicles and
 * the credit-card engine each called `buildConfirmedOccurrences(syncedReviews)` and stopped there —
 * while `useForecastEngineInputs` and `CardProjectionContext` unioned in the automatic matches as
 * well. So the same bill could be captured in the forecast and still charged against remaining cash
 * on the page the user was looking at. This is the union, once, so those two answers cannot differ.
 *
 * ⚠️ `occurrences` IS DERIVED FROM `index`, NOT COMPUTED BESIDE IT. `buildMatchedOccurrenceIndex`
 * applies exactly the gates `buildConfirmedOccurrences` and `buildAutoMatchedOccurrences` apply, in
 * the same key space, so the keys of the map ARE the union of the two sets — and taking them from
 * the map is what stops the suppression a consumer applies from drifting away from the values it
 * renders. That was the §1.1-cause-C lesson: two surfaces gating one charge must agree by
 * construction, not by both being written correctly.
 *
 * ⚠️ CURRENT MONTH ONLY, on the auto half. `useSyncedTransactions` is month-scoped by design (see
 * its own header), and every later month is entirely in the future with no real charge to match.
 * Confirmed reviews are not month-scoped and never have been; a consumer that needs "this month"
 * filters on the occurrence date, as `matchedRuleIdsInMonth` does.
 *
 * Empty for a user with no bank connection, and empty in demo (`useSyncedTransactions` serves no
 * rows there) — which is what keeps every consumer's pre-existing path byte-identical.
 */
export interface MatchedOccurrencesResult {
  /** Every handled occurrence WITH the real date and amount where they are known. */
  index: MatchedOccurrenceIndex;
  /** The same occurrences as the suppression set the engines already take. */
  occurrences: ConfirmedOccurrences;
  /** `YYYY-MM` the auto half was matched over — the month the index's values describe. */
  monthKey: string;
}

export function useMatchedOccurrences(): MatchedOccurrencesResult {
  const { data: rules } = useRecurringRules();
  const monthKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const { data: syncedTransactions } = useSyncedTransactions(monthKey);
  // The read-only view of the reviews, not `useSyncedTransactionReviews` — nothing here writes, and
  // that hook instantiates six mutations. Same query key, so react-query serves both from one fetch.
  const { data: syncedReviews } = useSyncedTransactionReviewsQuery();

  const index = useMemo(() => buildMatchedOccurrenceIndex({
    rules: rules ?? [],
    transactions: syncedTransactions,
    month: new Date(),
    reviews: syncedReviews,
  }), [rules, syncedTransactions, syncedReviews]);

  const occurrences = useMemo<ConfirmedOccurrences>(() => new Set(index.keys()), [index]);

  return { index, occurrences, monthKey };
}
