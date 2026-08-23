import { describe, it, expect } from 'vitest';
import { getActiveCarLoanPayments } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

/**
 * The next-payment fields the "Recommended This Month" loan rows lead with: `dueDay` (from
 * payment_start_date, the SAME derivation the cash floor's loan items use), `nextMonthPayment`
 * (the amortization row after the current one — null when the schedule ends, never an invented
 * figure), and the final-payment flags. Synthetic fixtures with an explicit asOf date — the real
 * fixture is gitignored, and these must run in CI.
 */

function makeCarFund(overrides: Partial<CarFund>): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: 'Test Car', target_price: 0, tax_fees: 0,
    down_payment_goal: 0, current_saved: 0, saved_source: 'fixed', saved_percent: 0, sort_order: 0, auto_extra: false, monthly_insurance: 0, expected_apr: 10,
    loan_term_months: 48, phase: 'loan', loan_amount: 16000,
    loan_start_date: '2026-06-22', payment_start_date: '2026-08-07', interest_start_date: '2026-08-07',
    actual_monthly_payment: 0, linked_account: null, linked_rule_id: null, loan_payment_account: null, linked_loan_account_id: null,
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [], insurance_start_date: null, created_at: '2026-01-01',
    ...overrides,
  } as CarFund;
}

// A 0% loan overpaid at $300/mo pays $1,000 off as 300, 300, 300, then a $100 true-up — the
// shape that makes every boundary observable without floating-point noise.
const trueUpLoan = () => makeCarFund({
  loan_amount: 1000, expected_apr: 0, loan_term_months: 48, actual_monthly_payment: 300,
  loan_start_date: '2026-01-15', payment_start_date: '2026-01-15', interest_start_date: '2026-01-15',
});

describe('getActiveCarLoanPayments — dueDay', () => {
  it("derives the due day from payment_start_date's day-of-month, the floor's own expression", () => {
    const [info] = getActiveCarLoanPayments([makeCarFund({})], new Date(2026, 7, 20));
    expect(info.dueDay).toBe(7); // payment_start_date 2026-08-07
  });
});

describe('getActiveCarLoanPayments — nextMonthPayment', () => {
  it('reads next month straight off the amortization schedule mid-loan', () => {
    const [info] = getActiveCarLoanPayments([trueUpLoan()], new Date(2026, 0, 20)); // Jan: row 1 of 4
    expect(info.payment).toBe(300);
    expect(info.nextMonthPayment).toBe(300);
    expect(info.isFinalPayment).toBe(false);
    expect(info.nextIsFinalPayment).toBe(false);
  });

  it('shows the smaller true-up as next month when next month is the final row', () => {
    const [info] = getActiveCarLoanPayments([trueUpLoan()], new Date(2026, 2, 20)); // Mar: row 3 of 4
    expect(info.payment).toBe(300);
    expect(info.nextMonthPayment).toBe(100); // capped at remaining balance, not the flat $300
    expect(info.isFinalPayment).toBe(false);
    expect(info.nextIsFinalPayment).toBe(true);
  });

  it('is null in the final month — the loan pays off, and there is no next figure to invent', () => {
    const [info] = getActiveCarLoanPayments([trueUpLoan()], new Date(2026, 3, 20)); // Apr: row 4 of 4
    expect(info.payment).toBe(100); // the true-up itself
    expect(info.nextMonthPayment).toBeNull();
    expect(info.isFinalPayment).toBe(true);
    expect(info.nextIsFinalPayment).toBe(false);
  });

  it('keeps lump sums out of nextMonthPayment, as with payment', () => {
    const cf = makeCarFund({
      loan_amount: 1000, expected_apr: 0, loan_term_months: 48, actual_monthly_payment: 100,
      loan_start_date: '2026-01-15', payment_start_date: '2026-01-15', interest_start_date: '2026-01-15',
      lump_sum_payments: [{ id: 'ls1', date: '2026-02-10', amount: 200 }],
    });
    const [info] = getActiveCarLoanPayments([cf], new Date(2026, 0, 20)); // Jan; lump sum lands Feb
    expect(info.nextMonthPayment).toBe(100); // regular payment only — callers add lump sums separately
  });
});
