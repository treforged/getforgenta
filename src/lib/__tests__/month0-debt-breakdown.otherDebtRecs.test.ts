// "Recommended This Month" rows for a student loan / mortgage.
//
// Two things are being pinned. First, these rows are NEVER in `recommendations` — that array feeds
// `createDebtPaymentTransactions`, and these payments are already in the cash model, so a row there
// would inject a phantom transaction on four pages. Second, the due date is never invented:
// `accounts.payment_due_day` is the only source and it is null on most liability rows, so the row
// says it does not know rather than showing a plausible date.
//
// Would-fail check: append these rows to `recommendations` and case 1 finds a student loan among
// the card rows; default `dueDay` to any number and case 3's `nextDueDate` stops being null.

import { describe, it, expect } from 'vitest';
import { buildMonth0DebtBreakdown, buildOtherDebtRecommendations } from '@/lib/month0-debt-breakdown';
import type { CardData } from '@/lib/credit-card-engine';
import type { Month0Result } from '@/lib/debt-model-types';

const NOW = new Date(2026, 0, 10); // 10 Jan 2026

const accounts = [
  { id: 'sl', name: 'Student Loan', account_type: 'student_loan', balance: 12000, active: true, payment_due_day: 20 },
  { id: 'mtg', name: 'Home Loan', account_type: 'mortgage', balance: 250000, active: true, payment_due_day: null },
];
const debts = [
  { id: 'd1', name: 'Student Loan', balance: 1, apr: 12, target_payment: 300, min_payment: 250 },
  { id: 'd2', name: 'Home Loan', balance: 1, apr: 6, target_payment: 1800, min_payment: 1800 },
];

const build = (over: Parameters<typeof buildOtherDebtRecommendations>[0] = { accounts, debts, rules: [] }) =>
  buildOtherDebtRecommendations({ now: NOW, ...over });

describe('buildOtherDebtRecommendations', () => {
  it('builds a row per paired liability with the debts row\'s scheduled payment', () => {
    const rows = build();
    expect(rows.map(r => [r.accountId, r.accountType, r.payment])).toEqual([
      ['sl', 'student_loan', 300],
      ['mtg', 'mortgage', 1800],
    ]);
  });

  it('leads with THIS month when the due day is still ahead', () => {
    const [sl] = build();
    expect(sl.dueDay).toBe(20);
    expect(sl.nextPayMonth).toBe(0);
    expect(sl.nextPayment).toBe(300);
    expect(sl.nextDueDate).toEqual(new Date(2026, 0, 20));
    expect(sl.isFinalPayment).toBe(false);
  });

  it('says nothing it does not know when no due day is recorded', () => {
    const mtg = build()[1];
    expect(mtg.dueDay).toBeNull();
    // No date is invented, and an unknown due day is NOT read as past due.
    expect(mtg.nextDueDate).toBeNull();
    expect(mtg.nextPayMonth).toBe(0);
  });

  it('rolls to next month once the due day has gone by', () => {
    const [sl] = build({ accounts, debts, rules: [], now: new Date(2026, 0, 25) });
    expect(sl.nextPayMonth).toBe(1);
    expect(sl.nextDueDate).toEqual(new Date(2026, 1, 20));
  });

  it('caps the final payment at what is actually owed, and flags it', () => {
    // 250 owed at 12% apr ⇒ 252.50 with one month's interest, less than the $300 scheduled.
    const [row] = build({
      accounts: [{ ...accounts[0], balance: 250 }], debts, rules: [], now: NOW,
    });
    expect(row.payment).toBeCloseTo(252.5, 6);
    expect(row.nextPayment).toBeCloseTo(252.5, 6);
    expect(row.isFinalPayment).toBe(true);
  });

  it('drops the row entirely when this month was the last payment and the day has gone', () => {
    expect(build({
      accounts: [{ ...accounts[0], balance: 250 }], debts, rules: [], now: new Date(2026, 0, 25),
    })).toEqual([]);
  });

  it('drops a debt with no payment recorded rather than recommending $0', () => {
    expect(build({
      accounts, rules: [],
      debts: [{ id: 'd1', name: 'Student Loan', balance: 1, apr: 12, target_payment: 0, min_payment: 0 }],
    })).toEqual([]);
  });

  it('falls back to min_payment when there is no target payment', () => {
    const [row] = build({
      accounts, rules: [],
      debts: [{ id: 'd1', name: 'Student Loan', balance: 12000, apr: 12, target_payment: 0, min_payment: 250 }],
    });
    expect(row.payment).toBe(250);
  });

  it('marks, but never hides, a debt an expense rule pays', () => {
    const [row] = build({
      accounts, debts, rules: [{ name: 'student loan', rule_type: 'expense', active: true }],
    });
    expect(row.accountId).toBe('sl');
    expect(row.paidByExpenseRule).toBe(true);
    expect(build()[0].paidByExpenseRule).toBe(false);
  });

  it('leaves a linked vehicle-loan account to the car fund', () => {
    expect(build({ accounts, debts, rules: [], excludedAccountIds: new Set(['sl', 'mtg']) })).toEqual([]);
  });
});

describe('buildMonth0DebtBreakdown — where the liability rows are, and are not', () => {
  const card = {
    id: 'c1', name: 'Visa', balance: 1000, minPayment: 50, apr: 20, dueDay: 15,
    color: '#111', autopayFullBalance: false, monthlyNewPurchases: 0, paymentPreference: 'revolving',
    statementBalance: null, creditLimit: 5000,
  } as unknown as CardData;
  const month0 = {
    perCardAdjusted: [{ id: 'c1', name: 'Visa', payment: 200, maxPayment: 200 }],
    safeToPayTotal: 200,
  } as unknown as Month0Result;

  const breakdown = (over: Record<string, unknown> = {}) => buildMonth0DebtBreakdown({
    month0, simCards: [card], debtStrategy: 'avalanche', syncCutoffDate: '2026-01-01',
    accounts, debts, rules: [], now: NOW, ...over,
  });

  it('NEVER puts a liability in `recommendations` — that array injects transactions', () => {
    const r = breakdown();
    expect(r.recommendations.map(x => x.cardId)).toEqual(['c1']);
    expect(r.otherDebtRecommendations?.map(x => x.accountId)).toEqual(['sl', 'mtg']);
  });

  it('leaves the totals alone: that cash was already spent before Safe to Pay was computed', () => {
    const withLiabilities = breakdown();
    const without = breakdown({ accounts: [], debts: [] });
    expect(withLiabilities.totalRecommended).toBe(without.totalRecommended);
    expect(withLiabilities.totalMinimumsDue).toBe(without.totalMinimumsDue);
    expect(withLiabilities.totalAvailableCash).toBe(without.totalAvailableCash);
  });

  it('still lists the liabilities when the card projection has not resolved', () => {
    // A real payment does not stop being due because the sim has not settled.
    const r = breakdown({ month0: null });
    expect(r.otherDebtRecommendations?.map(x => x.accountId)).toEqual(['sl', 'mtg']);
    expect(r.recommendations).toEqual([]);
  });

  it('is an empty list, not undefined, when no liability data is supplied', () => {
    expect(buildMonth0DebtBreakdown({
      month0, simCards: [card], debtStrategy: 'avalanche', syncCutoffDate: '2026-01-01', now: NOW,
    }).otherDebtRecommendations).toEqual([]);
  });
});
