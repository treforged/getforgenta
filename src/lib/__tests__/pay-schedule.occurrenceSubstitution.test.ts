// The real transaction overrides the projected one. Tre, 2026-08-24: "if a transaction matches a
// budget rule, the real transaction date and costs should auto override the transaction for that
// month. the real one should actually show."
//
// WHAT WAS BROKEN. `mergeWithGeneratedTransactions` substituted on a byte-identical
// `date:note:amount` triple, so it fired only when the real row was IDENTICAL to the projection —
// precisely the case where there is nothing to override. Rent projected at $1,600 on the 15th and
// actually paid $1,608 on the 17th produced BOTH rows, and every surface summing the stream charged
// the month twice.
//
// DIRECTION OF HARM, and why most of this file is refusals. Dropping a generated occurrence RAISES
// projected cash, which is the dangerous direction — the same asymmetry `auto-matched-occurrences`
// documents. So the new rule is exactly-one-candidate-or-nothing, and the tests that matter are the
// ones proving an unrelated row cannot eat a projection.
//
// Would-fail check: widen `DATE_WINDOW_DAYS` in the gate to 30 and "refuses a real payment outside
// the settle window" fails while the happy path stays green.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mergeWithGeneratedTransactions,
  mergeWithGeneratedTransactionsForHorizon,
  overridesGeneratedOccurrence,
  type EnrichedTransaction,
} from '../pay-schedule';
import type { RuleRow } from '@/hooks/useSupabaseData';

const ACCT = 'acct-1';
const NOW = new Date('2026-08-11T12:00:00');

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: 'r1',
  name: 'Rent',
  amount: 1600,
  rule_type: 'expense',
  frequency: 'monthly',
  active: true,
  start_date: '2026-01-01',
  end_date: null,
  category: 'Bills',
  due_day: 15,
  due_month: null,
  payment_source: ACCT,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

const real = (over: Partial<EnrichedTransaction> = {}): EnrichedTransaction => ({
  id: 'real-1',
  date: '2026-08-17',
  type: 'expense',
  amount: 1608,
  category: 'Bills',
  note: 'Rent',
  payment_source: `account:${ACCT}`,
  ...over,
});

/** The generated occurrences that survived the merge. */
const survivingGenerated = (merged: EnrichedTransaction[]) => merged.filter(t => t.isGenerated);

const mergeNow = (reals: EnrichedTransaction[], rules: RuleRow[] = [rule()]) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  return mergeWithGeneratedTransactions(reals, rules, []);
};

afterEach(() => vi.useRealTimers());

describe('mergeWithGeneratedTransactions — the real row replaces its projection', () => {
  it('THE CASE TRE ASKED FOR: a real payment differing in DATE (within the window) and AMOUNT ' +
     '(within tolerance) retires its generated row, and the real figures are what remain', () => {
    const merged = mergeNow([real({ date: '2026-08-17', amount: 1608 })]);

    expect(survivingGenerated(merged)).toHaveLength(0);
    const rent = merged.filter(t => t.note === 'Rent');
    expect(rent).toHaveLength(1);
    expect(rent[0].date).toBe('2026-08-17');
    expect(rent[0].amount).toBe(1608);
  });

  it('still substitutes a byte-identical row, exactly as it always did', () => {
    const merged = mergeNow([real({ date: '2026-08-15', amount: 1600 })]);
    expect(survivingGenerated(merged)).toHaveLength(0);
  });

  it('substitutes when the real row is unattributed — a hand-typed row rarely names an account', () => {
    const merged = mergeNow([real({ payment_source: null })]);
    expect(survivingGenerated(merged)).toHaveLength(0);
  });

  it('reads a bare account id and an `account:`-prefixed one as the same account', () => {
    const merged = mergeNow([real({ payment_source: ACCT })]);
    expect(survivingGenerated(merged)).toHaveLength(0);
  });

  it('matches the note case-insensitively and ignores surrounding space', () => {
    const merged = mergeNow([real({ note: '  rent ' })]);
    expect(survivingGenerated(merged)).toHaveLength(0);
  });
});

describe('mergeWithGeneratedTransactions — what must NOT eat a projection', () => {
  it('AN UNRELATED SAME-DAY, SAME-AMOUNT TRANSACTION leaves the projection standing', () => {
    const merged = mergeNow([real({ date: '2026-08-15', amount: 1600, note: 'Car Insurance' })]);

    const generated = survivingGenerated(merged);
    expect(generated).toHaveLength(1);
    expect(generated[0].date).toBe('2026-08-15');
    expect(generated[0].amount).toBe(1600);
    // Both rows survive: the unrelated spend AND the bill that has not been paid.
    expect(merged.filter(t => t.date === '2026-08-15')).toHaveLength(2);
  });

  it('refuses a real payment outside the settle window, however exact the amount', () => {
    const merged = mergeNow([real({ date: '2026-08-25', amount: 1600 })]);
    expect(survivingGenerated(merged)).toHaveLength(1);
  });

  it('refuses an amount outside the 1% tolerance', () => {
    const merged = mergeNow([real({ amount: 1800 })]);
    expect(survivingGenerated(merged)).toHaveLength(1);
  });

  it('refuses the opposite direction — an income row never answers an expense', () => {
    const merged = mergeNow([real({ type: 'income' })]);
    expect(survivingGenerated(merged)).toHaveLength(1);
  });

  it('refuses a charge on a DIFFERENT named account', () => {
    const merged = mergeNow([real({ payment_source: 'account:other' })]);
    expect(survivingGenerated(merged)).toHaveLength(1);
  });

  it('refuses when two real rows are equally plausible — a coin flip is worse than a duplicate', () => {
    const merged = mergeNow([
      real({ id: 'a', date: '2026-08-16', amount: 1604 }),
      real({ id: 'b', date: '2026-08-17', amount: 1608 }),
    ]);
    expect(survivingGenerated(merged)).toHaveLength(1);
  });

  it('refuses a row the app generated elsewhere — a car-loan payment is itself a projection', () => {
    const merged = mergeNow([real({ isCarLoanPayment: true })]);
    expect(survivingGenerated(merged)).toHaveLength(1);
  });

  it('refuses a reconciliation row — a balance adjustment is not a bill being paid', () => {
    const merged = mergeNow([real({ isReconciliation: true })]);
    expect(survivingGenerated(merged)).toHaveLength(1);
  });

  it('an unnamed rule substitutes nothing — an empty note must not match every blank row', () => {
    const merged = mergeNow([real({ note: '' })], [rule({ name: '' })]);
    expect(survivingGenerated(merged)).toHaveLength(1);
  });

  it('ONE real payment cannot retire TWO occurrences of a weekly rule', () => {
    // A weekly rule bills every Friday; ±5 day windows are 11 days wide and 7 apart, so a single
    // charge sits inside two of them. It may only ever spend itself once.
    const weekly = rule({ id: 'w1', name: 'Fuel', amount: 60, frequency: 'weekly', due_day: 5 });
    const merged = mergeNow([real({ note: 'Fuel', amount: 60, date: '2026-08-11' })], [weekly]);

    const generated = survivingGenerated(merged);
    const allFridays = mergeNow([], [weekly]).filter(t => t.isGenerated);
    expect(allFridays.length).toBeGreaterThan(1);
    expect(generated).toHaveLength(allFridays.length - 1);
  });
});

describe('overridesGeneratedOccurrence — the gate on its own', () => {
  const generated: EnrichedTransaction = {
    id: 'gen:r1:2026-08-15', date: '2026-08-15', type: 'expense', amount: 1600,
    category: 'Bills', note: 'Rent', payment_source: `account:${ACCT}`, isGenerated: true,
  };

  it('accepts the drifted-but-same-bill case', () => {
    expect(overridesGeneratedOccurrence(generated, real())).toBe(true);
  });

  it('a malformed date substitutes nothing rather than everything', () => {
    expect(overridesGeneratedOccurrence(generated, real({ date: 'not-a-date' }))).toBe(false);
  });

  it('a zero amount is no information, not a match', () => {
    expect(overridesGeneratedOccurrence({ ...generated, amount: 0 }, real({ amount: 0 }))).toBe(false);
  });
});

describe('mergeWithGeneratedTransactionsForHorizon — the month seam', () => {
  it('ONE real payment cannot retire an occurrence in the current month AND one in the next', () => {
    // A weekly Friday rule bills 2026-08-28 and 2026-09-04. A payment on Monday 2026-08-31 is 3 days
    // from the first and 4 from the second, so it is inside BOTH windows — and the two occurrences
    // are produced by different halves of this function (the base merge, then the future loop). Only
    // one claim ledger spanning both stops the same $60 retiring both fill-ups. The byte-identical
    // rule this replaced could never hit this, because two different dates are never byte-identical.
    const weekly = rule({ id: 'w2', name: 'Fuel', amount: 60, frequency: 'weekly', due_day: 5 });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    const payment = real({ id: 'p1', note: 'Fuel', amount: 60, date: '2026-08-31' });
    const withPayment = mergeWithGeneratedTransactionsForHorizon([payment], [weekly], [], 2);
    const without = mergeWithGeneratedTransactionsForHorizon([], [weekly], [], 2);

    const dates = (rows: EnrichedTransaction[]) => rows.filter(t => t.isGenerated).map(t => t.date);
    expect(dates(without)).toContain('2026-08-28');
    expect(dates(without)).toContain('2026-09-04');

    // Exactly one occurrence retired, and it is the nearer one, in the current month.
    expect(dates(withPayment)).toHaveLength(dates(without).length - 1);
    expect(dates(withPayment)).not.toContain('2026-08-28');
    expect(dates(withPayment)).toContain('2026-09-04');
  });

  it('is still exactly the current-month merge when the horizon is 1', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const horizon = mergeWithGeneratedTransactionsForHorizon([], [rule()], [], 1);
    const current = mergeWithGeneratedTransactions([], [rule()], []);
    expect(horizon).toEqual(current);
  });
});
