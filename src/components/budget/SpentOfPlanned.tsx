/**
 * Budget Simple: what has actually been SPENT this month against what the rules PLAN (ask e1b0fffc (c),
 * docs/simple-view/PROPOSAL.md:52 - "Spent of planned (one bar); categories with one progress bar each").
 *
 * SPENT comes from BANK rows (`synced_transactions`), not the `transactions` ledger: measured on
 * 2026-10-05, a linked account's October bank charges never reach the ledger (0 synced-origin rows),
 * and the ledger holds mostly FUTURE planned one-offs. Ledger rows count only when hand-entered and
 * dated month-to-date. Rules for each row live in `src/lib/budget-spent.ts`.
 * PLANNED is the fixed + variable buckets only: debt payments and transfers are paying earlier
 * spending or moving money, and an unmatched card payment is excluded from SPENT for the same reason.
 *
 * Reads only; works under per-user RLS (every query is the user's own rows).
 */
import { useMemo } from 'react';
import ProgressBar from '@/components/shared/ProgressBar';
import { formatCurrency } from '@/lib/calculations';
import { useSyncedTransactions, useSyncedTransactionReviewsQuery, useTransactions, useAccounts } from '@/hooks/useSupabaseData';
import { useMatchedOccurrences } from '@/hooks/useMatchedOccurrences';
import { findExclusiveReview } from '@/lib/synced-transaction-review';
import { detectTransferPairs, indexPairsByLeg } from '@/lib/transfer-pair-detection';
import { computeMonthSpent, buildSpentRows, matchedRuleCategory } from '@/lib/budget-spent';
import { toLocalDateStr } from '@/lib/scheduling';

interface Props {
  rules: readonly { id: string; category: string; rule_type?: string | null }[];
  plannedRules: readonly { category: string; amount: number }[];
}

const SpentOfPlanned = ({ rules, plannedRules }: Props) => {
  // Fixed per mount, as `useMatchedOccurrences` fixes its month, so both read the same month.
  const { monthKey, monthName, from, to } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    return {
      monthKey: `${y}-${String(m + 1).padStart(2, '0')}`,
      monthName: now.toLocaleString('en-US', { month: 'long' }),
      from: toLocalDateStr(new Date(y, m, 1)),
      to: toLocalDateStr(now),
    };
  }, []);

  const { data: synced } = useSyncedTransactions(monthKey);
  const { data: transactions } = useTransactions();
  const { data: accounts } = useAccounts();
  const { data: reviews } = useSyncedTransactionReviewsQuery();
  const { index: matchedIndex } = useMatchedOccurrences();

  const groupedReviews = useMemo(() => {
    const map = new Map<string, NonNullable<typeof reviews>>();
    (reviews || []).forEach(r => {
      map.set(r.synced_transaction_id, [...(map.get(r.synced_transaction_id) || []), r]);
    });
    return map;
  }, [reviews]);

  const overrides = useMemo(() => {
    const map = new Map<string, string>();
    groupedReviews.forEach((group, id) => {
      const override = findExclusiveReview(group)?.category_override;
      if (override) map.set(id, override);
    });
    return map;
  }, [groupedReviews]);

  const matchedCategory = useMemo(() => {
    const map = new Map<string, string>();
    matchedIndex.forEach(v => {
      if (!v.suppressOnly && v.transactionId) {
        const rule = rules.find(r => r.id === v.ruleId);
        if (rule) map.set(v.transactionId, matchedRuleCategory(rule));
      }
    });
    return map;
  }, [matchedIndex, rules]);

  const transferLegIds = useMemo(() => {
    if (!synced || !accounts) return new Set<string>();
    return new Set(indexPairsByLeg(detectTransferPairs(synced, accounts)).keys());
  }, [synced, accounts]);

  const { rows, plannedCents, spentCents } = useMemo(() => {
    if (!synced || !accounts) return { rows: [], plannedCents: 0, spentCents: 0 };
    const computed = computeMonthSpent({
      bank: synced,
      ledger: transactions ?? [],
      from,
      to,
      matchedCategory,
      overrides,
      transferLegIds,
    });
    return buildSpentRows(plannedRules, computed.byCategory);
  }, [synced, accounts, transactions, from, to, matchedCategory, overrides, transferLegIds, plannedRules]);

  if (plannedCents === 0 && spentCents === 0) return null;

  return (
    <section className="card-forged p-4 sm:p-5 lg:col-span-2" data-testid="spent-of-planned">
      <h3 className="text-sm sm:text-base font-semibold text-muted-foreground uppercase tracking-wider mb-1">
        Spent so far
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        {monthName} 1 – today, from your bank and the charges you added
      </p>
      <p className="text-lg font-semibold tabular-nums">
        {formatCurrency(spentCents / 100)}{' '}
        <span className="text-sm font-normal text-muted-foreground">of {formatCurrency(plannedCents / 100)} planned</span>
      </p>
      <ProgressBar value={spentCents} max={plannedCents} thick className="mt-2" />
      {spentCents > plannedCents && plannedCents > 0 && (
        <p className="text-sm text-destructive mt-1">
          {formatCurrency((spentCents - plannedCents) / 100)} over plan
        </p>
      )}
      {rows.length > 0 && (
        <ul className="mt-4 space-y-3">
          {rows.map(row => (
            <li key={row.category} data-testid="spent-row" className="space-y-1">
              <div className="flex justify-between gap-3 text-sm">
                <span className="truncate min-w-0">{row.category}</span>
                <span className="tabular-nums shrink-0">
                  {row.plannedCents > 0
                    ? `${formatCurrency(row.spentCents / 100)} of ${formatCurrency(row.plannedCents / 100)}`
                    : `${formatCurrency(row.spentCents / 100)} · not in your plan`}
                </span>
              </div>
              {row.plannedCents > 0 && <ProgressBar value={row.spentCents} max={row.plannedCents} className="mt-1" />}
              {row.plannedCents > 0 && row.spentCents > row.plannedCents && (
                <p className="text-xs text-destructive">{formatCurrency((row.spentCents - row.plannedCents) / 100)} over</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default SpentOfPlanned;
