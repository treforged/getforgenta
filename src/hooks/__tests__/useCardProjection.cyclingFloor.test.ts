// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';

// Regression test for a second floor-breach-protection gap found while verifying parity with
// Forecast.tsx's own PASS-2: the look-ahead's cash-flow model only ever subtracted the unusual
// *excess* over a cycling card's normal monthly spend (cyclingExcessByMonth) — never the routine
// baseline statement payment itself. Forecast's own model never had this gap because its
// rawDebtPayment is sourced from allPaymentTotals, which already includes the full cycling
// payment. The look-ahead runs before its own simulation exists, so the baseline cycling amount
// (which depends on simulated per-card payments) wasn't available to it at all — fixed by running
// an iterative bootstrap simulation and feeding each pass's simulated cycling payments back into
// the look-ahead's expense figure (mirrors the same iterative pattern used to fix the bare-vs-
// augmented floor gap).
//
// Scenario: a card that pays its full statement balance every month (no revolving balance, no
// minimum payment) with a real recurring monthly purchase amount, sitting alongside a revolving
// card and a future annual bill. Cash flow is tight enough that accounting for the cycling card's
// routine payment is what actually requires save-up before the annual bill — ignoring it (the old
// behavior) would have let the revolving card overpay in early months with no protection at all.
//
// Also now locks in a fix for a double-reservation bug this exact fixture happened to trigger:
// simulateVariablePayoff's reservedForRevolving (Card A's minimum) was being subtracted from the
// cycling pool a second time on top of the augmented floor, which had already reserved it —
// shorting Card B (cycling) in the annual-bill month even though total cash covered both
// obligations. See ccMinAlreadyInFloorByMonth (credit-card-engine.ts) / ccRevolvingMinIncluded
// (pay-schedule.ts).

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

describe('useCardProjection floor-breach protection (cycling-card baseline payment)', () => {
  it('accounts for a cycling card\'s routine monthly statement payment, not just its excess, when protecting a future floor breach', () => {
    const now = new Date();
    const checkingId = 'checking-1';
    const cardAId = 'card-a-revolving';
    const cardBId = 'card-b-cycling';

    // Annual bill ~4 months out — same mechanism as the other floor-protection regression test.
    const annualTarget = new Date(now.getFullYear(), now.getMonth() + 4, 15);
    const dueMonth = annualTarget.getMonth() + 1;

    const accounts = [
      { id: checkingId, name: 'Checking', account_type: 'checking', balance: 3000, active: true },
      { id: cardAId, name: 'Card A', account_type: 'credit_card', balance: 6000, credit_limit: 15000, apr: 20, payment_due_day: 1, active: true, min_payment: 200, payment_preference: 'statement' },
      // Card B has no revolving balance and pays its statement in full every month — a routine,
      // mandatory cash outflow distinct from Card A's reducible revolving allocation.
      { id: cardBId, name: 'Card B', account_type: 'credit_card', balance: 0, credit_limit: 10000, apr: 18, payment_due_day: 15, active: true, min_payment: 0, payment_preference: 'full' },
    ];
    const debts = [
      { id: cardAId, name: 'Card A', balance: 6000, apr: 20, min_payment: 200, target_payment: 800, credit_limit: 15000 },
    ];
    const rules = [
      { id: 'income-1', name: 'Paycheck', amount: 2200, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
      { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
      { id: 'bill-2', name: 'Annual Insurance Premium', amount: 1800, rule_type: 'expense', frequency: 'yearly', due_month: dueMonth, due_day: 15, payment_source: checkingId, deposit_account: null, active: true, category: 'Insurance' },
      // Routed to Card B (a CC payment_source) — excluded from the rules-based monthlyExpenses
      // figure entirely, so the only way the look-ahead ever sees this $600/month outflow is via
      // the simulated cycling payment this test exists to verify.
      { id: 'bill-3', name: 'Groceries on Card B', amount: 600, rule_type: 'expense', frequency: 'monthly', due_day: 10, payment_source: cardBId, deposit_account: null, active: true, category: 'Groceries' },
    ];
    const transactions: any[] = [];
    const carFunds: any[] = [];
    const goals: any[] = [];
    const profile: any = { weekly_gross_income: 0.01 };

    const payConfig = buildPayConfig(profile);
    const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { result } = renderHook(() => useCardProjection({
      accounts, transactions, rules, debts, goals, carFunds, profile,
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

    // Without subtracting Card B's routine cycling payment, monthly surplus looks roughly double
    // what it really is and the look-ahead would never trigger save-up before the annual bill.
    expect(r.saveUpMonths.size).toBeGreaterThan(0);

    const seriesA = r.perCardPaymentsScaled.find(p => p.id === cardAId)!;
    const seriesB = r.perCardPaymentsScaled.find(p => p.id === cardBId)!;
    const cardA = r.simCards.find(c => c.id === cardAId)!;
    // Months 1-3 (immediately before the annual bill) are capped down to the minimum.
    for (let m = 1; m <= 3; m++) {
      expect(seriesA.payments[m]).toBeLessThanOrEqual(cardA.minPayment + 1);
    }
    // Card B (cycling) must get its full $600 statement every active month, including the
    // annual-bill month itself — locking in a separate, previously-unnoticed bug this exact
    // fixture also had: the simulation's revolving-minimum reservation double-counted dollars the
    // augmented floor had already set aside for Card A, squeezing Card B's pool and shorting it to
    // $0 in the annual-bill month (with an $800 catch-up the month after). Once Card B is no
    // longer shorted, the look-ahead correctly sees a bigger true expense in that month and
    // reserves for it starting from month 0 — so Card A's month-0 payment is now also capped to
    // the minimum. That's the more accurate outcome, not a regression: the old "month 0 gets
    // extra" behavior relied on Card B's true obligation being under-counted.
    for (let m = 1; m <= 5; m++) {
      expect(seriesB.payments[m]).toBeCloseTo(600, 0);
    }
    for (let m = 0; m <= 3; m++) {
      expect(seriesA.payments[m]).toBeLessThanOrEqual(cardA.minPayment + 1);
    }
  });
});
