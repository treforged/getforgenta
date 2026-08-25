// @vitest-environment jsdom
//
// `useMonth0DebtBreakdown` is the ONE current-month debt breakdown every surface reads, and its
// non-CC liability rows are only as real as the arguments this call site passes. The builder grew
// `accounts` / `debts` / `rules` / `excludedAccountIds` when student loans and mortgages joined
// "Recommended This Month"; until they were threaded through, `otherDebtRecommendations` came back
// as an honest but permanently empty array and the Dashboard widget had nothing to render.
//
// Would-fail check: drop any one of the three inputs from the call and case 1 gets [] back (the
// pairing rule that decides which liability is real needs all three); drop `excludedAccountIds`
// and case 3 double-counts the vehicle loan the car fund already carries.

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMonth0DebtBreakdown } from '../useMonth0DebtBreakdown';
import type { AccountRow, DebtRow, RuleRow } from '@/hooks/useSupabaseData';
import type { CarFund } from '@/lib/types';

const ctx = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));

vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ctx.value,
}));

const account = (over: Partial<AccountRow> & { id: string; name: string; account_type: string }): AccountRow => ({
  user_id: 'u1', balance: 0, active: true, ...over,
} as AccountRow);

const debt = (over: Partial<DebtRow> & { id: string; name: string }): DebtRow => ({
  balance: 0, apr: 0, min_payment: 0, target_payment: 0, ...over,
} as DebtRow);

const STUDENT_LOAN = account({
  id: 'sl', name: 'Student Loan', account_type: 'student_loan', balance: 12000, payment_due_day: 20,
});
const STUDENT_DEBT = debt({ id: 'd1', name: 'Student Loan', balance: 12000, apr: 12, target_payment: 300, min_payment: 250 });

const AUTO_LOAN_ACCOUNT = account({
  id: 'auto', name: 'Car Loan', account_type: 'other_liability', balance: 20000,
});
const AUTO_DEBT = debt({ id: 'd2', name: 'Car Loan', balance: 20000, apr: 6, target_payment: 450, min_payment: 450 });

const CAR_FUND_LINKED_TO_AUTO = {
  id: 'cf1', vehicle_name: 'Civic', phase: 'loan', linked_loan_account_id: 'auto',
} as unknown as CarFund;

function setup(over: Partial<{
  accounts: AccountRow[]; debts: DebtRow[]; rules: RuleRow[]; carFunds: CarFund[];
}> = {}) {
  ctx.value = {
    cardProjection: null,
    debtStrategy: 'avalanche',
    syncCutoffDate: '2026-01-01',
    carFunds: [],
    accounts: [],
    debts: [],
    rules: [],
    ...over,
  };
  return renderHook(() => useMonth0DebtBreakdown()).result.current;
}

describe('useMonth0DebtBreakdown — non-CC liability rows', () => {
  it('builds a row for a student loan paired to a debts row', () => {
    const breakdown = setup({ accounts: [STUDENT_LOAN], debts: [STUDENT_DEBT] });
    expect((breakdown.otherDebtRecommendations ?? []).map(r => [r.accountId, r.accountType, r.payment]))
      .toEqual([['sl', 'student_loan', 300]]);
  });

  it('NEVER lets one into `recommendations` — that array feeds createDebtPaymentTransactions', () => {
    const breakdown = setup({ accounts: [STUDENT_LOAN], debts: [STUDENT_DEBT] });
    expect(breakdown.recommendations).toEqual([]);
  });

  it('leaves out an account a vehicle loan is linked to — the car fund already carries it', () => {
    const breakdown = setup({
      accounts: [STUDENT_LOAN, AUTO_LOAN_ACCOUNT],
      debts: [STUDENT_DEBT, AUTO_DEBT],
      carFunds: [CAR_FUND_LINKED_TO_AUTO],
    });
    expect((breakdown.otherDebtRecommendations ?? []).map(r => r.accountId)).toEqual(['sl']);
  });

  it('flags a debt an active expense rule already pays, rather than dropping it', () => {
    const rule = { id: 'r1', name: 'student loan', rule_type: 'expense', active: true } as unknown as RuleRow;
    const breakdown = setup({ accounts: [STUDENT_LOAN], debts: [STUDENT_DEBT], rules: [rule] });
    expect((breakdown.otherDebtRecommendations ?? []).map(r => r.paidByExpenseRule)).toEqual([true]);
  });

  it('returns an empty list, not a phantom row, when nothing is paired', () => {
    const breakdown = setup({ accounts: [STUDENT_LOAN], debts: [] });
    expect(breakdown.otherDebtRecommendations).toEqual([]);
  });
});
