// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig, getPaychecksInMonth } from '@/lib/pay-schedule';
import { generateScheduledEvents, toLocalDateStr } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';

// Ask 536c0db1 (Sam, 2026-10-01): the engine used to return null for any user with no credit card,
// so a cash-only user got no month-0 snapshot and no Safe to Spend figure. It now runs when the user
// has a cash account, and still returns null when there is neither a card nor cash to model.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

function run(accounts: Record<string, unknown>[], opts: { profile?: Record<string, unknown>; withIncomeRule?: boolean } = {}) {
  const checkingId = 'checking-1';
  const rules = [
    ...(opts.withIncomeRule === false ? [] : [{ id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 28, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' }]),
    { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 28, payment_source: checkingId, deposit_account: null, active: true, category: 'Housing' },
  ];
  const profile = opts.profile ?? { weekly_gross_income: 0 };
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

// Ask f16b35ff (Sam's guards): an ENTERED profile salary with no income rule fills month 0, and a
// user with BOTH a rule and a salary gets the rule's income once, never the salary on top.
describe('useCardProjection - month-0 income from the profile salary', () => {
  const checking = [{ id: 'checking-1', name: 'Checking', account_type: 'checking', balance: 2500, active: true }];
  const salary = { weekly_gross_income: 1000, paycheck_frequency: 'weekly', onboarding_completed: false };
  it("the 4 real users' shape: salary entered, no income rule -> month 0 carries the remaining paychecks", () => {
    const r = run(checking, { profile: salary, withIncomeRule: false })!;
    // The paychecks the pay schedule itself puts after the sync cutoff (the 1st), summed independently.
    const now = new Date();
    const cutoff = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const expected = getPaychecksInMonth(buildPayConfig(salary), now.getFullYear(), now.getMonth())
      .filter(p => toLocalDateStr(p.date) > cutoff)
      .reduce((s, p) => s + p.net, 0);
    expect(expected).toBeGreaterThan(0);
    expect(r.month0.chain.income).toBeCloseTo(expected, 6);
  });

  it('salary AND an income rule -> only the rule is counted (no double count)', () => {
    const withRule = run(checking, { profile: salary })!;
    const ruleOnly = run(checking, { profile: { weekly_gross_income: 0 } })!;
    expect(withRule.month0.chain.income).toBe(ruleOnly.month0.chain.income);
  });

  it('the legacy $1,875 default, never onboarded, adds nothing', () => {
    const r = run(checking, { profile: { weekly_gross_income: 1875, paycheck_frequency: 'weekly', onboarding_completed: false }, withIncomeRule: false })!;
    expect(r.month0.chain.income).toBe(0);
  });
});
