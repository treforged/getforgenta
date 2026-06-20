// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';

// Regression for a real user-reported bug: a saving-phase car's already-saved + gift-covered down
// payment sat in the same account used to fund credit-card payments, but was never excluded from
// "available cash" — month0.safeToPayTotal was identical whether or not that money was earmarked.
// getCarFundEarmark (vehicle-loan-engine.ts) now subtracts it from debtFundingBalance up front.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

function run(carFunds: any[], checkingBalance = 5000) {
  const checkingId = 'checking-1';
  const cardId = 'card-1';

  const accounts = [
    { id: checkingId, name: 'Checking', account_type: 'checking', balance: checkingBalance, active: true },
    { id: cardId, name: 'Card', account_type: 'credit_card', balance: 6000, credit_limit: 15000, apr: 22, payment_due_day: 11, active: true, min_payment: 200, payment_preference: 'revolving' },
  ];
  const debts = [
    { id: cardId, name: 'Card', balance: 6000, apr: 22, min_payment: 200, target_payment: 200, credit_limit: 15000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
  ];
  const profile: any = { weekly_gross_income: 0.01 };

  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
  const now = new Date();
  const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  return renderHook(() => useCardProjection({
    accounts, transactions: [], rules, debts, goals: [], carFunds, profile,
    debtPayoffOptions: { cashFloor: 1000 },
    payConfig,
    scheduledEvents,
    pauseSavings: false,
    forecastFundingAccountId: checkingId,
    debtStrategy: 'avalanche',
    persistedDebtFundingId: null,
    assumptions: DEFAULT_ASSUMPTIONS,
    syncCutoffDate,
    paymentPlans: [],
  } as any)).result.current!;
}

describe('useCardProjection — car-fund down-payment earmark', () => {
  it('reduces month0.safeToPayTotal by the earmarked amount when linked_account is the funding account itself', () => {
    const checkingId = 'checking-1';
    const noCar = run([]);
    const carFunds = [{
      id: 'car-1', vehicle_name: 'Real Account Car', phase: 'saving',
      target_price: 0, tax_fees: 0, down_payment_goal: 7700, current_saved: 1084.53, gift_contribution: 6700,
      loan_amount: 0, expected_apr: 10.18, loan_term_months: 48,
      loan_start_date: null, payment_start_date: '2026-08-07', interest_start_date: null,
      actual_monthly_payment: 0, monthly_insurance: 0,
      linked_account: checkingId, linked_rule_id: null, loan_payment_account: null,
      planned_purchase_date: '2026-06-21', lump_sum_payments: [],
    }];
    const withCar = run(carFunds);
    // Earmark = min(1084.53, 7700-6700) = 1000.
    expect(noCar.month0.safeToPayTotal - withCar.month0.safeToPayTotal).toBe(1000);
  });

  it('does not reduce month0.safeToPayTotal when linked_account is a genuinely separate account', () => {
    const noCar = run([]);
    const carFunds = [{
      id: 'car-1', vehicle_name: 'Real Account Car', phase: 'saving',
      target_price: 0, tax_fees: 0, down_payment_goal: 7700, current_saved: 1084.53, gift_contribution: 6700,
      loan_amount: 0, expected_apr: 10.18, loan_term_months: 48,
      loan_start_date: null, payment_start_date: '2026-08-07', interest_start_date: null,
      actual_monthly_payment: 0, monthly_insurance: 0,
      linked_account: 'separate-savings-acct', linked_rule_id: null, loan_payment_account: null,
      planned_purchase_date: '2026-06-21', lump_sum_payments: [],
    }];
    const withCar = run(carFunds);
    expect(noCar.month0.safeToPayTotal).toBe(withCar.month0.safeToPayTotal);
  });

  it('earmark does not double-subtract once the down payment is actually spent (phase=loan)', () => {
    // Buying the car for real moves $1000 out of checking — the earmark's job pre-purchase was to
    // hold that $1000 back from "available cash" without it actually leaving the account yet. Once
    // it's genuinely gone (phase=loan, checking balance down by the same $1000), the earmark must
    // NOT also still apply — that would double-subtract the same dollars. loan_term_months: 0
    // zeroes the projected/actual payment in both phases, isolating the earmark dimension from Bug
    // 2's loan-payment dimension.
    const checkingId = 'checking-1';
    const savingCarFunds = [{
      id: 'car-1', vehicle_name: 'Real Account Car', phase: 'saving',
      target_price: 0, tax_fees: 0, down_payment_goal: 7700, current_saved: 1084.53, gift_contribution: 6700,
      loan_amount: 0, expected_apr: 0, loan_term_months: 0,
      loan_start_date: null, payment_start_date: '2026-08-07', interest_start_date: null,
      actual_monthly_payment: 0, monthly_insurance: 0,
      linked_account: checkingId, linked_rule_id: null, loan_payment_account: null,
      planned_purchase_date: '2026-06-21', lump_sum_payments: [],
    }];
    const loanCarFunds = [{ ...savingCarFunds[0], phase: 'loan', loan_amount: 0, loan_start_date: '2026-06-21' }];
    const saving = run(savingCarFunds, 5000);
    const loan = run(loanCarFunds, 4000); // $1000 actually left checking when the car was bought
    expect(saving.month0.safeToPayTotal).toBe(loan.month0.safeToPayTotal);
  });
});
