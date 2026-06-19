import { describe, it, expect } from 'vitest';
import { generateCarLoanTransactions } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

// Regression test for a real user-reported gap: car loan payments, lump sums, and insurance never
// showed up in the Transactions tab — no equivalent of generatePaymentPlanTransactions existed for
// car funds. generateCarLoanTransactions mirrors that function's shape directly, splitting
// buildAmortizationSchedule's combined row.payment (regular + lumpSum) back into two separate line
// items so they match how the user entered them.

function makeCarFund(overrides: Partial<CarFund>): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: 'Test Car', target_price: 0, tax_fees: 0,
    down_payment_goal: 0, current_saved: 0, monthly_insurance: 0, expected_apr: 6,
    loan_term_months: 12, phase: 'loan', loan_amount: 12000,
    loan_start_date: '2026-01-01', payment_start_date: '2026-01-01', interest_start_date: '2026-01-01',
    actual_monthly_payment: 0, linked_account: null, linked_rule_id: null, loan_payment_account: null,
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [], created_at: '2026-01-01',
    ...overrides,
  };
}

describe('generateCarLoanTransactions', () => {
  it('generates one regular-payment row per scheduled month, tagged isCarLoanPayment', () => {
    const cf = makeCarFund({});
    const rows = generateCarLoanTransactions([cf]);
    const regular = rows.filter(r => r.id.startsWith('carloan:'));
    expect(regular.length).toBeGreaterThan(0);
    expect(regular[0].isCarLoanPayment).toBe(true);
    expect(regular[0].category).toBe('Auto Loan');
    expect(regular[0].amount).toBeGreaterThan(0);
  });

  it('splits a lump sum into its own row, separate from that month\'s regular payment', () => {
    const cf = makeCarFund({
      lump_sum_payments: [{ id: 'ls1', date: '2026-02-01', amount: 500 }],
    });
    const rows = generateCarLoanTransactions([cf]);
    const lumpRows = rows.filter(r => r.id.startsWith('carloanlump:'));
    expect(lumpRows.length).toBe(1);
    expect(lumpRows[0].amount).toBeCloseTo(500, 2);
    expect(lumpRows[0].date.substring(0, 7)).toBe('2026-02');

    // The regular payment that same month must NOT also include the lump sum — it should match
    // a month with no lump sum at all (this is a level/fixed-payment loan).
    const regularSameMonth = rows.find(r => r.id.startsWith('carloan:') && r.date.substring(0, 7) === '2026-02');
    const regularNoLumpMonth = rows.find(r => r.id.startsWith('carloan:') && r.date.substring(0, 7) === '2026-01');
    expect(regularSameMonth!.amount).toBeCloseTo(regularNoLumpMonth!.amount, 2);
  });

  it('generates 36 months of insurance rows anchored to payment_start_date when monthly_insurance > 0', () => {
    const cf = makeCarFund({ monthly_insurance: 150 });
    const rows = generateCarLoanTransactions([cf]);
    const insuranceRows = rows.filter(r => r.id.startsWith('carloanins:'));
    expect(insuranceRows.length).toBe(36);
    expect(insuranceRows[0].date).toBe('2026-01-01');
    expect(insuranceRows[0].amount).toBe(150);
    expect(insuranceRows[0].category).toBe('Insurance');
  });

  it('generates no insurance rows when monthly_insurance is 0', () => {
    const cf = makeCarFund({ monthly_insurance: 0 });
    const rows = generateCarLoanTransactions([cf]);
    expect(rows.some(r => r.id.startsWith('carloanins:'))).toBe(false);
  });

  it('skips a car fund with no loan to generate payments for (zero principal)', () => {
    const cf = makeCarFund({ phase: 'saving', monthly_insurance: 150, target_price: 0, down_payment_goal: 0 });
    const rows = generateCarLoanTransactions([cf]);
    expect(rows).toEqual([]);
  });

  it('generates projected payments and insurance for a saving-phase car fund with dates set', () => {
    // target_price + tax_fees - down_payment_goal = getLoanPrincipal's saving-phase estimate.
    const cf = makeCarFund({
      phase: 'saving', loan_amount: 0, target_price: 14000, tax_fees: 1000, down_payment_goal: 3000,
      monthly_insurance: 150,
    });
    const rows = generateCarLoanTransactions([cf]);
    expect(rows.some(r => r.id.startsWith('carloan:'))).toBe(true);
    expect(rows.some(r => r.id.startsWith('carloanins:'))).toBe(true);
    // Same principal (12000) as the loan-phase fixture — the regular payment should match exactly,
    // since both phases now go through the same getLoanPrincipal + buildAmortizationSchedule path.
    const loanPhaseRows = generateCarLoanTransactions([makeCarFund({})]);
    const savingRegular = rows.find(r => r.id.startsWith('carloan:'))!;
    const loanRegular = loanPhaseRows.find(r => r.id.startsWith('carloan:'))!;
    expect(savingRegular.amount).toBeCloseTo(loanRegular.amount, 2);
  });

  it('tags payment_source from loan_payment_account when set, matching the "account:<id>" convention', () => {
    const cf = makeCarFund({ loan_payment_account: 'checking-1' });
    const rows = generateCarLoanTransactions([cf]);
    expect(rows[0].payment_source).toBe('account:checking-1');
  });
});
