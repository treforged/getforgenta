import { describe, it, expect } from 'vitest';
import {
  resolveLinkedLoanBalance, applyLinkedLoanBalances, linkedLoanAccountIds,
  type LinkableLoanAccount,
} from '../vehicle-loan-link';
import { buildAmortizationSchedule, getActiveCarLoanPayments } from '../vehicle-loan-engine';
import type { CarFund } from '../types';

// Tre, 2026-08-18: "for vehicles the loan amount isn't matching the connected bank account."
// His real rows: car_funds "2004 Chevorlet C5", loan_amount 16530 typed at activation, linked to
// accounts row "FIXED RATE LOAN" (auto_loan, Plaid-synced, balance 16254.49). The Vehicles page
// amortized from 16530 and read ~16,247 — close today because one payment has posted, and
// diverging monotonically because nothing ever re-anchors it. These are those numbers.

const ACCOUNT_ID = 'bcbc52b8-9a80-40d7-a45e-4b121c735629';
const LIVE_BALANCE = 16254.49;

function makeCarFund(overrides: Partial<CarFund> = {}): CarFund {
  return {
    id: 'car-1', user_id: 'u1', vehicle_name: '2004 Chevorlet C5', target_price: 0, tax_fees: 0,
    down_payment_goal: 0, current_saved: 0, saved_source: 'fixed', saved_percent: 0, sort_order: 0, auto_extra: false,
    monthly_insurance: 0, expected_apr: 10.18, loan_term_months: 48, phase: 'loan',
    loan_amount: 16530,
    loan_start_date: '2026-06-21', payment_start_date: '2026-08-07', interest_start_date: '2026-08-07',
    actual_monthly_payment: 422.89, linked_account: null, linked_rule_id: null,
    loan_payment_account: null, linked_loan_account_id: null,
    planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [],
    insurance_start_date: null, created_at: '2026-01-01',
    ...overrides,
  };
}

const liveAccount: LinkableLoanAccount = { id: ACCOUNT_ID, balance: LIVE_BALANCE, active: true };

describe('resolveLinkedLoanBalance', () => {
  it('returns the linked account balance when the FK is set and the account is live', () => {
    const cf = makeCarFund({ linked_loan_account_id: ACCOUNT_ID });
    expect(resolveLinkedLoanBalance(cf, [liveAccount])).toBe(LIVE_BALANCE);
  });

  it('returns null for an unlinked loan — there is no name heuristic here, ever', () => {
    const cf = makeCarFund({ linked_loan_account_id: null });
    // Same name on both sides: still null. A name match must not resolve a balance.
    expect(resolveLinkedLoanBalance(cf, [{ ...liveAccount, id: 'other' }])).toBeNull();
  });

  it('returns null when the linked account is INACTIVE, so the manual amortization survives', () => {
    const cf = makeCarFund({ linked_loan_account_id: ACCOUNT_ID });
    expect(resolveLinkedLoanBalance(cf, [{ ...liveAccount, active: false }])).toBeNull();
  });

  it('returns null when the link target is missing, or its balance is absent or non-positive', () => {
    const cf = makeCarFund({ linked_loan_account_id: ACCOUNT_ID });
    expect(resolveLinkedLoanBalance(cf, [])).toBeNull();
    expect(resolveLinkedLoanBalance(cf, [{ id: ACCOUNT_ID, balance: null }])).toBeNull();
    expect(resolveLinkedLoanBalance(cf, [{ id: ACCOUNT_ID, balance: 0 }])).toBeNull();
    // A negative balance is treated as no reading, not sign-flipped into a debt.
    expect(resolveLinkedLoanBalance(cf, [{ id: ACCOUNT_ID, balance: -16254.49 }])).toBeNull();
  });

  it('treats a row with no `active` flag as live', () => {
    const cf = makeCarFund({ linked_loan_account_id: ACCOUNT_ID });
    expect(resolveLinkedLoanBalance(cf, [{ id: ACCOUNT_ID, balance: LIVE_BALANCE }])).toBe(LIVE_BALANCE);
  });
});

describe('applyLinkedLoanBalances', () => {
  it('returns new rows carrying the override, and leaves the originals untouched', () => {
    const cf = makeCarFund({ linked_loan_account_id: ACCOUNT_ID });
    const [out] = applyLinkedLoanBalances([cf], [liveAccount]);
    expect(out.current_balance_override).toBe(LIVE_BALANCE);
    expect(out).not.toBe(cf);
    expect(cf.current_balance_override).toBeUndefined();
  });

  it('passes an unlinked row through by identity', () => {
    const cf = makeCarFund();
    const [out] = applyLinkedLoanBalances([cf], [liveAccount]);
    expect(out).toBe(cf);
  });
});

describe('linkedLoanAccountIds', () => {
  it('names the account only when the link actually resolves', () => {
    const linked = makeCarFund({ linked_loan_account_id: ACCOUNT_ID });
    expect(linkedLoanAccountIds([linked], [liveAccount]).has(ACCOUNT_ID)).toBe(true);
    // Inactive account: nothing is deduped, because nothing was re-anchored either.
    expect(linkedLoanAccountIds([linked], [{ ...liveAccount, active: false }]).size).toBe(0);
    expect(linkedLoanAccountIds([makeCarFund()], [liveAccount]).size).toBe(0);
  });
});

describe('buildAmortizationSchedule — the live-balance splice', () => {
  // Aug 7 first payment; "today" is Oct 15, so two payments (Aug, Sep) have posted and the first
  // not-yet-paid row is month 3 (Oct 7).
  const asOf = new Date(2026, 9, 15);
  const base = {
    loanAmount: 16530, apr: 10.18, termMonths: 48,
    loanStartDate: '2026-06-21', paymentStartDate: '2026-08-07', interestStartDate: '2026-08-07',
    actualMonthlyPayment: 422.89,
  };

  it('reports the live balance EXACTLY as what is owed, while the paid history is unchanged', () => {
    const manual = buildAmortizationSchedule(base, asOf);
    const spliced = buildAmortizationSchedule({ ...base, currentBalance: LIVE_BALANCE }, asOf);

    expect(spliced.remainingBalance).toBe(LIVE_BALANCE);
    expect(manual.remainingBalance).not.toBe(LIVE_BALANCE); // the drift this exists to close

    // The rows already paid are the only record of what was actually paid — they must not move.
    expect(spliced.monthsElapsed).toBe(manual.monthsElapsed);
    expect(spliced.interestPaidToDate).toBe(manual.interestPaidToDate);
    expect(spliced.schedule.slice(0, manual.monthsElapsed))
      .toEqual(manual.schedule.slice(0, manual.monthsElapsed));
  });

  it('projects forward off the bank number: the first unpaid row opens at it', () => {
    const spliced = buildAmortizationSchedule({ ...base, currentBalance: LIVE_BALANCE }, asOf);
    const firstUnpaid = spliced.schedule[spliced.monthsElapsed];
    expect(firstUnpaid.startBalance).toBe(LIVE_BALANCE);
    expect(firstUnpaid.date).toBe('2026-10-07');
    // Interest is charged on the live balance, not on the estimate.
    expect(firstUnpaid.interest).toBe(Math.round(LIVE_BALANCE * (10.18 / 100 / 12) * 100) / 100);
  });

  it('is byte-identical to the old behavior when there is no live balance', () => {
    const before = buildAmortizationSchedule(base, asOf);
    expect(buildAmortizationSchedule({ ...base, currentBalance: null }, asOf)).toEqual(before);
    expect(buildAmortizationSchedule({ ...base, currentBalance: undefined }, asOf)).toEqual(before);
  });

  it('ends the schedule instead of pushing a zero row when the bank says the loan is settled', () => {
    const settled = buildAmortizationSchedule({ ...base, currentBalance: 0 }, asOf);
    expect(settled.schedule.length).toBe(settled.monthsElapsed);
    expect(settled.remainingBalance).toBe(0);
  });
});

describe('getActiveCarLoanPayments — carries the resolved balance through', () => {
  const asOf = new Date(2026, 9, 15);

  it('reports the live balance for a linked loan and the manual one for an inactive link', () => {
    const linked = applyLinkedLoanBalances(
      [makeCarFund({ linked_loan_account_id: ACCOUNT_ID })], [liveAccount],
    );
    expect(getActiveCarLoanPayments(linked, asOf)[0].remainingBalance).toBe(LIVE_BALANCE);

    const inactive = applyLinkedLoanBalances(
      [makeCarFund({ linked_loan_account_id: ACCOUNT_ID })], [{ ...liveAccount, active: false }],
    );
    const fallback = getActiveCarLoanPayments(inactive, asOf)[0].remainingBalance;
    expect(fallback).not.toBe(LIVE_BALANCE);
    expect(fallback).toBe(getActiveCarLoanPayments([makeCarFund()], asOf)[0].remainingBalance);
  });
});
