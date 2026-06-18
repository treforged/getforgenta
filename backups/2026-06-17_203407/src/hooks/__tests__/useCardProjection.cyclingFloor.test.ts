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
    const cardA = r.simCards.find(c => c.id === cardAId)!;
    // Months 0-3 (the window before the annual bill) are capped down to the minimum. Month 0
    // is included here — unlike before credit-card-engine.ts's paid-off-pool fix, which let the
    // cash floor silently defer part of Card B's statement payment into the following month
    // whenever cash was tight. That deferral acted as a hidden 0%-interest cushion: it smoothed
    // Card B's apparent monthly cost, so the look-ahead underestimated the true recurring drain
    // and didn't think month 0 needed to bank anything yet. With the deferral removed, Card B's
    // full $600 mandatory cost shows up every month with no smoothing, so the look-ahead now
    // correctly recognizes the bigger true future need and extends protection back to month 0.
    for (let m = 0; m <= 3; m++) {
      expect(seriesA.payments[m]).toBeLessThanOrEqual(cardA.minPayment + 1);
    }
    // The protection is still marginal, not a blanket "protect everything from now on" flag:
    // once the bill window passes and before the next annual cycle's save-up window begins,
    // Card A's natural surplus is allowed through well above the minimum again.
    expect(seriesA.payments[6]).toBeGreaterThan(cardA.minPayment + 1);
    expect(seriesA.payments[7]).toBeGreaterThan(cardA.minPayment + 1);
  });
});
