import { useMemo } from 'react';
import { useAccounts, useAllSyncedTransactions, useSyncedTransactionReviewsQuery, useTransactions } from '@/hooks/useSupabaseData';
import { useMonthlyCashFlow } from '@/hooks/useMonthlyCashFlow';
import { findExclusiveReview } from '@/lib/synced-transaction-review';
import { detectTransferPairs, indexPairsByLeg } from '@/lib/transfer-pair-detection';
import { averageMonthlySpentCents } from '@/lib/budget-spent';

const MONTHS = 5;

/**
 * "Avg Monthly Spend", 5 full months, read from the BANK where the bank has rows (ask 0ac9c4b3).
 *
 * `useMonthlyCashFlow().avgMonthlySpend` reads only the `transactions` ledger, and bank charges reach
 * the ledger only when a user imports them - by design, because the forecast reads the ledger and
 * also projects bills from rules, so importing everything would count each bill twice. That design
 * stays; this figure answers "what did I actually spend", which the ledger cannot. A month with no
 * bank rows keeps the ledger figure, so a user without a bank connection sees what they saw before.
 *
 * Its own hook, not part of `useMonthlyCashFlow`, so the full bank history is fetched only where this
 * figure renders rather than on every Dashboard load. The cash-flow BARS stay on the ledger: their
 * income side is ledger-only too, and moving only the expense side would draw a false negative net.
 */
export function useAvgMonthlySpent(): number {
  const { cashFlowData } = useMonthlyCashFlow();
  const { data: bank } = useAllSyncedTransactions();
  const { data: reviews } = useSyncedTransactionReviewsQuery();
  const { data: ledger } = useTransactions();
  const { data: accounts } = useAccounts();

  return useMemo(() => {
    const now = new Date();
    // cashFlowData holds months now-5 .. now, oldest first, expenses in whole dollars.
    const ledgerByKey = new Map<string, number>();
    for (let k = 1; k <= MONTHS; k += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      ledgerByKey.set(key, Math.round((cashFlowData[MONTHS - k]?.expenses ?? 0) * 100));
    }

    const rows = bank ?? [];
    const byTxn = new Map<string, NonNullable<typeof reviews>>();
    for (const r of reviews ?? []) {
      byTxn.set(r.synced_transaction_id, [...(byTxn.get(r.synced_transaction_id) ?? []), r]);
    }
    const overrides = new Map<string, string>();
    byTxn.forEach((group, id) => {
      const c = findExclusiveReview(group)?.category_override;
      if (c) overrides.set(id, c);
    });
    const transferLegIds = new Set(indexPairsByLeg(detectTransferPairs(rows, accounts ?? [])).keys());

    const { averageCents } = averageMonthlySpentCents({
      bank: rows,
      ledger: ledger ?? [],
      now,
      months: MONTHS,
      overrides,
      transferLegIds,
      ledgerOnlyCents: (key) => ledgerByKey.get(key) ?? 0,
    });
    return averageCents / 100;
  }, [cashFlowData, bank, reviews, ledger, accounts]);
}
