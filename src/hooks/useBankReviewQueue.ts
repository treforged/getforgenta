// §1B Stage 5 — the review queue, as the app's own components read it.
//
// The rules all live in `@/lib/bank-activity-queue` and are tested there without a database. This
// file is only the wiring: the same four react-query caches Bank Activity already reads, fed into
// `buildReviewQueue`.
//
// ⚠️ READ THAT FILE'S HEADER BEFORE CHANGING WHAT THE COUNT MEANS. It is a count of SUGGESTIONS
// AWAITING A DECISION, never of unreviewed rows — unreviewed means nothing at all, most rows are
// permanently unreviewed by design, and a badge nobody can drive to zero is nagging.

import { useMemo } from 'react';
import {
  useAllSyncedTransactions, useSyncedTransactionReviewsQuery, useRecurringRules, useTransactions,
  type BankActivityRow, type RuleRow, type TransactionRow, type SyncedTransactionReviewRow,
} from './useSupabaseData';
import { buildReviewQueue, type ReviewQueue } from '@/lib/bank-activity-queue';

export type BankReviewQueue = ReviewQueue<BankActivityRow, RuleRow, TransactionRow>;

/** Module-level so the default argument is referentially stable — a fresh `{}` per render would
 *  invalidate the memo below on every render and re-match the whole history each time. */
const NO_REJECTIONS: Readonly<Record<string, true>> = {};

/**
 * Every decision already recorded, grouped by the charge it is about.
 *
 * Exported because Bank Activity renders these badges as well as counting them, and building the
 * same map twice off the same cache is how two surfaces end up disagreeing about one charge.
 */
export function groupReviewsByCharge(
  reviews: readonly SyncedTransactionReviewRow[],
): Record<string, SyncedTransactionReviewRow[]> {
  const map: Record<string, SyncedTransactionReviewRow[]> = {};
  reviews.forEach(r => { (map[r.synced_transaction_id] ??= []).push(r); });
  return map;
}

export interface UseBankReviewQueueResult {
  queue: BankReviewQueue;
  reviewsByCharge: Record<string, SyncedTransactionReviewRow[]>;
  /** True until every input has landed. Callers must not render a count while this is true. */
  isLoading: boolean;
}

/**
 * @param rejected charges the user pressed "Not this" on this session. Session state by Tre's
 *   2026-08-09 decision, so it is passed in rather than owned here.
 */
export function useBankReviewQueue(
  rejected: Readonly<Record<string, true>> = NO_REJECTIONS,
): UseBankReviewQueueResult {
  const charges = useAllSyncedTransactions();
  const reviews = useSyncedTransactionReviewsQuery();
  const rules = useRecurringRules();
  const ledger = useTransactions();

  // `useRecurringRules`/`useTransactions` expose `loading`; the two raw `useQuery`s expose
  // `isLoading`. Both are read rather than picking one, because a count computed from three of four
  // inputs is a wrong count rendered confidently.
  const isLoading = charges.isLoading || reviews.isLoading || rules.loading || ledger.loading;

  const reviewsByCharge = useMemo(
    () => groupReviewsByCharge(reviews.data ?? []),
    [reviews.data],
  );

  const queue = useMemo(() => buildReviewQueue<BankActivityRow, RuleRow, TransactionRow>({
    charges: charges.data ?? [],
    reviewsByCharge,
    rules: rules.data ?? [],
    ledger: ledger.data ?? [],
    rejected,
  }), [charges.data, reviewsByCharge, rules.data, ledger.data, rejected]);

  return { queue, reviewsByCharge, isLoading };
}

/**
 * Just the badge number — how many charges the app has an answer for and is waiting on.
 *
 * ⚠️ RETURNS NULL, NOT 0, UNTIL IT KNOWS. A badge reading 0 and a badge that failed to load look
 * identical to a user, so callers render nothing at all until there is a real reading. Also null
 * when the answer is genuinely zero, because there is nothing to say and an empty badge is noise.
 */
export function useBankReviewQueueCount(): number | null {
  const { queue, isLoading } = useBankReviewQueue();
  if (isLoading || queue.suggestedCount === 0) return null;
  return queue.suggestedCount;
}
