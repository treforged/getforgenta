import { describe, it, expect } from 'vitest';
import { getMonthlyDebtBreakdown } from '../credit-card-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';

// Regression: a payment plan paid from the checking account (plan_type 'monthly_charge', source =
// a non-credit-card account) is a real upcoming cash outflow that reduces the cash available to
// deploy toward debt. It is injected into the recommendation engine as the scalar
// `extraMonthlyExpenses`, but that scalar used to be folded only into the (future-months)
// projection sim — the current-month "available to deploy" figure is computed from
// transaction-derived remaining outflows and silently ignored it. Result: the checking-sourced
// plan payment did not take anything away from Available to Deploy on the Dashboard or the debt
// recommendations. generateRecommendations now subtracts it from availableAboveFloor, so the plan
// outflow moves the number.

function makeAccount(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: 'acct', user_id: 'test', name: 'Acct', account_type: 'credit_card', balance: 0,
    credit_limit: 5000, apr: 20, payment_due_day: 15, active: true,
    min_payment: null, payment_preference: null,
    ...overrides,
  };
}

describe('getMonthlyDebtBreakdown — checking-sourced payment plan reduces available cash', () => {
  const accounts: AccountRow[] = [
    makeAccount({ id: 'chk', name: 'TOTAL CHECKING', account_type: 'checking', balance: 3000, credit_limit: 0, apr: 0 }),
    // Large revolving balance so the recommendation is cash-bound (available < debt owed), i.e. the
    // available-cash figure — not the card balance — is what caps the recommended payment.
    makeAccount({ id: 'card', name: 'Discover', account_type: 'credit_card', balance: 10000, apr: 25, min_payment: 200 }),
  ];
  const profile = { cash_floor: 500 } as never;

  it('subtracts the plan outflow from totalAvailableCash / totalRecommended', () => {
    const withoutPlan = getMonthlyDebtBreakdown(accounts, [], [], [], profile, 0, undefined, undefined, 0);
    const withPlan = getMonthlyDebtBreakdown(accounts, [], [], [], profile, 0, undefined, undefined, 285);

    expect(withoutPlan.totalAvailableCash - withPlan.totalAvailableCash).toBeCloseTo(285, 2);
    expect(withoutPlan.totalRecommended - withPlan.totalRecommended).toBeCloseTo(285, 2);
  });

  it('is a no-op when there is no plan outflow', () => {
    const a = getMonthlyDebtBreakdown(accounts, [], [], [], profile, 0, undefined, undefined, 0);
    const b = getMonthlyDebtBreakdown(accounts, [], [], [], profile, 0, undefined, undefined, 0);
    expect(a.totalAvailableCash).toBe(b.totalAvailableCash);
  });
});
