// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';

// Regression test for a bug where scaling a month's combined revolving payment down to protect
// cash for a future one-time expense applied the same scale factor to every card uniformly. That
// can push an individual card below its own minimum payment even though the combined total still
// covers every card's minimum in aggregate (confirmed on a real account: a card's natural payment
// was already close to its minimum, so any uniform scale-down sent it under). Fixed for month 0's
// perCardAdjusted; this test guards the same fix in perCardPaymentsScaled (months 1+), across the
// full 36-month horizon, not just the specific month the bug was first found in.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

describe('useCardProjection minimum-payment protection', () => {
  it('never pays a revolving card below its own minimum, even when a future expense forces a save-up reduction', () => {
    const now = new Date();
    const checkingId = 'checking-1';
    const highCardId = 'card-high-apr';
    const lowCardId = 'card-low-balance';

    const accounts = [
      { id: checkingId, name: 'Checking', account_type: 'checking', balance: 1500, active: true },
      { id: highCardId, name: 'High APR Card', account_type: 'credit_card', balance: 6000, credit_limit: 15000, apr: 27, payment_due_day: 1, active: true, min_payment: 150, payment_preference: 'statement' },
      { id: lowCardId, name: 'Low Balance Card', account_type: 'credit_card', balance: 1100, credit_limit: 5000, apr: 19, payment_due_day: 1, active: true, min_payment: 99, payment_preference: 'statement' },
    ];
    const debts = [
      { id: highCardId, name: 'High APR Card', balance: 6000, apr: 27, min_payment: 150, target_payment: 400, credit_limit: 15000 },
      { id: lowCardId, name: 'Low Balance Card', balance: 1100, apr: 19, min_payment: 99, target_payment: 99, credit_limit: 5000 },
    ];
    const rules = [
      { id: 'income-1', name: 'Paycheck', amount: 1800, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
      { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
    ];
    // A large one-time expense a few months out — big enough relative to cash flow that PASS-2
    // needs to reduce earlier months' debt payments to protect the floor when it hits.
    const futureMonth = new Date(now.getFullYear(), now.getMonth() + 3, 15);
    const transactions: any[] = [
      { id: 'one-time-1', date: `${futureMonth.getFullYear()}-${String(futureMonth.getMonth() + 1).padStart(2, '0')}-15`, type: 'expense', amount: 3500, category: 'Other', payment_source: `account:${checkingId}` },
    ];
    const carFunds: any[] = [];
    const goals: any[] = [];
    const profile: any = null;

    const payConfig = buildPayConfig(profile);
    const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { result } = renderHook(() => useCardProjection({
      accounts, transactions, rules, debts, goals, carFunds, profile,
      debtPayoffOptions: { cashFloor: 500 },
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

    const r = result.current;
    expect(r).not.toBeNull();

    const violations: string[] = [];
    for (const card of r!.simCards) {
      const series = r!.perCardPaymentsScaled.find(p => p.id === card.id);
      expect(series).toBeDefined();
      for (let m = 0; m < 36; m++) {
        const revBal = r!.monthlyRevolvingBalances.get(card.id)?.[m] ?? 0;
        const pay = series!.payments[m];
        // A card with a remaining revolving balance must either be paid at least its minimum,
        // or have its full remaining balance paid off (a smaller final payment is correct then).
        if (revBal > 0 && pay > 0 && pay < card.minPayment - 1 && pay < revBal - 1) {
          violations.push(`month ${m}, ${card.name}: paid ${pay}, min ${card.minPayment}, revBal ${revBal}`);
        }
      }
    }
    expect(violations).toEqual([]);

    // Also check month 0's perCardAdjusted (the separate month-0-specific code path).
    for (const item of r!.month0.perCardAdjusted) {
      const card = r!.simCards.find(c => c.id === item.id);
      const revBal = r!.monthlyRevolvingBalances.get(item.id)?.[0] ?? 0;
      if (revBal > 0 && item.payment > 0 && item.payment < (card?.minPayment ?? 0) - 1 && item.payment < revBal - 1) {
        violations.push(`month 0 (perCardAdjusted), ${item.name}: paid ${item.payment}, min ${card?.minPayment}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('redirects surplus to the highest-APR card with a balance before any lower-priority card exceeds its minimum (avalanche)', () => {
    const checkingId = 'checking-1';
    const highCardId = 'card-high-apr';
    const lowCardId = 'card-low-apr';

    // No future large event — plenty of cash relative to expenses, so PASS-3's surplus redirect
    // fires most months, sending any cash above the floor to debt.
    const accounts = [
      { id: checkingId, name: 'Checking', account_type: 'checking', balance: 3000, active: true },
      { id: highCardId, name: 'High APR Card', account_type: 'credit_card', balance: 6000, credit_limit: 15000, apr: 27, payment_due_day: 1, active: true, min_payment: 150, payment_preference: 'statement' },
      { id: lowCardId, name: 'Low APR Card', account_type: 'credit_card', balance: 1100, credit_limit: 5000, apr: 12, payment_due_day: 1, active: true, min_payment: 99, payment_preference: 'statement' },
    ];
    const debts = [
      { id: highCardId, name: 'High APR Card', balance: 6000, apr: 27, min_payment: 150, target_payment: 400, credit_limit: 15000 },
      { id: lowCardId, name: 'Low APR Card', balance: 1100, apr: 12, min_payment: 99, target_payment: 99, credit_limit: 5000 },
    ];
    const rules = [
      { id: 'income-1', name: 'Paycheck', amount: 3000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
      { id: 'bill-1', name: 'Rent', amount: 1000, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
    ];
    const transactions: any[] = [];
    const carFunds: any[] = [];
    const goals: any[] = [];
    const profile: any = null;

    const payConfig = buildPayConfig(profile);
    const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
    const now = new Date();
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { result } = renderHook(() => useCardProjection({
      accounts, transactions, rules, debts, goals, carFunds, profile,
      debtPayoffOptions: { cashFloor: 500 },
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

    const lowSeries = r.perCardPaymentsScaled.find(p => p.id === lowCardId)!;
    const lowCard = r.simCards.find(c => c.id === lowCardId)!;
    const violations: string[] = [];
    for (let m = 0; m < 36; m++) {
      const lowPay = lowSeries.payments[m];
      const highRevBal = r.monthlyRevolvingBalances.get(highCardId)?.[m] ?? 0;
      // The low-APR card should only be paid above its own minimum once the high-APR card's
      // balance is fully cleared — avalanche must exhaust the higher-priority card first.
      if (lowPay > lowCard.minPayment + 1 && highRevBal > 1) {
        violations.push(`month ${m}: Low APR card paid ${lowPay} (min ${lowCard.minPayment}) while High APR card still owes ${highRevBal}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
