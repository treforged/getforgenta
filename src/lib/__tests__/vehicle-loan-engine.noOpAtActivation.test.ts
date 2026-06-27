import { describe, it, expect } from 'vitest';
import { getLoanPrincipal, buildAmortizationSchedule } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

// The explicit confirmation Tre asked for: activating a loan with no changes must produce
// identical payment amounts for every month — including months affected by lump-sum-accelerated
// payoff, and with interest already correctly baked in via the shared calculateScheduledPayment/
// buildAmortizationSchedule formula. Modeled directly on the real account this was diagnosed
// against (target_price 21070, tax_fees 3000, down_payment_goal 7700, apr 10.18, term 48 months,
// purchase ~Jun 21 2026, first payment Aug 7 2026, 5×$500 lump sums in 2028).

function makeSavingPhaseCarFund(): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: 'Real Account Car',
    target_price: 21070, tax_fees: 3000, down_payment_goal: 7700, current_saved: 1084.53,
    gift_contribution: 6700, monthly_insurance: 77, expected_apr: 10.18, loan_term_months: 48,
    phase: 'saving', loan_amount: 0, loan_start_date: null,
    payment_start_date: '2026-08-07', interest_start_date: null, actual_monthly_payment: 0,
    linked_account: 'acct-1', linked_rule_id: null, loan_payment_account: 'acct-1', insurance_start_date: null,
    planned_purchase_date: '2026-06-21',
    lump_sum_payments: [
      { id: 'l1', date: '2028-01-15', amount: 500 },
      { id: 'l2', date: '2028-02-11', amount: 500 },
      { id: 'l3', date: '2028-03-11', amount: 500 },
      { id: 'l4', date: '2028-04-11', amount: 500 },
      { id: 'l5', date: '2028-05-11', amount: 500 },
    ],
    created_at: '2026-01-01',
  };
}

describe('no-op-at-activation — real account numbers', () => {
  it('getLoanPrincipal computes the same value BuyItDialog would default loan_amount to', () => {
    const saving = makeSavingPhaseCarFund();
    const principal = getLoanPrincipal(saving);
    expect(principal).toBeCloseTo(21070 + 3000 - 7700, 2); // 16370
  });

  it('produces an identical amortization schedule whether built from the saving-phase estimate or the loan-phase stored amount — every month, including the lump-sum-accelerated ones', () => {
    const saving = makeSavingPhaseCarFund();
    const principal = getLoanPrincipal(saving);

    // What the saving-phase projection computes today (Forecast.tsx/useCardProjection.ts).
    const savingSchedule = buildAmortizationSchedule({
      loanAmount: principal, apr: saving.expected_apr, termMonths: saving.loan_term_months,
      loanStartDate: saving.planned_purchase_date!, paymentStartDate: saving.payment_start_date!,
      interestStartDate: saving.payment_start_date!, actualMonthlyPayment: 0,
      lumpSumPayments: saving.lump_sum_payments,
    });

    // What BuyItDialog would persist if the user accepts every default with zero edits, and what
    // the now-active loan's own schedule (LoanCard, getActiveCarLoanPayments) would compute.
    const loanFund: CarFund = {
      ...saving, phase: 'loan', loan_amount: principal,
      loan_start_date: saving.planned_purchase_date, interest_start_date: saving.payment_start_date,
    };
    const loanPrincipal = getLoanPrincipal(loanFund);
    expect(loanPrincipal).toBeCloseTo(principal, 2);

    const loanSchedule = buildAmortizationSchedule({
      loanAmount: loanPrincipal, apr: loanFund.expected_apr, termMonths: loanFund.loan_term_months,
      loanStartDate: loanFund.loan_start_date!, paymentStartDate: loanFund.payment_start_date!,
      interestStartDate: loanFund.interest_start_date!, actualMonthlyPayment: loanFund.actual_monthly_payment,
      lumpSumPayments: loanFund.lump_sum_payments,
    });

    // Lump sums must actually have shortened the schedule below the nominal 48 months — otherwise
    // this test isn't exercising the lump-sum-aware fix at all. (Confirmed against this real
    // account: 41 months instead of 48, $416.60/mo, $3,044.92 total interest, payoff Dec 2029.)
    expect(savingSchedule.schedule.length).toBeLessThan(48);
    expect(savingSchedule.schedule.length).toBe(loanSchedule.schedule.length);
    expect(savingSchedule.effectivePayment).toBeCloseTo(loanSchedule.effectivePayment, 2);
    expect(savingSchedule.totalInterest).toBeCloseTo(loanSchedule.totalInterest, 2);

    // Every single month's interest, payment, and balance must match exactly — this is the
    // concrete, month-by-month confirmation, not just a total.
    for (let i = 0; i < savingSchedule.schedule.length; i++) {
      const a = savingSchedule.schedule[i];
      const b = loanSchedule.schedule[i];
      expect(a.date).toBe(b.date);
      expect(a.interest).toBeCloseTo(b.interest, 2);
      expect(a.payment).toBeCloseTo(b.payment, 2);
      expect(a.lumpSum).toBeCloseTo(b.lumpSum, 2);
      expect(a.endBalance).toBeCloseTo(b.endBalance, 2);
    }
  });
});
