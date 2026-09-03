/**
 * Smart expense filtering - excludes expenses that have already been paid
 * and should be reflected in current account balances.
 *
 * This prevents double-counting: if rent was due on the 1st and today is the 5th,
 * we assume it's been paid and the account balance already reflects it.
 */

import type { EnrichedTransaction } from './pay-schedule';
import { toLocalDateStr } from './scheduling';

type ExpenseTransaction = EnrichedTransaction & { debtCardName?: string };

/**
 * Filter transactions to only include future/unpaid expenses.
 * Assumes any expense with a date in the past has been paid and is reflected in balances.
 */
export function getUnpaidExpenses(transactions: ExpenseTransaction[], referenceDate: Date = new Date()): ExpenseTransaction[] {
  // ⚠️ COMPARED AS STRINGS, NOT AS DATES. `t.date` is `YYYY-MM-DD`, and
  // `new Date('2026-09-03')` is UTC MIDNIGHT — 3 September at 00:00Z, which is
  // the EVENING OF THE 2ND at any negative offset. Compared against a local
  // midnight `today`, an expense dated TODAY therefore sorted as already past
  // and was dropped from "unpaid" every single day in US Eastern. That
  // understates remaining expenses, which overstates spare cash — the unsafe
  // direction, on a bill that has not been paid yet.
  //
  // This is the same defect that, in `scheduling.ts`, charged a $1,480 rent rule
  // a month early and moved the projected CC payoff by three months (2026-09-03).
  // Two ISO dates compare correctly as strings in every timezone, so the fix is
  // to stop constructing Dates at all rather than to parse them more carefully.
  const todayStr = toLocalDateStr(referenceDate);

  return transactions.filter(t => {
    if (t.type !== 'expense') return false;
    if (!t.date) return true; // No date = count it as unpaid to be safe

    // Only include expenses dated today or in the future.
    return t.date.slice(0, 10) >= todayStr;
  });
}

/**
 * Calculate remaining expenses for the month, excluding past expenses
 * that should already be reflected in account balances.
 */
export function getRemainingMonthExpenses(
  transactions: ExpenseTransaction[],
  excludeDebtPayments: boolean = true
): number {
  const unpaid = getUnpaidExpenses(transactions);

  return unpaid.reduce((sum, t) => {
    // Optionally exclude debt payment transactions
    if (excludeDebtPayments && (
      t.isDebtPayment ||
      t.category?.toLowerCase().includes('debt') ||
      t.category?.toLowerCase().includes('credit card')
    )) {
      return sum;
    }
    return sum + Number(t.amount || 0);
  }, 0);
}

/**
 * Separate expenses into categories, excluding debt payments.
 */
export function categorizeExpenses(transactions: ExpenseTransaction[], excludeDebtPayments: boolean = true): Record<string, number> {
  const totals: Record<string, number> = {};

  transactions.forEach(t => {
    if (t.type !== 'expense') return;

    // Skip debt payments if requested
    if (excludeDebtPayments && (
      t.isDebtPayment ||
      t.category?.toLowerCase().includes('debt') ||
      t.category?.toLowerCase().includes('credit card')
    )) {
      return;
    }

    const category = t.category || 'Other';
    totals[category] = (totals[category] || 0) + Number(t.amount || 0);
  });

  return totals;
}

/**
 * Get debt payment transactions separately.
 */
export function getDebtPayments(transactions: ExpenseTransaction[]): ExpenseTransaction[] {
  return transactions.filter(t =>
    t.type === 'expense' && (
      t.isDebtPayment ||
      t.category?.toLowerCase().includes('debt') ||
      t.category?.toLowerCase().includes('credit card')
    )
  );
}

/**
 * Calculate total debt payments for the month by card.
 */
export function getDebtPaymentsByCard(transactions: ExpenseTransaction[]): { cardName: string; amount: number }[] {
  const debtTxns = getDebtPayments(transactions);
  const byCard: Record<string, number> = {};

  debtTxns.forEach(t => {
    const cardName = t.debtCardName || t.note || 'Other';
    byCard[cardName] = (byCard[cardName] || 0) + Number(t.amount || 0);
  });
  
  return Object.entries(byCard)
    .map(([cardName, amount]) => ({ cardName, amount }))
    .sort((a, b) => b.amount - a.amount);
}
