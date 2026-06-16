// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';

// Regression test for a bug introduced while building the reserve-based look-ahead (see
// useCardProjection.cyclingFloor.test.ts): the look-ahead bootstraps an uncapped simulation pass
// to learn a card-minimum-payment trajectory before any real caps exist. That uncapped pass can
// pay a currently-revolving card off far faster than a properly-protected run ever would. If the
// cycling-payment helper used that uncapped pass's per-month revolving balance to decide whether
// a card was "cycling" that month, it would misclassify an artificially-cleared, still-revolving
// card as fully cycling — turning its ongoing recurring purchases into a "mandatory" cash expense
// instead of its real, reducible revolving allocation. That inflated the perceived future
// shortfall enormously, which cascaded into capping nearly every month at the card minimum (the
// exact over-protective failure mode this rewrite was meant to fix in the first place).
//
// Fix: cycling-vs-revolving classification is gated on the card's LIVE balance (same convention
// cyclingExcessByMonth already used), never on a simulation pass's per-month trajectory — a card
// that's revolving today is never treated as cycling, no matter how optimistic an intermediate
// simulation pass looks.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

describe('useCardProjection cycling classification', () => {
  it('never treats a currently-revolving card as cycling, even when an early simulation pass could pay it off fast', () => {
    const now = new Date();
    const checkingId = 'checking-1';
    const revolvingCardId = 'card-revolving';
    const cyclingCardId = 'card-cycling';

    // A future one-time spike on the already-cycling card (1 month after a heavy recurring
    // purchase) — the trigger that makes the look-ahead reserve cash at all.
    const purchaseTarget = new Date(now.getFullYear(), now.getMonth() + 4, 11);
    const spikeMonthKey = `${purchaseTarget.getFullYear()}-${String(purchaseTarget.getMonth() + 1).padStart(2, '0')}`;

    const accounts = [
      { id: checkingId, name: 'Checking', account_type: 'checking', balance: 4000, active: true },
      // Plenty of cash relative to its balance — an uncapped bootstrap pass would clear this in
      // 1-2 months even though heavy ongoing purchases mean a properly-capped run shouldn't.
      { id: revolvingCardId, name: 'Revolving Card', account_type: 'credit_card', balance: 2000, credit_limit: 15000, apr: 22, payment_due_day: 1, active: true, min_payment: 150, payment_preference: 'statement' },
      { id: cyclingCardId, name: 'Cycling Card', account_type: 'credit_card', balance: 0, credit_limit: 10000, apr: 18, payment_due_day: 11, active: true, min_payment: 0, payment_preference: 'full' },
    ];
    const debts = [
      { id: revolvingCardId, name: 'Revolving Card', balance: 2000, apr: 22, min_payment: 150, target_payment: 600, credit_limit: 15000 },
    ];
    const rules = [
      { id: 'income-1', name: 'Paycheck', amount: 3200, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
      { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
      // Heavy ongoing recurring purchases routed to the revolving card — excluded from the
      // rules-based cash-expense figure (it's a CC charge, not a cash outflow), but real spend
      // that should keep adding to its balance every month if the card is genuinely protected.
      { id: 'bill-2', name: 'Groceries on Revolving Card', amount: 700, rule_type: 'expense', frequency: 'monthly', due_day: 5, payment_source: revolvingCardId, deposit_account: null, active: true, category: 'Groceries' },
      // Heavy recurring purchase on the cycling card, paid in full each statement — sets up the
      // one-time spike the look-ahead needs to protect against.
      { id: 'bill-3', name: 'Recurring purchase on cycling card', amount: 2200, rule_type: 'expense', frequency: 'monthly', due_day: 11, payment_source: cyclingCardId, deposit_account: null, active: true, category: 'Other' },
    ];
    const transactions: any[] = [
      { date: `${spikeMonthKey}-11`, type: 'expense', amount: 1800, category: 'Other', payment_source: `account:${cyclingCardId}`, note: 'one-time spike' },
    ];
    const profile: any = { weekly_gross_income: 0.01 };

    const payConfig = buildPayConfig(profile);
    const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { result } = renderHook(() => useCardProjection({
      accounts, transactions, rules, debts, goals: [], carFunds: [], profile,
      debtPayoffOptions: { cashFloor: 2000 },
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

    const r = result.current!;
    expect(r).not.toBeNull();

    // The bug's signature: misclassifying the revolving card as cycling inflates the future
    // shortfall so much that the cascade caps nearly every month at the card minimum. With the
    // fix, the comfortable cash position here (plenty of income relative to expenses) should
    // leave most months free to pay above the minimum.
    const series = r.perCardPaymentsScaled.find(p => p.id === revolvingCardId)!;
    const card = r.simCards.find(c => c.id === revolvingCardId)!;
    const monthsAtMinimum = series.payments.slice(0, 12).filter(p => p <= card.minPayment + 1).length;
    expect(monthsAtMinimum).toBeLessThan(6);
  });
});
