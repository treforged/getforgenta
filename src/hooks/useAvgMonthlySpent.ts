import { useMemo } from 'react';
import { useAccounts, useAllSyncedTransactions, useSyncedTransactionReviewsQuery, useTransactions } from '@/hooks/useSupabaseData';
import { useMonthlyCashFlow } from '@/hooks/useMonthlyCashFlow';
import { findExclusiveReview } from '@/lib/synced-transaction-review';
import { detectTransferPairs, indexPairsByLeg } from '@/lib/transfer-pair-detection';
import { averageMonthlySpentCents, computeMonthIncomeCents, computeMonthSpent } from '@/lib/budget-spent';
import type { CashFlowMonth } from '@/hooks/useMonthlyCashFlow';

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
 * Its own hook, not part of `useMonthlyCashFlow`, so the full bank history is fetched only where these
 * figures render rather than on every Dashboard load.
 *
 * `cashFlowData` (ask 01979820): months 1-5 that have bank rows take BOTH income and expenses from
 * the bank, never one side alone - the ledger misses bank income exactly as it misses bank spending,
 * so moving only expenses would draw a false negative net. Month 0 (the current month) is unchanged:
 * it is the all-in projection `useMonthlyCashFlow` builds.
 */
export function useBankCashFlow(): { cashFlowData: CashFlowMonth[]; avgMonthlySpend: number } {
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
    const bankData = cashFlowData.map((m, idx) => {
      const k = MONTHS - idx;
      if (k < 1) return m;
      const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
      const pad = (x: number) => String(x).padStart(2, '0');
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
      const to = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(last.getDate())}`;
      if (!rows.some(t => t.date >= from && t.date <= to)) return m;
      const income = Math.round(computeMonthIncomeCents({ bank: rows, ledger: ledger ?? [], from, to, overrides, transferLegIds }) / 100);
      const expenses = Math.round(computeMonthSpent({ bank: rows, ledger: ledger ?? [], from, to, matchedCategory: new Map(), overrides, transferLegIds }).totalCents / 100);
      return { ...m, income, expenses, net: income - expenses };
    });
    return { cashFlowData: bankData, avgMonthlySpend: averageCents / 100 };
  }, [cashFlowData, bank, reviews, ledger, accounts]);
}

/** Avg Monthly Spend alone - see {@link useBankCashFlow}. */
export function useAvgMonthlySpent(): number {
  return useBankCashFlow().avgMonthlySpend;
}
