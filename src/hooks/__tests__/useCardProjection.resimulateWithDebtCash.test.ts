// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams, type CardProjectionResult } from '../useCardProjection';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// Phase 2 Option C convergence, step 3 — resimulateWithDebtCash(target).
//
// The hook exposes a closure that re-runs the ACTIVE simulation with the forecast engine's
// authoritative per-month revolving debt cash (ForecastRow.revolvingDebtCash) as
// debtCashTargetByMonth (sim param #20), then rebuilds the projection result from that sim
// with NO pass-3, NO scaling, and NO extra-distribution: the sim's payments ARE the plan,
// so per-card surpluses are all zero and the step3-display adjustments become no-ops.
//
// Month-0 rule: callers pass target[0] = NaN — month 0 is live-anchored and must keep the
// hook's own month-0 machinery (a 0 target would force min-only payments there, wrong).

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const CHECKING_ID = 'checking-1';
const CARD_HI = 'card-hi';
const CARD_LO = 'card-lo';

// THE CLOCK IS FROZEN, because this harness reads `new Date()` and the cards it
// builds have `payment_due_day: 1`. Run on the first of a month, the same
// synthetic scenario produces a different payoff month than it does mid-month,
// and on 2026-09-01 that flipped a payoff from 2 to 3 with no source change.
// Mid-month is the ordinary case and the one the expectations were written for.
const FROZEN_NOW = new Date('2026-08-20T12:00:00');

function renderProjection(): CardProjectionResult {
  const now = new Date(FROZEN_NOW);
  const accounts = [
    { id: CHECKING_ID, name: 'Checking', account_type: 'checking', balance: 5000, active: true },
    { id: CARD_HI, name: 'HighApr', account_type: 'credit_card', balance: 3000, credit_limit: 10000, apr: 25, payment_due_day: 1, active: true, min_payment: 50, payment_preference: null },
    { id: CARD_LO, name: 'LowApr', account_type: 'credit_card', balance: 1500, credit_limit: 8000, apr: 15, payment_due_day: 1, active: true, min_payment: 25, payment_preference: null },
  ];
  const debts = [
    { id: CARD_HI, name: 'HighApr', balance: 3000, apr: 25, min_payment: 50, target_payment: 100, credit_limit: 10000 },
    { id: CARD_LO, name: 'LowApr', balance: 1500, apr: 15, min_payment: 25, target_payment: 50, credit_limit: 8000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING_ID, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 2000, rule_type: 'expense', frequency: 'monthly', due_day: 3, payment_source: CHECKING_ID, deposit_account: null, active: true, category: 'Housing' },
  ];
  const transactions: Partial<Tables<'transactions'>>[] = [];
  const carFunds: Partial<Tables<'car_funds'>>[] = [];
  const goals: Partial<Tables<'savings_goals'>>[] = [];
  const profile: Partial<Tables<'profiles'>> | null = null;

  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);
  const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const { result } = renderHook(() => useCardProjection({
    accounts, transactions, rules, debts, goals, carFunds, profile,
    debtPayoffOptions: { cashFloor: 100 },
    payConfig,
    scheduledEvents,
    pauseSavings: false,
    forecastFundingAccountId: CHECKING_ID,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS,
    syncCutoffDate,
    paymentPlans: [],
  } as unknown as UseCardProjectionParams));

  expect(result.current).not.toBeNull();
  return result.current!;
}

/** target with NaN at month 0 (live-anchored) and `value` for every month 1+. */
const makeTarget = (value: number): number[] =>
  Array.from({ length: PROJECTION_MONTHS }, (_, m) => (m === 0 ? NaN : value));

const revolvingTotalAt = (r: CardProjectionResult, m: number) =>
  r.perCardPaymentsScaled.reduce((s, p) => {
    const revBal = r.monthlyRevolvingBalances.get(p.id)?.[m] ?? 0;
    const startRevBal = m === 0 ? revBal : (r.monthlyRevolvingBalances.get(p.id)?.[m - 1] ?? 0);
    return startRevBal > 0 ? s + p.payments[m] : s;
  }, 0);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(FROZEN_NOW);
});
afterEach(() => vi.useRealTimers());

describe('useCardProjection — resimulateWithDebtCash (Phase 2 Option C step 3)', () => {
  it('clamp months: revolving payments follow the target, and all surpluses are zero', () => {
    const base = renderProjection();
    const resim = base.resimulateWithDebtCash(makeTarget(200));

    // Months 1-3 still carry revolving debt at a $200/mo pace — the plan pays exactly the target.
    for (const m of [1, 2, 3]) {
      expect(revolvingTotalAt(resim, m)).toBeGreaterThanOrEqual(198);
      expect(revolvingTotalAt(resim, m)).toBeLessThanOrEqual(202);
    }
    // Payments ARE the plan: no extra-distribution on top.
    for (const p of resim.perCardPaymentsScaled) {
      expect(p.surpluses.every(s => s === 0)).toBe(true);
    }
  });

  it('minimum invariant: a target below the contract minimums pays the minimums instead', () => {
    const base = renderProjection();
    const resim = base.resimulateWithDebtCash(makeTarget(10));
    // Both cards still owe in month 1 → at least min(50) + min(25) must flow.
    expect(revolvingTotalAt(resim, 1)).toBeGreaterThanOrEqual(74);
  });

  it('month 0 is live-anchored: NaN target leaves month-0 payments and month0 result untouched', () => {
    const base = renderProjection();
    const resim = base.resimulateWithDebtCash(makeTarget(200));
    expect(resim.month0).toBe(base.month0);
    expect(revolvingTotalAt(resim, 0)).toBe(revolvingTotalAt(base, 0));
    // Live-anchored machinery and look-ahead outputs are kept from the base result.
    expect(resim.maxDebtPaymentByMonth).toBe(base.maxDebtPaymentByMonth);
    expect(resim.saveUpMonths).toBe(base.saveUpMonths);
    expect(resim.m0Expenses).toBe(base.m0Expenses);
  });

  it('step3-display becomes a no-op: adjusted balances are the sim balances verbatim', () => {
    const base = renderProjection();
    const resim = base.resimulateWithDebtCash(makeTarget(300));
    for (const id of [CARD_HI, CARD_LO]) {
      expect(resim.forecastAdjustedRevolvingBalances.get(id)).toEqual(
        resim.monthlyRevolvingBalances.get(id),
      );
    }
  });

  it('payoff months come from the resim: a big target clears debt early and both fields agree', () => {
    const base = renderProjection();
    const resim = base.resimulateWithDebtCash(makeTarget(2000));
    expect(resim.simRevolvingPayoffMonth).not.toBeNull();
    expect(resim.forecastRevolvingPayoffMonth).toBe(resim.simRevolvingPayoffMonth);
    expect(resim.simRevolvingPayoffMonth!).toBeLessThanOrEqual(
      base.simRevolvingPayoffMonth ?? PROJECTION_MONTHS,
    );
  });

  it('does not mutate the base result', () => {
    const base = renderProjection();
    const beforeTotals = [...base.debtPaymentTotals];
    const beforeScaled = base.perCardPaymentsScaled.map(p => [...p.payments]);
    base.resimulateWithDebtCash(makeTarget(150));
    expect(base.debtPaymentTotals).toEqual(beforeTotals);
    base.perCardPaymentsScaled.forEach((p, i) => expect(p.payments).toEqual(beforeScaled[i]));
  });

  it('is re-invokable from its own result (bounded convergence passes re-target from anywhere)', () => {
    const base = renderProjection();
    const pass1 = base.resimulateWithDebtCash(makeTarget(400));
    const pass2 = pass1.resimulateWithDebtCash(makeTarget(400));
    pass1.perCardPaymentsScaled.forEach((p, i) => {
      expect(pass2.perCardPaymentsScaled[i].payments).toEqual(p.payments);
    });
  });
});
