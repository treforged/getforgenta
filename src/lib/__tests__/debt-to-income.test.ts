// ⚠️ WHAT THIS PROTECTS. The tile these back read 0.5% and "healthy" for an account carrying
// $47,200 of debt, because the numerator was "card minimums not yet paid this month". Each test
// below is one of the three ways that was wrong, plus the two rules the replacement has to keep.
import { describe, it, expect } from 'vitest';
import { debtToIncomeRatio, monthlyDebtObligation } from '@/lib/debt-to-income';
import type { CarFund } from '@/lib/types';

const card = { id: 'a1', name: 'Chase Sapphire', account_type: 'credit_card', card_start_date: null };
const checking = { id: 'a2', name: 'Chase Checking', account_type: 'checking', card_start_date: null };

const loanFund = (over: Partial<CarFund> = {}) => ({
  phase: 'loan',
  loan_amount: 27500,
  expected_apr: 6.4,
  loan_term_months: 60,
  loan_start_date: '2026-06-01',
  payment_start_date: '2026-07-01',
  interest_start_date: '2026-07-01',
  actual_monthly_payment: 0,
  lump_sum_payments: [],
  ...over,
} as unknown as CarFund);

const asOf = new Date(2026, 7, 18); // 2026-08-18

describe('the numerator is every monthly obligation, not this month s unpaid card minimums', () => {
  it('counts loans, which the old reading dropped entirely', () => {
    const withoutLoans = monthlyDebtObligation({
      debts: [{ name: 'Chase Sapphire', min_payment: 212 }],
      accounts: [card], carFunds: [], asOf,
    });
    const withLoans = monthlyDebtObligation({
      debts: [{ name: 'Chase Sapphire', min_payment: 212 }, { name: 'Student Loan', min_payment: 95 }],
      accounts: [card], carFunds: [], asOf,
    });
    expect(withoutLoans).toBe(212);
    expect(withLoans).toBe(307);
  });

  it('counts an active vehicle loan payment', () => {
    const base = monthlyDebtObligation({ debts: [], accounts: [], carFunds: [], asOf });
    const withCar = monthlyDebtObligation({ debts: [], accounts: [], carFunds: [loanFund()], asOf });
    expect(base).toBe(0);
    expect(withCar).toBeGreaterThan(400);
  });

  // The old numerator fell as the month's minimums cleared; this one cannot, because nothing in it
  // asks whether a payment has already been made.
  it('does not move when a minimum is paid — it is contractual, not remaining', () => {
    const input = {
      debts: [{ name: 'Chase Sapphire', min_payment: 212 }, { name: 'Discover It', min_payment: 105 }],
      accounts: [card], carFunds: [], asOf,
    };
    expect(monthlyDebtObligation({ ...input, asOf: new Date(2026, 7, 1) }))
      .toBe(monthlyDebtObligation({ ...input, asOf: new Date(2026, 7, 28) }));
  });
});

describe('the rules the replacement has to keep', () => {
  it('holds back a card that has not been opened yet', () => {
    const unopened = { ...card, id: 'a3', name: 'Future Card', card_start_date: '2027-01-01' };
    const total = monthlyDebtObligation({
      debts: [{ name: 'Chase Sapphire', min_payment: 212 }, { name: 'Future Card', min_payment: 40 }],
      accounts: [card, unopened], carFunds: [], asOf,
    });
    expect(total).toBe(212);
  });

  it('is null with no income, never 0% and never "healthy"', () => {
    expect(debtToIncomeRatio({ debts: [{ name: 'Chase Sapphire', min_payment: 212 }], accounts: [card], carFunds: [], income: 0, asOf })).toBeNull();
    expect(debtToIncomeRatio({ debts: [], accounts: [], carFunds: [], income: -5, asOf })).toBeNull();
  });

  it('reads as a percentage of income', () => {
    const dti = debtToIncomeRatio({
      debts: [{ name: 'Chase Sapphire', min_payment: 500 }],
      accounts: [card, checking], carFunds: [], income: 5000, asOf,
    });
    expect(dti).toBeCloseTo(10, 5);
  });

  it('treats a missing or negative minimum as nothing owed rather than as a credit', () => {
    const total = monthlyDebtObligation({
      debts: [{ name: 'A', min_payment: null }, { name: 'B' }, { name: 'C', min_payment: -50 }, { name: 'D', min_payment: 75 }],
      accounts: [], carFunds: [], asOf,
    });
    expect(total).toBe(75);
  });
});
