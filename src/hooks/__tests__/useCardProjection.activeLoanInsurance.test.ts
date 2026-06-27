// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection, type UseCardProjectionParams } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { Tables } from '@/integrations/supabase/types';

// Regression test for a real user-reported bug: a car fund's monthly_insurance disappeared from
// every cash-flow total the instant its phase flipped from 'saving' to 'loan'. Root cause:
// getVehicleExtrasForMonth/vehicleForecastByMonth only ever looked at phase==='saving' car funds —
// getTotalCarLoanMonthly (the regular payment) and carLoanLumpByMonth (lump sums) both already had
// correct phase==='loan' handling, but nothing added monthly_insurance once a loan activated. Fixed
// by adding carLoanInsuranceByMonth.
//
// Anchor corrected a second time same day: insurance follows loan_start_date (purchase date), not
// payment_start_date — you need insurance the day you own the car, not when the first loan bill
// posts. The loan payment itself still anchors to payment_start_date; only insurance differs.

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 1, raiseMode: 'pct' as const,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat' as const, bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

function renderWithCarFund(carFunds: Partial<Tables<'car_funds'>>[]) {
  const now = new Date();
  const checkingId = 'checking-1';
  const cardId = 'card-1';

  const accounts = [
    { id: checkingId, name: 'Checking', account_type: 'checking', balance: 5000, active: true },
    { id: cardId, name: 'Card', account_type: 'credit_card', balance: 500, credit_limit: 15000, apr: 20, payment_due_day: 1, active: true, min_payment: 25, payment_preference: 'statement' },
  ];
  const debts = [
    { id: cardId, name: 'Card', balance: 500, apr: 20, min_payment: 25, target_payment: 25, credit_limit: 15000 },
  ];
  const rules = [
    { id: 'income-1', name: 'Paycheck', amount: 4000, rule_type: 'income', frequency: 'monthly', due_day: 1, payment_source: null, deposit_account: checkingId, active: true, category: 'Other' },
    { id: 'bill-1', name: 'Rent', amount: 1200, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: checkingId, deposit_account: null, active: true, category: 'Bills' },
  ];
  const profile: Partial<Tables<'profiles'>> = { weekly_gross_income: 0.01 };

  const payConfig = buildPayConfig(profile);
  const scheduledEvents = generateScheduledEvents(rules as unknown as RuleRow[], accounts as unknown as AccountRow[], 36);
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
  } as unknown as UseCardProjectionParams));
}

describe('useCardProjection — active loan insurance', () => {
  it('includes monthly_insurance for a phase=loan car fund starting the month of loan_start_date, even before payment_start_date arrives', () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const futureStart = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const carFunds = [{
      id: 'car-1', vehicle_name: 'Test Car', phase: 'loan',
      target_price: 0, tax_fees: 0, down_payment_goal: 0, current_saved: 0, gift_contribution: 0,
      loan_amount: 20000, expected_apr: 6, loan_term_months: 60,
      // Owned (loan_start_date) this month; first bill (payment_start_date) isn't due until next
      // month — insurance must already show this month, since you own the car now.
      loan_start_date: today, payment_start_date: futureStart, interest_start_date: futureStart,
      actual_monthly_payment: 0, monthly_insurance: 150,
      linked_account: null, linked_rule_id: null, planned_purchase_date: null,
      lump_sum_payments: [],
    }];

    const { result } = renderWithCarFund(carFunds);
    const r = result.current!;
    expect(r).not.toBeNull();
    expect(r.month0.vehicleInsurance).toBeGreaterThanOrEqual(150);
  });

  it('does not include insurance before loan_start_date arrives, regardless of payment_start_date', () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const futureStart = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const carFunds = [{
      id: 'car-1', vehicle_name: 'Test Car', phase: 'loan',
      target_price: 0, tax_fees: 0, down_payment_goal: 0, current_saved: 0, gift_contribution: 0,
      loan_amount: 20000, expected_apr: 6, loan_term_months: 60,
      loan_start_date: futureStart, payment_start_date: today, interest_start_date: today,
      actual_monthly_payment: 0, monthly_insurance: 150,
      linked_account: null, linked_rule_id: null, planned_purchase_date: null,
      lump_sum_payments: [],
    }];

    const { result } = renderWithCarFund(carFunds);
    const r = result.current!;
    expect(r).not.toBeNull();

    // loan_start_date is next month — month 0 must not show this insurance yet, even though
    // payment_start_date (today) has already arrived.
    expect(r.month0.vehicleInsurance).toBe(0);
  });

  it('saving-phase insurance follows the purchase date, not payment_start_date — shows up the same month as purchase', () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const futureStart = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const carFunds = [{
      id: 'car-1', vehicle_name: 'Test Car', phase: 'saving',
      target_price: 14000, tax_fees: 1000, down_payment_goal: 3000, current_saved: 0, gift_contribution: 0,
      loan_amount: 0, expected_apr: 6, loan_term_months: 60,
      loan_start_date: null, payment_start_date: futureStart, interest_start_date: null,
      actual_monthly_payment: 0, monthly_insurance: 150,
      linked_account: null, linked_rule_id: null, loan_payment_account: null, insurance_start_date: null, planned_purchase_date: today,
      lump_sum_payments: [],
    }];

    // Purchase this month, first payment next month — insurance must already show this month,
    // matching loan-phase's loan_start_date anchor once activated.
    const r = renderWithCarFund(carFunds).result.current!;
    expect(r.month0.vehicleInsurance).toBeGreaterThanOrEqual(150);
  });

  it('saving-phase and loan-phase show identical insurance once isolated from the projected loan payment — the no-op-at-activation guarantee', () => {
    // loan_term_months: 0 zeroes out the projected/actual loan payment in both phases
    // (calculateScheduledPayment returns 0 for termMonths <= 0), isolating insurance so the two
    // phases' month0.vehicleInsurance figures are directly comparable (normally saving-phase
    // bundles insurance + projected payment + lump sum into one total, while loan-phase tracks
    // the real payment separately — not what this test is checking).
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const savingPhaseCarFunds = [{
      id: 'car-1', vehicle_name: 'Test Car', phase: 'saving',
      target_price: 14000, tax_fees: 1000, down_payment_goal: 3000, current_saved: 0, gift_contribution: 0,
      loan_amount: 0, expected_apr: 6, loan_term_months: 0,
      loan_start_date: null, payment_start_date: today, interest_start_date: null,
      actual_monthly_payment: 0, monthly_insurance: 150,
      linked_account: null, linked_rule_id: null, loan_payment_account: null, insurance_start_date: null, planned_purchase_date: today,
      lump_sum_payments: [],
    }];
    const loanPhaseCarFunds = [{
      ...savingPhaseCarFunds[0],
      phase: 'loan', loan_amount: 12000, loan_start_date: today, interest_start_date: today,
    }];

    const saving = renderWithCarFund(savingPhaseCarFunds).result.current!;
    const loan = renderWithCarFund(loanPhaseCarFunds).result.current!;

    expect(saving.month0.vehicleInsurance).toBe(150);
    expect(saving.month0.vehicleInsurance).toBe(loan.month0.vehicleInsurance);
  });
});
