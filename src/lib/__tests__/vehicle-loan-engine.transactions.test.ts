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
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [], insurance_start_date: null, created_at: '2026-01-01',
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

  it('generates PROJECTION_MONTHS months of insurance rows anchored to payment_start_date when monthly_insurance > 0', () => {
    const cf = makeCarFund({ monthly_insurance: 150 });
    const rows = generateCarLoanTransactions([cf]);
    const insuranceRows = rows.filter(r => r.id.startsWith('carloanins:'));
    expect(insuranceRows.length).toBe(60);
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

  it('falls back to planned_purchase_date when loan_start_date is null — the normal saving-phase case', () => {
    // loan_start_date and planned_purchase_date represent the same real-world date; the saving
    // form no longer collects loan_start_date separately, so it's always null pre-activation.
    const cf = makeCarFund({
      phase: 'saving', loan_start_date: null, planned_purchase_date: '2026-01-01',
      target_price: 14000, tax_fees: 1000, down_payment_goal: 3000,
    });
    const rows = generateCarLoanTransactions([cf]);
    expect(rows.some(r => r.id.startsWith('carloan:'))).toBe(true);
  });

  it('generates nothing when both loan_start_date and planned_purchase_date are null', () => {
    const cf = makeCarFund({ phase: 'saving', loan_start_date: null, planned_purchase_date: null });
    const rows = generateCarLoanTransactions([cf]);
    expect(rows).toEqual([]);
  });

  // §2.4 Option B. /transactions bridges its all-in TOTAL CASH OUT to the Dashboard's DEBT SERVICE
  // tile by summing the principal half of each car-loan row. The row's `amount` is the combined
  // cash payment, so the split has to travel with the row — it cannot be recovered downstream.
  describe('principalPortion (Option B debt-service split)', () => {
    it('carries a principal portion strictly less than the payment on an interest-bearing month', () => {
      const rows = generateCarLoanTransactions([makeCarFund({})]);
      const first = rows.find(r => r.id.startsWith('carloan:'))!;
      expect(first.principalPortion).toBeGreaterThan(0);
      // 6% APR on 12000 => the first month has real interest, so principal < payment.
      expect(first.principalPortion!).toBeLessThan(first.amount);
    });

    it('sums principal across the schedule to the loan principal, so nothing is lost or invented', () => {
      const rows = generateCarLoanTransactions([makeCarFund({})]);
      const totalPrincipal = rows
        .filter(r => r.isCarLoanPayment && r.category === 'Auto Loan')
        .reduce((s, r) => s + (r.principalPortion ?? 0), 0);
      expect(totalPrincipal).toBeCloseTo(12000, 0);
    });

    it('treats a lump sum as 100% principal and does not double-count it in the regular row', () => {
      const cf = makeCarFund({ lump_sum_payments: [{ id: 'ls1', date: '2026-02-01', amount: 500 }] });
      const rows = generateCarLoanTransactions([cf]);
      const lump = rows.find(r => r.id.startsWith('carloanlump:'))!;
      expect(lump.principalPortion).toBeCloseTo(500, 2);

      // The regular row that month must report only its OWN principal. row.principal from the
      // amortization schedule includes the lump sum, so failing to subtract it would report more
      // principal than cash actually left.
      const regularFeb = rows.find(r => r.id.startsWith('carloan:') && r.date.substring(0, 7) === '2026-02')!;
      expect(regularFeb.principalPortion!).toBeLessThan(regularFeb.amount);
      // Against the no-lump month: February's own principal moves only by the small interest
      // saving from January's paydown, nowhere near the $500 the lump row already claims.
      const regularJan = rows.find(r => r.id.startsWith('carloan:') && r.date.substring(0, 7) === '2026-01')!;
      expect(regularFeb.principalPortion!).toBeCloseTo(regularJan.principalPortion!, -1);
      expect(regularFeb.principalPortion!).toBeLessThan(regularJan.principalPortion! + 50);
    });

    it('never reports negative principal on a negative-amortization month', () => {
      // A payment far below the interest accrual makes row.principal negative. A display sub-line
      // must clamp rather than subtract from the debt-service total.
      const cf = makeCarFund({ expected_apr: 99, actual_monthly_payment: 5, loan_term_months: 360 });
      const rows = generateCarLoanTransactions([cf]);
      const carRows = rows.filter(r => r.id.startsWith('carloan:'));
      expect(carRows.length).toBeGreaterThan(0);
      for (const r of carRows) expect(r.principalPortion!).toBeGreaterThanOrEqual(0);
    });

    it('does not put a principal portion on insurance rows — insurance is not debt service', () => {
      const rows = generateCarLoanTransactions([makeCarFund({ monthly_insurance: 150 })]);
      const insurance = rows.filter(r => r.id.startsWith('carloanins:'));
      expect(insurance.length).toBeGreaterThan(0);
      for (const r of insurance) expect(r.principalPortion).toBeUndefined();
    });
  });
});
