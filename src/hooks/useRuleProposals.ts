// §1C — the rules the user's own history implies, as the app's components read them.
//
// The rules all live in `@/lib/rules-from-history` and are tested there without a database. This
// file is only the wiring: three caches Bank Activity already reads, fed into
// `proposeRulesFromHistory`.
//
// ⚠️ AN EMPTY LIST IS A REAL ANSWER AND MUST STAY ONE. No proposals means the history said nothing
// the app is confident enough to offer — a screen saying "we found 0 patterns" would be a confident
// zero, so callers render NOTHING at all in that case. `hasProposals` is the flag to gate on, and it
// is false while the inputs are still loading.

import { useMemo } from 'react';
import {
  useAllSyncedTransactions, useSyncedTransactionReviewsQuery, useRecurringRules,
} from './useSupabaseData';
import { proposeRulesFromHistory, type RuleProposal, type HistoryCharge, type ProposalRule } from '@/lib/rules-from-history';

export interface UseRuleProposalsResult {
  proposals: RuleProposal[];
  /** True until every input has landed. Callers must not decide there is nothing while this is true. */
  isLoading: boolean;
  /** The one thing an entry point should gate on — never `proposals.length` while loading. */
  hasProposals: boolean;
}

export function useRuleProposals(): UseRuleProposalsResult {
  const charges = useAllSyncedTransactions();
  const reviews = useSyncedTransactionReviewsQuery();
  const rules = useRecurringRules();

  // All three, because a proposal computed from some of the inputs is a wrong proposal offered
  // confidently — without the rules, every merchant looks uncovered.
  const isLoading = charges.isLoading || reviews.isLoading || rules.loading;

  const proposals = useMemo(() => {
    if (isLoading) return [];
    return proposeRulesFromHistory({
      charges: (charges.data ?? []) as HistoryCharge[],
      rules: (rules.data ?? []) as ProposalRule[],
      links: reviews.data ?? [],
    });
  }, [isLoading, charges.data, rules.data, reviews.data]);

  return { proposals, isLoading, hasProposals: !isLoading && proposals.length > 0 };
}
