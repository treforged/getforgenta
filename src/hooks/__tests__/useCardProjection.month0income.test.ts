// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';

// Regression test for a bug where month-0 cashPreDebt used m0Income/m0Expenses sourced from
// getRemainingTransactionIncomeByDay/getRemainingTransactionExpensesByDay (a transaction-merge
// engine), while Forecast.tsx's own baseExpenses/netIncome for month 0 are sourced from
// forecastMonthEvents (scheduled-events-based). The two disagreed by the value of any scheduled
// bill/income that fell in the gap between their definitions of "remaining this month" — this
// made Forecast's displayed line items not sum to its own Ending Cash. m0Income/m0Expenses must
// be sourced from the hook's own forecastMonthEvents[0], not recomputed via a different engine.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

describe('useCardProjection month-0 income/expenses', () => {
  it('sources m0Expenses from forecastMonthEvents, including a scheduled bill due later this month', () => {
    const now = new Date();
    const checkingId = 'checking-1';
    const cardId = 'card-1';

    const accounts = [
      { id: checkingId, name: 'Checking', account_type: 'checking', balance: 1000, active: true },
      { id: cardId, name: 'Card', account_type: 'credit_card', balance: 500, credit_limit: 5000, apr: 20, payment_due_day: 1, active: true, min_payment: 25, payment_preference: 'statement' },
    ];
    const debts = [
      { id: cardId, name: 'Card', balance: 500, apr: 20, min_payment: 25, target_payment: 50, credit_limit: 5000 },
    ];
    // A bill due on the 28th of this month, paid from checking (not the card) — should count
    // as a remaining expense for month 0 regardless of today's date within the month, as long
    // as today is before the 28th.
    const billDueDay = Math.min(28, now.getDate() + 5);
    const rules = [
      { id: 'income-1', name: 'Paycheck', amount: 1000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
      { id: 'bill-1', name: 'Subscription', amount: 20, rule_type: 'expense', frequency: 'monthly', due_day: billDueDay, payment_source: checkingId, deposit_account: null, active: true, category: 'Subscriptions' },
    ];
    const transactions: any[] = [];
    const carFunds: any[] = [];
    const goals: any[] = [];
    const profile: any = null;

    const payConfig = buildPayConfig(profile);
    const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const { result } = renderHook(() => useCardProjection({
      accounts, transactions, rules, debts, goals, carFunds, profile,
      debtPayoffOptions: { cashFloor: 100 },
      payConfig,
      scheduledEvents,
      pauseSavings: false,
      forecastFundingAccountId: checkingId,
      debtStrategy: 'avalanche',
      persistedDebtFundingId: null,
      assumptions: DEFAULT_ASSUMPTIONS,
      syncCutoffDate,
      paymentPlans: [],
    } as any));

    expect(result.current).not.toBeNull();
    // The $20 subscription is due later this month and from a non-CC source — it must show up
    // in m0Expenses (the scheduled-events-based figure), not be silently dropped because a
    // different, transaction-based engine doesn't know about it yet.
    expect(result.current!.m0Expenses).toBe(20);
  });
});
