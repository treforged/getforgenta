// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';

// Ask 536c0db1 (Sam, 2026-10-01): the engine used to return null for any user with no credit card,
// so a cash-only user got no month-0 snapshot and no Safe to Spend figure. It now runs when the user
// has a cash account, and still returns null when there is neither a card nor cash to model.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

function run(accounts: Record<string, unknown>[]) {
  const checkingId = 'checking-1';
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 28, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 28, payment_source: checkingId, deposit_account: null, active: true, category: 'Housing' },
  ];
  const profile = { weekly_gross_income: 0 };
  const now = new Date();
  return renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts: [], goals: [], carFunds: [], profile,
    debtPayoffOptions: { cashFloor: 0 },
    payConfig: buildPayConfig(profile),
    scheduledEvents: generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36),
    pauseSavings: false,
    forecastFundingAccountId: checkingId,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS,
    syncCutoffDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
    paymentPlans: [],
  } as unknown as UseCardProjectionParams)).result.current;
}

describe('useCardProjection - a cash-only user', () => {
  it('returns month 0 for a user with checking and no card, with no card payment in it', () => {
    const r = run([{ id: 'checking-1', name: 'Checking', account_type: 'checking', balance: 2500, active: true }]);
    expect(r).not.toBeNull();
    expect(r!.simCards).toHaveLength(0);
    expect(r!.month0.chain.fundingBalance).toBe(2500);
    expect(r!.month0.safeToPayTotal).toBe(0);
    expect(r!.month0.cyclingPayment).toBe(0);
    // No card means nothing leaves for debt: month-end cash is the chain itself.
    expect(r!.month0.endCash).toBeCloseTo(r!.month0.chain.cashPreDebt, 2);
  });

  it('still returns null with neither a card nor a cash account', () => {
    expect(run([{ id: 'sav-1', name: 'Savings', account_type: 'high_yield_savings', balance: 900, active: true }])).toBeNull();
    expect(run([])).toBeNull();
  });
});
