// §1A Stage B — the pure rule↔transaction matcher.
//
// THE POINT OF THIS FILE: pin CONSERVATISM. This matcher's output is user-visible (the
// auto-matched badge on /budget) and will later gate a projected number (Stage C). An absent
// match must read as "no information"; a WRONG match reads as "this bill was paid" when it
// wasn't. So every ambiguous case below must return null, and these tests exist to stop someone
// "improving" the hit rate by loosening a tolerance.
//
// The tolerances and rejections here are grounded in Tre's real data (2026-08-07):
//   - payment_source holds a BARE accounts.id uuid (28/28 non-null rules), not a name.
//   - The 143 synced Discover rows are discretionary card spend — e.g. THREE separate $10.00
//     "CFX - E-PASS A/R" tolls on 2026-08-03. A $10 rule near that date has three candidates and
//     must match none of them.
//   - Discover's own two rules are "Eating Out" $75/mo and "Dog food" $45/mo — spending budgets,
//     not bills. Nothing should coincidentally badge them as paid.
//   - For weekly/biweekly rules `due_day` is a DAY OF WEEK (scheduling.ts:215), so treating it as
//     a day of month would aim the date window at an arbitrary date. Those frequencies are refused.

import { describe, it, expect } from 'vitest';
import {
  matchOccurrence,
  normalizePaymentSource,
  hasCoverage,
  buildCaptureEvidence,
  DATE_WINDOW_DAYS,
  type MatchableRule,
  type MatchableTransaction,
} from '../transaction-matching';

const ACCT = '34c9574b-3557-4729-a812-f0b1b508b882'; // Discover it Card
const OTHER_ACCT = '9111bd9f-4704-4acb-97f7-cf1ab40bc764'; // Prime Visa

const rule = (over: Partial<MatchableRule> = {}): MatchableRule => ({
  id: 'r1',
  amount: 120,
  due_day: 15,
  due_month: null,
  frequency: 'monthly',
  rule_type: 'expense',
  payment_source: ACCT,
  active: true,
  ...over,
});

const txn = (over: Partial<MatchableTransaction> = {}): MatchableTransaction => ({
  id: 't1',
  account_id: ACCT,
  amount: 120,          // outflow positive — Stage A's normalization
  date: '2026-08-15',
  pending: false,
  name: 'ACME UTILITIES',
  merchant_name: 'Acme',
  ...over,
});

describe('normalizePaymentSource', () => {
  // Live data is bare uuids, but four other call sites strip an `account:` prefix
  // (card-start-date.ts:45, pay-schedule.ts:698, upcoming-obligations.ts:46, credit-card-engine.ts:219)
  // and demo fixtures still emit it. Accept both rather than silently matching nothing in demo mode.
  it('strips the legacy account: prefix', () => {
    expect(normalizePaymentSource(`account:${ACCT}`)).toBe(ACCT);
  });
  it('passes a bare uuid through — the shape live rows actually use', () => {
    expect(normalizePaymentSource(ACCT)).toBe(ACCT);
  });
  it('treats null/empty as unattributed, not as a match-anything wildcard', () => {
    expect(normalizePaymentSource(null)).toBeNull();
    expect(normalizePaymentSource('')).toBeNull();
  });
});

describe('matchOccurrence — the happy path', () => {
  it('matches an exact amount on the exact due date', () => {
    const m = matchOccurrence(rule(), '2026-08', [txn()]);
    expect(m?.txn.id).toBe('t1');
    expect(m?.confidence).toBe('exact');
  });

  it('matches an exact amount posted a few days off the due date', () => {
    const m = matchOccurrence(rule(), '2026-08', [txn({ date: '2026-08-18' })]);
    expect(m?.confidence).toBe('exact');
  });

  it('matches a near-miss amount as a weaker match, not an exact one', () => {
    // Variable bills (utilities) drift by cents-to-a-dollar. Still worth badging, but the caller
    // can tell it apart from a to-the-penny hit.
    const m = matchOccurrence(rule({ amount: 120 }), '2026-08', [txn({ amount: 120.75 })]);
    expect(m?.confidence).toBe('strong');
  });

  it('prefers the exact candidate when a near-miss is also in the window', () => {
    const m = matchOccurrence(rule(), '2026-08', [
      txn({ id: 'near', amount: 120.6, date: '2026-08-14' }),
      txn({ id: 'exact', amount: 120, date: '2026-08-16' }),
    ]);
    expect(m?.txn.id).toBe('exact');
  });

  it('matches an income rule against an inflow (negative amount)', () => {
    const m = matchOccurrence(
      rule({ rule_type: 'income', amount: 1462.5 }),
      '2026-08',
      [txn({ amount: -1462.5 })],
    );
    expect(m?.confidence).toBe('exact');
  });

  it('matches a yearly rule in its due_month', () => {
    const m = matchOccurrence(
      rule({ frequency: 'yearly', due_month: 8 }),
      '2026-08',
      [txn()],
    );
    expect(m?.confidence).toBe('exact');
  });

  it('reads a legacy account:-prefixed payment_source', () => {
    const m = matchOccurrence(rule({ payment_source: `account:${ACCT}` }), '2026-08', [txn()]);
    expect(m).not.toBeNull();
  });
});

describe('matchOccurrence — refuses to guess', () => {
  it('returns null when two candidates are equally good — the CFX toll case', () => {
    // Three identical $10.00 CFX tolls landed on 2026-08-03 in real data. A $10 rule due Aug 3
    // has no way to know which one is "the" bill, and picking one would be a coin flip presented
    // as evidence.
    const m = matchOccurrence(rule({ amount: 10, due_day: 3 }), '2026-08', [
      txn({ id: 'a', amount: 10, date: '2026-08-03' }),
      txn({ id: 'b', amount: 10, date: '2026-08-03' }),
      txn({ id: 'c', amount: 10, date: '2026-08-03' }),
    ]);
    expect(m).toBeNull();
  });

  it('returns null when several near-misses compete and none is exact', () => {
    const m = matchOccurrence(rule({ amount: 50 }), '2026-08', [
      txn({ id: 'a', amount: 50.4, date: '2026-08-14' }),
      txn({ id: 'b', amount: 49.7, date: '2026-08-16' }),
    ]);
    expect(m).toBeNull();
  });

  it('keeps the near-miss band proportional, so a small rule rejects a small coincidence', () => {
    // A $1 absolute floor was tried first and let a $10 rule accept a $10.75 coffee. Cards are
    // mostly small discretionary charges, so an absolute floor is at its most dangerous exactly
    // where the data is densest. 1% of $10 is 10c, and 75c is nowhere near it.
    const m = matchOccurrence(rule({ amount: 10 }), '2026-08', [txn({ amount: 10.75 })]);
    expect(m).toBeNull();
  });

  it('does not badge a spending budget when several purchases could be it', () => {
    // "Eating Out" $75/mo is a budget, not a bill — there is no single transaction that "is" it.
    // The tolerance cannot tell a budget from a bill, and it is not asked to: what protects this
    // case is that a real card month offers several plausible charges, and several is not one.
    const m = matchOccurrence(rule({ amount: 75, due_day: 28 }), '2026-08', [
      txn({ id: 'a', amount: 75.4, date: '2026-08-27', name: 'SOME RESTAURANT' }),
      txn({ id: 'b', amount: 74.6, date: '2026-08-29', name: 'ANOTHER RESTAURANT' }),
    ]);
    expect(m).toBeNull();
  });

  it('ignores transactions on a different account', () => {
    const m = matchOccurrence(rule(), '2026-08', [txn({ account_id: OTHER_ACCT })]);
    expect(m).toBeNull();
  });

  it('returns null when the rule has no payment_source', () => {
    // Unattributed rules cannot be tied to an account, so any match would be a guess across every
    // account the user owns.
    const m = matchOccurrence(rule({ payment_source: null }), '2026-08', [txn()]);
    expect(m).toBeNull();
  });

  it('ignores transactions whose account_id never resolved', () => {
    const m = matchOccurrence(rule(), '2026-08', [txn({ account_id: null })]);
    expect(m).toBeNull();
  });

  it('ignores PENDING transactions — settled evidence only', () => {
    // The entire premise of §1A is replacing a settlement-lag guess with settled fact. Matching a
    // pending row would reintroduce exactly the double-count SETTLEMENT_LAG_DAYS exists to avoid.
    const m = matchOccurrence(rule(), '2026-08', [txn({ pending: true })]);
    expect(m).toBeNull();
  });

  it('ignores a transaction outside the date window', () => {
    const m = matchOccurrence(rule(), '2026-08', [txn({ date: '2026-08-15' }), ].map(t => ({
      ...t, date: '2026-08-26',
    })));
    expect(m).toBeNull();
  });

  it('matches an outflow to an expense rule but never an inflow', () => {
    // A -$1,000 "INTERNET PAYMENT - THANK YOU" card payment must not satisfy a $1,000 expense rule.
    const m = matchOccurrence(rule({ amount: 1000 }), '2026-08', [txn({ amount: -1000 })]);
    expect(m).toBeNull();
  });

  it('matches an inflow to an income rule but never an outflow', () => {
    const m = matchOccurrence(rule({ rule_type: 'income', amount: 1000 }), '2026-08', [
      txn({ amount: 1000 }),
    ]);
    expect(m).toBeNull();
  });

  it('refuses weekly rules — due_day there is a day of WEEK', () => {
    // scheduling.ts:215 reads due_day as a weekday for these frequencies. Aiming a ±day window at
    // "the 5th" for a rule that means "every Friday" would be quietly wrong rather than empty.
    const m = matchOccurrence(rule({ frequency: 'weekly', due_day: 5 }), '2026-08', [
      txn({ date: '2026-08-05' }),
    ]);
    expect(m).toBeNull();
  });

  it('refuses biweekly rules for the same reason', () => {
    const m = matchOccurrence(rule({ frequency: 'biweekly', due_day: 5 }), '2026-08', [
      txn({ date: '2026-08-05' }),
    ]);
    expect(m).toBeNull();
  });

  it('refuses semi_monthly rules — one due_day cannot represent two occurrences', () => {
    const m = matchOccurrence(rule({ frequency: 'semi_monthly' }), '2026-08', [txn()]);
    expect(m).toBeNull();
  });

  it('returns null for a yearly rule outside its due_month', () => {
    const m = matchOccurrence(
      rule({ frequency: 'yearly', due_month: 3 }),
      '2026-08',
      [txn()],
    );
    expect(m).toBeNull();
  });

  it('returns null for an inactive rule', () => {
    const m = matchOccurrence(rule({ active: false }), '2026-08', [txn()]);
    expect(m).toBeNull();
  });

  it('returns null on an empty transaction list', () => {
    expect(matchOccurrence(rule(), '2026-08', [])).toBeNull();
  });
});

describe('matchOccurrence — date arithmetic', () => {
  it('clamps a due day past the end of a short month', () => {
    // due_day 31 in September would render as the string "2026-09-31", which is not a date. The
    // window has to be built around Sep 30 or the whole month silently matches nothing.
    const m = matchOccurrence(rule({ due_day: 31 }), '2026-09', [txn({ date: '2026-09-30' })]);
    expect(m?.confidence).toBe('exact');
  });

  it('looks across the month boundary — a bill due the 1st can post in the prior month', () => {
    const m = matchOccurrence(rule({ due_day: 1 }), '2026-08', [txn({ date: '2026-07-30' })]);
    expect(m).not.toBeNull();
  });

  it('accepts a transaction exactly on the window edge and rejects one past it', () => {
    const onEdge = matchOccurrence(rule(), '2026-08', [txn({ date: '2026-08-20' })]);
    expect(onEdge).not.toBeNull();
    const pastEdge = matchOccurrence(rule(), '2026-08', [txn({ date: '2026-08-21' })]);
    expect(pastEdge).toBeNull();
    expect(DATE_WINDOW_DAYS).toBe(5);
  });
});

describe('matchOccurrence — input shapes', () => {
  it('accepts numeric columns arriving as strings from postgres', () => {
    // supabase-js hands `numeric` back as a string. Both rule.amount and txn.amount come from
    // numeric columns, so a Number() slip here would make every comparison NaN and silently
    // return null forever — a failure that looks exactly like "no matches yet".
    const m = matchOccurrence(
      rule({ amount: '120' as unknown as number }),
      '2026-08',
      [txn({ amount: '120' as unknown as number })],
    );
    expect(m?.confidence).toBe('exact');
  });

  it('does not mutate the transactions it is given', () => {
    const txns = [txn({ id: 'a', date: '2026-08-14' }), txn({ id: 'b', amount: 999 })];
    const snapshot = JSON.parse(JSON.stringify(txns));
    matchOccurrence(rule(), '2026-08', txns);
    expect(txns).toEqual(snapshot);
  });
});

// §1A Stage C — the evidence a month-0 capture gate consults.
//
// Stage B answered "did this rule's occurrence happen?". Stage C additionally needs "do we even
// KNOW?", because `isCapturedInBalance` only dares conclude anything from an ABSENT match when
// the window it would have matched in has actually been observed. Coverage is the whole safety
// story of Stage C: get it wrong in the optimistic direction and an un-backfilled account starts
// asserting that real bills never happened.
describe('hasCoverage', () => {
  const spread = [
    txn({ id: 'lo', date: '2026-07-01', amount: 5 }),
    txn({ id: 'hi', date: '2026-08-31', amount: 7 }),
  ];

  it('claims coverage only when settled rows span the whole match window', () => {
    expect(hasCoverage(ACCT, '2026-08-15', spread)).toBe(true);
  });

  it('refuses coverage past the newest synced transaction', () => {
    // The live case: Discover's data ends 2026-08-05 while the matching rule is due the 17th.
    // Nothing has been observed there yet, so the date heuristic must keep the gate.
    const upToAug5 = [txn({ id: 'lo', date: '2026-06-01' }), txn({ id: 'hi', date: '2026-08-05' })];
    expect(hasCoverage(ACCT, '2026-08-17', upToAug5)).toBe(false);
    // The boundary: a due date whose window ends exactly on the newest row IS covered; one day
    // later is not. Coverage needs the WHOLE window observed, not just the due date itself.
    expect(hasCoverage(ACCT, '2026-07-31', upToAug5)).toBe(true);
    expect(hasCoverage(ACCT, '2026-08-01', upToAug5)).toBe(false);
  });

  it('refuses coverage before the oldest synced transaction', () => {
    // A connection that has only backfilled recent history knows nothing about older months.
    expect(hasCoverage(ACCT, '2026-06-15', spread)).toBe(false);
  });

  it('refuses coverage for an account with no settled rows at all', () => {
    // Manual accounts and brand-new connections. This is the branch that keeps the heuristic.
    expect(hasCoverage(OTHER_ACCT, '2026-08-15', spread)).toBe(false);
    expect(hasCoverage(ACCT, '2026-08-15', [])).toBe(false);
    expect(hasCoverage(null, '2026-08-15', spread)).toBe(false);
  });

  it('ignores pending rows when measuring coverage', () => {
    // A pending row is not settled evidence, so it must not extend the observed range and let an
    // unmatched charge be declared "definitely has not hit".
    const pendingEdge = [...spread, txn({ id: 'p', date: '2026-09-30', pending: true })];
    expect(hasCoverage(ACCT, '2026-09-10', pendingEdge)).toBe(false);
  });
});

describe('buildCaptureEvidence', () => {
  const charge = { accountId: ACCT, amount: 120, dueDate: '2026-08-15' };
  const covering = [
    txn({ id: 'lo', date: '2026-07-01', amount: 5 }),
    txn({ id: 'hi', date: '2026-08-31', amount: 7 }),
  ];

  it('reports a match when a settled transaction corresponds to the charge', () => {
    expect(buildCaptureEvidence(charge, [...covering, txn({ id: 'm', date: '2026-08-14' })]))
      .toEqual({ hasTxnCoverage: true, matched: true });
  });

  it('reports covered-and-unmatched, the branch that changes a projected number', () => {
    expect(buildCaptureEvidence(charge, covering)).toEqual({ hasTxnCoverage: true, matched: false });
  });

  it('reports no coverage rather than a bare "unmatched" when nothing was observed', () => {
    // Same absent match as above, but it means nothing here — and isCapturedInBalance must be able
    // to tell those two apart, which is the entire reason evidence carries two booleans.
    expect(buildCaptureEvidence(charge, [])).toEqual({ hasTxnCoverage: false, matched: false });
  });

  it('inherits the matcher ambiguity refusal', () => {
    // Two equally good candidates is a coin flip. Unmatched-but-covered would then CHARGE the
    // bill again, which reads cash low — the safe way for a coin flip to fail.
    const twins = [
      ...covering,
      txn({ id: 'a', date: '2026-08-14' }),
      txn({ id: 'b', date: '2026-08-16' }),
    ];
    expect(buildCaptureEvidence(charge, twins)).toEqual({ hasTxnCoverage: true, matched: false });
  });

  it('matches an inflow only against an inflow', () => {
    // Direction is a hard gate: a -$1,463 deposit must never satisfy a $1,463 outflow charge.
    const deposit = txn({ id: 'd', date: '2026-08-15', amount: -1463 });
    const window = [txn({ id: 'lo', date: '2026-07-01', amount: 5 }), txn({ id: 'hi', date: '2026-08-31', amount: 7 })];
    const c = { accountId: ACCT, amount: 1463, dueDate: '2026-08-15' };
    expect(buildCaptureEvidence(c, [...window, deposit]).matched).toBe(false);
    expect(buildCaptureEvidence({ ...c, isInflow: true }, [...window, deposit]).matched).toBe(true);
  });

  it('refuses everything for a charge with no account attribution', () => {
    // An unattributed charge cannot be matched or covered — it falls to the heuristic.
    expect(buildCaptureEvidence({ ...charge, accountId: null }, covering))
      .toEqual({ hasTxnCoverage: false, matched: false });
  });
});
