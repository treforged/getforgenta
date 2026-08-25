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
  usePaymentPlans, useCarFunds, useProfile, useAccounts,
  type BankActivityRow, type RuleRow, type TransactionRow, type SyncedTransactionReviewRow,
} from './useSupabaseData';
import { buildReviewQueue, type ReviewQueue } from '@/lib/bank-activity-queue';
import { accountLinkDays, scopeQueueToLinkedHistory } from '@/lib/link-day-scope';
import type { ObligationPlan } from '@/lib/charge-obligations';

export type BankReviewQueue = ReviewQueue<BankActivityRow, RuleRow, TransactionRow, ObligationPlan>;

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
  const plans = usePaymentPlans();
  const carFunds = useCarFunds();
  const accounts = useAccounts();
  const { data: profile } = useProfile();

  // `useRecurringRules`/`useTransactions` expose `loading`; the two raw `useQuery`s expose
  // `isLoading`. Both are read rather than picking one, because a count computed from some of the
  // inputs is a wrong count rendered confidently.
  //
  // ⚠️ PLANS AND CAR FUNDS COUNT TOWARDS `isLoading` TOO, now that they produce suggestions. Leaving
  // them out would render a settled-looking count that then grows once they land — the badge would
  // be wrong in the one direction users notice.
  //
  // ⚠️ ACCOUNTS COUNT TOO, for the same reason: they carry the link days, and a queue built before
  // they land would show the whole imported history for a moment and then quietly shrink.
  const isLoading = charges.isLoading || reviews.isLoading || rules.loading || ledger.loading
    || plans.loading || carFunds.loading || accounts.loading;

  const reviewsByCharge = useMemo(
    () => groupReviewsByCharge(reviews.data ?? []),
    [reviews.data],
  );

  const fundingAccountId = profile?.default_deposit_account ?? null;

  /**
   * ⚠️ HISTORY THAT ARRIVED WITH A LINK IS NOT A TO-DO — see `link-day-scope.ts`.
   *
   * The queue is still BUILT from the full history, because a bill due on the 1st can settle in the
   * prior month and filtering the matcher's corpus would drop those. What is scoped is the output:
   * which charges are put in front of the user and which are counted. Everything before an account's
   * link day stays one tap away under "All activity" on Bank Activity, and accounts whose link day
   * cannot be read are untouched.
   */
  const linkDays = useMemo(() => accountLinkDays(accounts.data ?? []), [accounts.data]);

  const queue = useMemo(() => scopeQueueToLinkedHistory(
    buildReviewQueue<BankActivityRow, RuleRow, TransactionRow, ObligationPlan>({
      charges: charges.data ?? [],
      reviewsByCharge,
      rules: rules.data ?? [],
      ledger: ledger.data ?? [],
      plans: plans.data ?? [],
      carFunds: carFunds.data ?? [],
      fundingAccountId,
      rejected,
    }),
    linkDays,
  ), [charges.data, reviewsByCharge, rules.data, ledger.data, plans.data, carFunds.data, fundingAccountId, rejected, linkDays]);

  return { queue, reviewsByCharge, isLoading };
}

/**
 * The badge number, from a queue a caller already has.
 *
 * ⚠️ RETURNS NULL, NOT 0, UNTIL IT KNOWS. A badge reading 0 and a badge that failed to load look
 * identical to a user, so callers render nothing at all until there is a real reading. Also null
 * when the answer is genuinely zero, because there is nothing to say and an empty badge is noise.
 *
 * Pure, and exported, because two callers need this rule from ONE queue: `Transactions.tsx` reads
 * the queue itself (it also asks whether anything is waiting, to decide where the bank half sits on
 * the merged panel) and would otherwise mount a second `useBankReviewQueue` purely to get a number
 * — a second full matcher run over every synced charge, on every render of the page.
 */
export function reviewBadgeCount(queue: BankReviewQueue, isLoading: boolean): number | null {
  if (isLoading || queue.suggestedCount === 0) return null;
  return queue.suggestedCount;
}

/** Just the badge number — how many charges the app has an answer for and is waiting on. */
export function useBankReviewQueueCount(): number | null {
  const { queue, isLoading } = useBankReviewQueue();
  return reviewBadgeCount(queue, isLoading);
}
