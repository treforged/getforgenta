import { describe, it, expect } from 'vitest';
import { buildMonth0DebtBreakdown, buildLoanRecommendations } from '../month0-debt-breakdown';
import type { CardData } from '../credit-card-engine';
import type { Month0Result } from '../debt-model-types';
import type { CarFund } from '../types';

/**
 * Loan rows in the "Recommended This Month" surfaces. They live in a SEPARATE
 * `loanRecommendations` field on purpose: `recommendations` feeds
 * `createDebtPaymentTransactions`, which injects a generated "Debt Payments" transaction per
 * row on four pages — and the car loan is already modelled in the transaction stream via
 * charge-obligations, so a loan row in `recommendations` would double-count it.
 */

const card = (over: Partial<CardData> & { id: string; name: string }): CardData => ({
  balance: 1000,
  apr: 20,
  creditLimit: 5000,
  minPayment: 35,
  targetPayment: 0,
  monthlyNewPurchases: 0,
  monthlyRepayments: 0,
  color: '#123456',
  paymentPreference: null,
  autopayFullBalance: false,
  dueDay: 20,
  statementBalancePhase: false,
  statementBalance: null,
  ...over,
});

const month0 = (
  perCardAdjusted: Month0Result['perCardAdjusted'],
  safeToPayTotal = 1000,
): Month0Result => ({
  safeToPayTotal,
  maxCapacity: safeToPayTotal,
  holdback: 0,
  holdbackEvent: null,
  cyclingPayment: 0,
  revolvingPayment: safeToPayTotal,
  perCardAdjusted,
  m0SafeFloor: 0,
  carReserve: 0,
  carReserveEvent: null,
  carReserveHeld: 0,
  autoExtraPerTarget: [],
  endCash: 0,
  vehicleInsurance: 0,
  mortgagePayment: 0,
  chain: {
    fundingBalance: 0, income: 0, expenses: 0, planExpenses: 0, goalContributions: 0, autoExtraReserve: 0,
    carSavedEarmark: 0, carSavedShortfall: 0, carReserve: 0,
    carLoanPayment: 0, vehicleInsurance: 0, mortgagePayment: 0, transfers: 0, oneTimeNet: 0,
    cashPreDebt: 0,
  },
});

function makeCarFund(overrides: Partial<CarFund>): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: 'USAA Auto', target_price: 0, tax_fees: 0,
    down_payment_goal: 0, current_saved: 0, saved_source: 'fixed', saved_percent: 0, sort_order: 0, auto_extra: false, monthly_insurance: 0, expected_apr: 0,
    loan_term_months: 48, phase: 'loan', loan_amount: 1000,
    loan_start_date: '2026-01-15', payment_start_date: '2026-01-07', interest_start_date: '2026-01-07',
    actual_monthly_payment: 300, linked_account: null, linked_rule_id: null, loan_payment_account: null, linked_loan_account_id: null,
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [], insurance_start_date: null, created_at: '2026-01-01',
    ...overrides,
  } as CarFund;
}

// Fixed so the due-day-vs-today comparisons don't drift with the calendar.
const CUTOFF = '2026-08-04';

describe('buildLoanRecommendations', () => {
  // Loan: $1,000 at 0% paid $300/mo from Jan 7 → rows Jan 300, Feb 300, Mar 300, Apr 100.

  it('leads with this month when the due day has not passed', () => {
    const rows = buildLoanRecommendations([makeCarFund({})], new Date(2026, 0, 4)); // Jan 4, due 7
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      carFundId: 'car-1', name: 'USAA Auto', payment: 300, dueDay: 7,
      nextPayment: 300, nextPayMonth: 0, isFinalPayment: false,
    });
    expect(rows[0].nextDueDate?.getMonth()).toBe(0);
    expect(rows[0].nextDueDate?.getDate()).toBe(7);
  });

  it("leads with next month's payment once the due day has passed — same calendar rule as cards", () => {
    const rows = buildLoanRecommendations([makeCarFund({})], new Date(2026, 0, 20)); // Jan 20, due 7
    expect(rows[0]).toMatchObject({ payment: 300, nextPayment: 300, nextPayMonth: 1 });
    expect(rows[0].nextDueDate?.getMonth()).toBe(1); // Feb 7
    expect(rows[0].nextDueDate?.getDate()).toBe(7);
  });

  it('shows the true-up amount and the Final payment flag on the last scheduled month', () => {
    const rows = buildLoanRecommendations([makeCarFund({})], new Date(2026, 3, 4)); // Apr 4, final row
    expect(rows[0]).toMatchObject({ payment: 100, nextPayment: 100, nextPayMonth: 0, isFinalPayment: true });
  });

  it('flags Final payment when the headline is next month and next month is the last row', () => {
    const rows = buildLoanRecommendations([makeCarFund({})], new Date(2026, 2, 20)); // Mar 20, past due day
    expect(rows[0]).toMatchObject({ nextPayment: 100, nextPayMonth: 1, isFinalPayment: true });
  });

  it('drops the row when the due day has passed and the loan has no next payment', () => {
    // Apr 20: the final $100 row's due day (7th) is behind us and the schedule ends — there is
    // nothing upcoming to recommend, and inventing a figure past the last row would be a number
    // the schedule does not stand behind.
    expect(buildLoanRecommendations([makeCarFund({})], new Date(2026, 3, 20))).toEqual([]);
  });

  it('ignores saving-phase car funds — only loan-phase vehicles are debts', () => {
    expect(buildLoanRecommendations([makeCarFund({ phase: 'saving' })], new Date(2026, 0, 4))).toEqual([]);
  });
});

describe('buildMonth0DebtBreakdown — loan rows and the transaction-injection guard', () => {
  const cards = [card({ id: 'a', name: 'Sapphire' })];
  const m0 = () => month0([{ id: 'a', name: 'Sapphire', payment: 500, maxPayment: 500 }], 500);
  const NOW = new Date(2026, 0, 4);

  it('carries the loan rows on the separate loanRecommendations field', () => {
    const result = buildMonth0DebtBreakdown({
      month0: m0(), simCards: cards, debtStrategy: 'avalanche', syncCutoffDate: CUTOFF,
      carFunds: [makeCarFund({})], now: NOW,
    });
    expect(result.loanRecommendations).toHaveLength(1);
    expect(result.loanRecommendations?.[0].name).toBe('USAA Auto');
  });

  it('NEVER lets a loan into recommendations — that array feeds createDebtPaymentTransactions', () => {
    const withLoan = buildMonth0DebtBreakdown({
      month0: m0(), simCards: cards, debtStrategy: 'avalanche', syncCutoffDate: CUTOFF,
      carFunds: [makeCarFund({})], now: NOW,
    });
    const withoutLoan = buildMonth0DebtBreakdown({
      month0: m0(), simCards: cards, debtStrategy: 'avalanche', syncCutoffDate: CUTOFF,
      now: NOW,
    });
    // Byte-identical card rows: a loan row here would inject a phantom "Debt Payments"
    // transaction on Dashboard, Budget Control, Savings Goals and Transactions, double-counting
    // a loan the stream already models via charge-obligations.
    expect(withLoan.recommendations).toEqual(withoutLoan.recommendations);
    expect(withLoan.recommendations.every(r => r.cardId === 'a')).toBe(true);
  });

  it('keeps every card-only total unchanged by loans — the floor already holds loan money', () => {
    const withLoan = buildMonth0DebtBreakdown({
      month0: m0(), simCards: cards, debtStrategy: 'avalanche', syncCutoffDate: CUTOFF,
      carFunds: [makeCarFund({})], now: NOW,
    });
    const withoutLoan = buildMonth0DebtBreakdown({
      month0: m0(), simCards: cards, debtStrategy: 'avalanche', syncCutoffDate: CUTOFF,
      now: NOW,
    });
    expect(withLoan.totalRecommended).toBe(withoutLoan.totalRecommended);
    expect(withLoan.totalMinimumsDue).toBe(withoutLoan.totalMinimumsDue);
    expect(withLoan.totalAvailableCash).toBe(withoutLoan.totalAvailableCash);
    expect(withLoan.autopayTotal).toBe(withoutLoan.autopayTotal);
    expect(withLoan.cashWarning).toBe(withoutLoan.cashWarning);
  });

  it('still lists the loan when the projection has not resolved — a real payment does not stop being due', () => {
    const result = buildMonth0DebtBreakdown({
      month0: null, simCards: cards, debtStrategy: 'avalanche', syncCutoffDate: CUTOFF,
      carFunds: [makeCarFund({})], now: NOW,
    });
    expect(result.recommendations).toEqual([]);
    expect(result.loanRecommendations).toHaveLength(1);
  });
});
