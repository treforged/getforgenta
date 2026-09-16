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
  useAllSyncedTransactions, useSyncedTransactionReviewsQuery, useRecurringRules, useAccounts,
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
  const accounts = useAccounts();

  // All FOUR, because a proposal computed from some of the inputs is a wrong proposal offered
  // confidently — without the rules, every merchant looks uncovered.
  // ⚠️ `accounts` IS IN THIS LIST FOR A SHARPER REASON THAN THE OTHER THREE. Loading and owning no
  // accounts are indistinguishable downstream, and the difference is not a missing proposal but a
  // WRONG one: with no accounts, `detectTransferLegs` can recognise nothing, so a transfer to the
  // user's own brokerage would be offered as a variable expense — the exact defect this input
  // exists to fix, re-created by a race.
  const isLoading = charges.isLoading || reviews.isLoading || rules.loading || accounts.loading;

  const proposals = useMemo(() => {
    if (isLoading) return [];
    return proposeRulesFromHistory({
      charges: (charges.data ?? []) as HistoryCharge[],
      rules: (rules.data ?? []) as ProposalRule[],
      links: reviews.data ?? [],
      accounts: accounts.data ?? [],
    });
  }, [isLoading, charges.data, rules.data, reviews.data, accounts.data]);

  return { proposals, isLoading, hasProposals: !isLoading && proposals.length > 0 };
}
