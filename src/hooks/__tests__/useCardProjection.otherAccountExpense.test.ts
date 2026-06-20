// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';

// Regression for a real user-reported bug: an expense rule paid from a DIFFERENT bank account
// (e.g. "Claude" $20/mo paid from "General Operations", not the funding account "TOTAL CHECKING")
// was subtracted from the funding account's modeled cash flow anyway — forecastMonthEvents only
// ever excluded credit-card-sourced expenses, never "paid from some other bank account entirely."
// That money never touches the funding account, so it must not reduce its available cash.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

const CHECKING = 'checking-1';
const OTHER_CHECKING = 'other-checking-1';
const CARD = 'card-1';

function run(extraRule: any[]) {
  const accounts = [
    { id: CHECKING, name: 'TOTAL CHECKING', account_type: 'checking', balance: 3000, active: true },
    { id: OTHER_CHECKING, name: 'General Operations', account_type: 'checking', balance: 70, active: true },
    { id: CARD, name: 'Card', account_type: 'credit_card', balance: 6000, credit_limit: 20000, apr: 22, payment_due_day: 11, active: true, min_payment: 200, payment_preference: 'revolving' },
  ];
  const debts = [
    { id: CARD, name: 'Card', balance: 6000, apr: 22, min_payment: 200, target_payment: 200, credit_limit: 20000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4500, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: CHECKING, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 1800, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: CHECKING, deposit_account: null, active: true, category: 'Bills' },
    ...extraRule,
  ];
  const profile: any = { weekly_gross_income: 0.01 };

  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
  const now = new Date();
  const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  return renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts, goals: [], carFunds: [], profile,
    debtPayoffOptions: { cashFloor: 1000 },
    payConfig, scheduledEvents, pauseSavings: false,
    forecastFundingAccountId: CHECKING, debtStrategy: 'avalanche', persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS, syncCutoffDate, paymentPlans: [],
  } as any)).result.current!;
}

describe('useCardProjection — expense rules paid from a different bank account', () => {
  it('a rule paid from a different checking account does not reduce available cash, vs. an identical scenario with no such rule at all', () => {
    const baseline = run([]);
    const withOtherAcctRule = run([{
      id: 'other-1', name: 'Other Acct Bill', amount: 300, rule_type: 'expense', frequency: 'monthly',
      due_day: 1, payment_source: OTHER_CHECKING, deposit_account: null, active: true, category: 'Subscriptions',
    }]);

    // Test month 2 (a full future month, no sync-cutoff timing ambiguity) — should be identical.
    expect(withOtherAcctRule.allPaymentTotals[2]).toBeCloseTo(baseline.allPaymentTotals[2], 2);
  });

  it('the same rule paid from the funding account itself DOES reduce available cash — confirms the exclusion is account-specific, not a blanket bug', () => {
    const baseline = run([]);
    const fundedFromMainAccount = run([{
      id: 'other-2', name: 'Funding Acct Bill', amount: 300, rule_type: 'expense', frequency: 'monthly',
      due_day: 1, payment_source: CHECKING, deposit_account: null, active: true, category: 'Subscriptions',
    }]);

    expect(fundedFromMainAccount.allPaymentTotals[2]).toBeLessThan(baseline.allPaymentTotals[2]);
  });

  it('an unset payment_source (defaults to the funding account by convention) still reduces available cash', () => {
    const baseline = run([]);
    const unsetSource = run([{
      id: 'other-3', name: 'No Source Bill', amount: 300, rule_type: 'expense', frequency: 'monthly',
      due_day: 1, payment_source: null, deposit_account: null, active: true, category: 'Bills',
    }]);

    expect(unsetSource.allPaymentTotals[2]).toBeLessThan(baseline.allPaymentTotals[2]);
  });
});
