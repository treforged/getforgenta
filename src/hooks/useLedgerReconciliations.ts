// The React half of the ledger-side link. The DECISION lives in
// `@/lib/ledger-reconciliation-scope`, which imports no Supabase client and is therefore testable
// without a renderer or a browser global — see its header for what this feature is and why.
import { useMemo } from 'react';
import { useSyncedTransactions, useSyncedTransactionReviewsQuery } from '@/hooks/useSupabaseData';
import {
  reconcilableLedgerRows,
  type ReconcilableLedgerRow,
} from '@/lib/ledger-reconciliation-scope';
import type { ReconciliationProposal } from '@/lib/transaction-reconciliation';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';

/**
 * Proposals for the rows on screen, keyed by ledger transaction id.
 *
 * `monthKey` is the month the page is showing. `useSyncedTransactions` fetches that month plus a
 * few days either side, which already spans the matcher's ±5-day window — so a charge that settled
 * just over a month boundary is still a candidate, and the page never pays for a full history.
 */
export function useLedgerReconciliations(
  monthKey: string,
  ledger: readonly ReconcilableLedgerRow[],
): Record<string, ReconciliationProposal> {
  const { data: syncedTxns } = useSyncedTransactions(monthKey);
  const { data: reviews } = useSyncedTransactionReviewsQuery();
  const { isPartnerView } = useViewedProfile();

  /**
   * ⚠️ NOTHING IS OFFERED IN PARTNER VIEW, AND THE REASON IS WORSE THAN "IT WOULD FAIL".
   * Partner view READS the other person's ledger (`useTransactions` selects on `viewedUserId`)
   * while `update` WRITES scoped to `user.id` — so the press would match zero rows, change nothing,
   * and still toast "Transaction updated". A silent no-op reported as success is the exact shape
   * this repo keeps finding, and here it would also record an undo for a write that never happened.
   *
   * ⚠️ THE PAGE'S OWN Edit AND Delete BUTTONS HAVE THE SAME GAP and are NOT fixed here — they
   * predate this and belong to a separate pass. Naming it rather than quietly widening this commit.
   */
  return useMemo(
    () => (isPartnerView ? {} : reconcilableLedgerRows(ledger, syncedTxns ?? [], reviews ?? [])),
    [syncedTxns, reviews, ledger, isPartnerView],
  );
}
