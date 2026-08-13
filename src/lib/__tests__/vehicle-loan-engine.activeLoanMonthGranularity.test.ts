import { describe, it, expect } from 'vitest';
import { getActiveCarLoanPayments, getTotalCarLoanMonthly } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

// Regression test for a real user-reported bug: activating a loan with "no other changes" still
// shifted which forecast month the payment was considered active in, because getActiveCarLoanPayments
// compared an exact representative Date for "this forecast month" against the exact
// payment_start_date — and different callers used different representative days (useCardProjection.ts
// used the 1st of the month, Forecast.tsx used the 15th). For a mid-month payment_start_date like the
// 7th, "Aug 1" fails an exact-date gate (effectively pushing the start to September) while "Aug 15"
// passes it (keeping August) — so Forecast and Debt Payoff disagreed with each other, and either could
// disagree with the saving-phase projection's month-only anchor. Fixed by comparing calendar months
// only (via the same monthsBetween helper buildAmortizationSchedule's own monthsElapsed already uses),
// making the representative day passed in irrelevant.

function makeCarFund(overrides: Partial<CarFund>): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: 'Test Car', target_price: 0, tax_fees: 0,
    down_payment_goal: 0, current_saved: 0, saved_source: 'fixed', saved_percent: 0, monthly_insurance: 0, expected_apr: 10,
    loan_term_months: 48, phase: 'loan', loan_amount: 16000,
    loan_start_date: '2026-06-22', payment_start_date: '2026-08-07', interest_start_date: '2026-08-07',
    actual_monthly_payment: 0, linked_account: null, linked_rule_id: null, loan_payment_account: null, linked_loan_account_id: null,
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [], insurance_start_date: null, created_at: '2026-01-01',
    ...overrides,
  };
}

describe('getActiveCarLoanPayments — calendar-month granularity', () => {
  it('treats the payment as active for the 1st of payment_start_date\'s month (the useCardProjection.ts convention)', () => {
    const cf = makeCarFund({});
    const results = getActiveCarLoanPayments([cf], new Date(2026, 7, 1)); // Aug 1, 2026
    expect(results.length).toBe(1);
    expect(results[0].payment).toBeGreaterThan(0);
  });

  it('treats the payment as active for the 15th of payment_start_date\'s month (the Forecast.tsx convention) — same result as the 1st', () => {
    const cf = makeCarFund({});
    const day1 = getActiveCarLoanPayments([cf], new Date(2026, 7, 1));
    const day15 = getActiveCarLoanPayments([cf], new Date(2026, 7, 15));
    expect(day15.length).toBe(1);
    expect(day15[0].payment).toBeCloseTo(day1[0].payment, 2);
  });

  it('does not treat the payment as active the month before payment_start_date\'s month, regardless of representative day', () => {
    const cf = makeCarFund({});
    expect(getActiveCarLoanPayments([cf], new Date(2026, 6, 1)).length).toBe(0); // Jul 1
    expect(getActiveCarLoanPayments([cf], new Date(2026, 6, 31)).length).toBe(0); // Jul 31
  });

  it('getTotalCarLoanMonthly agrees regardless of which day within the active month is passed', () => {
    const cf = makeCarFund({});
    const fromDay1 = getTotalCarLoanMonthly([cf], new Date(2026, 7, 1));
    const fromDay15 = getTotalCarLoanMonthly([cf], new Date(2026, 7, 15));
    const fromDay28 = getTotalCarLoanMonthly([cf], new Date(2026, 7, 28));
    expect(fromDay1).toBeGreaterThan(0);
    expect(fromDay1).toBeCloseTo(fromDay15, 2);
    expect(fromDay1).toBeCloseTo(fromDay28, 2);
  });

  it('passes linked_loan_account_id through as linkedLoanAccountId, so net worth can dedupe by identity', () => {
    const linked = getActiveCarLoanPayments(
      [makeCarFund({ linked_loan_account_id: 'acc-1' })], new Date(2026, 7, 1),
    );
    expect(linked[0].linkedLoanAccountId).toBe('acc-1');

    const unlinked = getActiveCarLoanPayments([makeCarFund({})], new Date(2026, 7, 1));
    expect(unlinked[0].linkedLoanAccountId).toBeNull();
  });
});
