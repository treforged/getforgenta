// A recurring bill paid EARLY, matched from the bank instead of confirmed by hand.
//
// This gate errs in the UNSAFE direction — dropping an obligation raises projected cash — so most
// of this file is about what must NOT match. The one happy path is cheap; the six refusals are the
// reason the feature is allowed to exist at all.
//
// Would-fail check: delete `earliestDate` from the charge in `buildAutoMatchedOccurrences` and
// "matches a bill paid twenty days early" fails while every refusal below stays green.

import { describe, it, expect } from 'vitest';
import {
  buildAutoMatchedOccurrences, mergeConfirmedOccurrences,
  type AutoMatchableRule,
} from '../auto-matched-occurrences';
import type { MatchableTransaction } from '../transaction-matching';

const ACCT = 'chk-1';
const AUG = new Date(2026, 7, 15); // August 2026

const rule = (over: Partial<AutoMatchableRule> = {}): AutoMatchableRule => ({
  id: 'r-1', name: 'Rent', amount: 1_200, rule_type: 'expense', frequency: 'monthly',
  due_day: 25, due_month: null, start_date: '2025-01-01', end_date: null,
  payment_source: ACCT, deposit_account: null, active: true,
  ...over,
} as unknown as AutoMatchableRule);

const txn = (over: Partial<MatchableTransaction> = {}): MatchableTransaction => ({
  id: 't-1', account_id: ACCT, amount: 1_200, date: '2026-08-05', pending: false, ...over,
});

const keys = (s: ReadonlySet<string>) => [...s].sort();

describe('buildAutoMatchedOccurrences — the one thing it is for', () => {
  it('matches a bill due the 25th that was actually paid on the 5th', () => {
    const out = buildAutoMatchedOccurrences({ rules: [rule()], transactions: [txn()], month: AUG });
    expect(keys(out)).toEqual(['r-1|2026-08-25']);
  });

  it('still matches one that posted around its due date, as it always did', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule()], transactions: [txn({ date: '2026-08-27' })], month: AUG,
    });
    expect(keys(out)).toEqual(['r-1|2026-08-25']);
  });

  it('accepts an amount inside the 1% tolerance', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule()], transactions: [txn({ amount: 1_208 })], month: AUG,
    });
    expect(out.size).toBe(1);
  });
});

describe('buildAutoMatchedOccurrences — what it must refuse', () => {
  it('refuses a PENDING charge — it can still be reversed', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule()], transactions: [txn({ pending: true })], month: AUG,
    });
    expect(out.size).toBe(0);
  });

  it('refuses a charge on a different account', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule()], transactions: [txn({ account_id: 'other' })], month: AUG,
    });
    expect(out.size).toBe(0);
  });

  it('refuses an INFLOW — a refund can never satisfy a bill', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule()], transactions: [txn({ amount: -1_200 })], month: AUG,
    });
    expect(out.size).toBe(0);
  });

  it('refuses an amount outside the tolerance', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule()], transactions: [txn({ amount: 1_400 })], month: AUG,
    });
    expect(out.size).toBe(0);
  });

  it('refuses when two charges are equally good — a coin flip is worse than silence', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule()],
      transactions: [txn({ id: 'a', date: '2026-08-05' }), txn({ id: 'b', date: '2026-08-06' })],
      month: AUG,
    });
    expect(out.size).toBe(0);
  });

  it('refuses an inactive rule', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule({ active: false } as Partial<AutoMatchableRule>)], transactions: [txn()], month: AUG,
    });
    expect(out.size).toBe(0);
  });

  it('refuses an INCOME rule — outflows only', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule({ rule_type: 'income' } as Partial<AutoMatchableRule>)],
      transactions: [txn({ amount: -1_200 })], month: AUG,
    });
    expect(out.size).toBe(0);
  });

  it('refuses a rule with no account — there is nowhere to look', () => {
    const out = buildAutoMatchedOccurrences({
      rules: [rule({ payment_source: null } as Partial<AutoMatchableRule>)],
      transactions: [txn()], month: AUG,
    });
    expect(out.size).toBe(0);
  });
});

describe('buildAutoMatchedOccurrences — the window cannot reach a neighbouring occurrence', () => {
  it('does NOT let last month payment suppress this month occurrence', () => {
    // Paid 2026-07-25, on time, for JULY. August's occurrence must stay owed.
    const out = buildAutoMatchedOccurrences({
      rules: [rule()], transactions: [txn({ date: '2026-07-25' })], month: AUG,
    });
    expect(out.size).toBe(0);
  });

  it('opens no earlier than 27 days before a monthly occurrence', () => {
    // 2026-08-25 minus 27 days is 2026-07-29. A charge on the 28th is out; the 29th is in.
    const before = buildAutoMatchedOccurrences({
      rules: [rule()], transactions: [txn({ date: '2026-07-28' })], month: AUG,
    });
    const after = buildAutoMatchedOccurrences({
      rules: [rule()], transactions: [txn({ date: '2026-07-29' })], month: AUG,
    });
    expect(before.size).toBe(0);
    expect(after.size).toBe(1);
  });

  it('keeps a weekly rule occurrences disjoint, one charge each', () => {
    const weekly = rule({ frequency: 'weekly', due_day: 1, amount: 50 } as Partial<AutoMatchableRule>);
    const out = buildAutoMatchedOccurrences({
      rules: [weekly],
      transactions: [
        txn({ id: 'w1', amount: 50, date: '2026-08-03' }),
        txn({ id: 'w2', amount: 50, date: '2026-08-10' }),
      ],
      month: AUG,
    });
    // Two charges, two distinct occurrences — never one charge claiming both.
    expect(out.size).toBe(2);
    expect(new Set(keys(out)).size).toBe(2);
  });

  it('one charge claims ONE occurrence, never two of the same bill', () => {
    const weekly = rule({ frequency: 'weekly', due_day: 1, amount: 50 } as Partial<AutoMatchableRule>);
    const out = buildAutoMatchedOccurrences({
      rules: [weekly], transactions: [txn({ id: 'only', amount: 50, date: '2026-08-03' })], month: AUG,
    });
    expect(out.size).toBe(1);
  });
});

describe('buildAutoMatchedOccurrences — the untouched paths', () => {
  it('a user with no synced transactions gets exactly the pre-existing behaviour', () => {
    expect(buildAutoMatchedOccurrences({ rules: [rule()], transactions: [], month: AUG }).size).toBe(0);
    expect(buildAutoMatchedOccurrences({ rules: [rule()], transactions: null, month: AUG }).size).toBe(0);
  });

  it('a user with no rules matches nothing and reads nothing', () => {
    expect(buildAutoMatchedOccurrences({ rules: [], transactions: [txn()], month: AUG }).size).toBe(0);
  });
});

describe('mergeConfirmedOccurrences', () => {
  it('unions manual and automatic, and a key in both is simply present', () => {
    const merged = mergeConfirmedOccurrences(new Set(['a|1', 'b|2']), new Set(['b|2', 'c|3']));
    expect(keys(merged)).toEqual(['a|1', 'b|2', 'c|3']);
  });

  it('is empty for no sets at all', () => {
    expect(mergeConfirmedOccurrences().size).toBe(0);
  });
});
