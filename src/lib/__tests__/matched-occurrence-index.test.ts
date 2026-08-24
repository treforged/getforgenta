// The value-bearing view of the match. Tre, 2026-08-24: "if a transaction matches a budget rule,
// the real transaction date and costs should auto override the transaction for that month. the real
// one should actually show."
//
// `buildAutoMatchedOccurrences` answers "is this occurrence handled" and throws the charge away, so
// every consumer could only ever DELETE the projected row — nothing was left to render in its place.
// `buildMatchedOccurrenceIndex` keeps the charge. It is the SAME computation, and the first test
// below is the one that keeps it that way: the Set is the Map's keys, so the two views cannot drift
// into disagreeing about which bills are paid.
//
// The other half of this file is about NOT INVENTING VALUES. A confirmed link whose transaction is
// not in hand, and a legacy month-keyed review that names no single occurrence, both yield an
// explicit suppress-only entry. A fabricated date or amount in a financial app is worse than a gap.

import { describe, it, expect } from 'vitest';
import {
  buildAutoMatchedOccurrences, buildMatchedOccurrenceIndex,
  type AutoMatchableRule, type ValuedMatchedOccurrence,
} from '../auto-matched-occurrences';
import { buildConfirmedOccurrences, type RuleOccurrenceReview } from '../confirmed-capture';
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
  id: 't-1', account_id: ACCT, amount: 1_200, date: '2026-08-05', pending: false,
  merchant_name: 'Greystar', name: 'GREYSTAR PROPERTY MGMT', ...over,
});

const review = (over: Partial<RuleOccurrenceReview> = {}): RuleOccurrenceReview => ({
  status: 'linked_rule', rule_id: 'r-1', occurrence_month: '2026-08',
  occurrence_date: '2026-08-25', synced_transaction_id: 't-1', ...over,
});

/** Narrow to the valued shape, failing loudly rather than reading fields off a suppression. */
const valued = (entry: unknown): ValuedMatchedOccurrence => {
  const e = entry as ValuedMatchedOccurrence | undefined;
  expect(e).toBeDefined();
  expect(e?.suppressOnly).toBe(false);
  return e as ValuedMatchedOccurrence;
};

describe('buildMatchedOccurrenceIndex — one computation, two views', () => {
  it('has exactly the keys `buildAutoMatchedOccurrences` returns', () => {
    const p = { rules: [rule()], transactions: [txn()], month: AUG };
    const index = buildMatchedOccurrenceIndex(p);
    const set = buildAutoMatchedOccurrences(p);

    expect([...index.keys()].sort()).toEqual([...set].sort());
    expect([...index.keys()]).toEqual(['r-1|2026-08-25']);
  });

  it('agrees with the Set across every refusal the matcher makes', () => {
    const cases: MatchableTransaction[] = [
      txn({ pending: true }),
      txn({ account_id: 'other' }),
      txn({ amount: -1_200 }),
      txn({ amount: 1_400 }),
      txn({ date: '2026-07-01' }),
    ];
    for (const t of cases) {
      const p = { rules: [rule()], transactions: [t], month: AUG };
      expect([...buildMatchedOccurrenceIndex(p).keys()]).toEqual([...buildAutoMatchedOccurrences(p)]);
      expect(buildMatchedOccurrenceIndex(p).size).toBe(0);
    }
  });

  it('keeps income rules out, as the Set does — a variable paycheck would miss the tolerance', () => {
    const income = rule({ id: 'inc', rule_type: 'income', payment_source: null, deposit_account: ACCT });
    const p = { rules: [income], transactions: [txn({ amount: -1_200 })], month: AUG };
    expect(buildMatchedOccurrenceIndex(p).size).toBe(0);
  });

  it('covers a frequency `matchOccurrence` alone cannot locate — a weekly rule', () => {
    const weekly = rule({ id: 'w-1', amount: 60, frequency: 'weekly', due_day: 5 });
    const p = { rules: [weekly], transactions: [txn({ id: 'f-1', amount: 60, date: '2026-08-14' })], month: AUG };
    const index = buildMatchedOccurrenceIndex(p);

    expect([...index.keys()]).toEqual([...buildAutoMatchedOccurrences(p)]);
    expect(index.size).toBe(1);
    expect(valued([...index.values()][0]).occurrenceDate).toBe('2026-08-14');
  });
});

describe('buildMatchedOccurrenceIndex — the values it carries', () => {
  it('carries the REAL date, the REAL amount, the merchant and the transaction id', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [txn({ id: 't-99', date: '2026-08-05', amount: 1_208 })], month: AUG,
    });
    const entry = valued(index.get('r-1|2026-08-25'));

    expect(entry.occurrenceDate).toBe('2026-08-25'); // what was PROJECTED
    expect(entry.actualDate).toBe('2026-08-05');     // what actually HAPPENED
    expect(entry.actualAmount).toBe(1_208);
    expect(entry.transactionId).toBe('t-99');
    expect(entry.merchantName).toBe('Greystar');
    expect(entry.confidence).toBe('strong');
    expect(entry.source).toBe('auto');
  });

  it('SIGN CONVENTION: an outflow stays POSITIVE, exactly as `synced_transactions` stores it', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [txn({ amount: 1_200 })], month: AUG,
    });
    // Not re-signed to match `EnrichedTransaction`, where direction lives in `type`. A consumer
    // putting the two side by side has to convert on purpose; a silent flip renders rent as income.
    expect(valued(index.get('r-1|2026-08-25')).actualAmount).toBe(1_200);
  });

  it('falls back to the raw descriptor, and to null rather than a blank label', () => {
    const noMerchant = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [txn({ merchant_name: '  ' })], month: AUG,
    });
    expect(valued(noMerchant.get('r-1|2026-08-25')).merchantName).toBe('GREYSTAR PROPERTY MGMT');

    const nameless = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [txn({ merchant_name: null, name: '' })], month: AUG,
    });
    expect(valued(nameless.get('r-1|2026-08-25')).merchantName).toBeNull();
  });

  it('reports `exact` only when the amounts agree to the penny', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [txn({ amount: 1_200 })], month: AUG,
    });
    expect(valued(index.get('r-1|2026-08-25')).confidence).toBe('exact');
  });
});

describe('buildMatchedOccurrenceIndex — confirmed links', () => {
  // The transaction is on ANOTHER account, so the matcher refuses it and only the human assertion
  // can produce an entry. That isolates the confirmed path from the auto one.
  const linked = txn({ id: 't-manual', account_id: 'savings-9', date: '2026-08-22', amount: 1_195 });

  it('resolves the value side through `synced_transaction_id`', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [linked], month: AUG,
      reviews: [review({ synced_transaction_id: 't-manual' })],
    });
    const entry = valued(index.get('r-1|2026-08-25'));

    expect(entry.actualDate).toBe('2026-08-22');
    expect(entry.actualAmount).toBe(1_195);
    expect(entry.transactionId).toBe('t-manual');
    expect(entry.source).toBe('confirmed');
    // $5 off a $1,200 rule is inside the 1% ($12) band, so the agreement is real and reported.
    expect(entry.confidence).toBe('strong');
  });

  it('rates NOTHING when a confirmed link\'s amounts do not agree — the link still stands', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [{ ...linked, amount: 900 }], month: AUG,
      reviews: [review({ synced_transaction_id: 't-manual' })],
    });
    const entry = valued(index.get('r-1|2026-08-25'));

    // $900 against a $1,200 rule is far outside even the strong band. The user asserted the link and
    // this module does not overrule them, but it will not report an agreement that is not there.
    expect(entry.confidence).toBeNull();
    expect(entry.actualAmount).toBe(900);
  });

  it('rates nothing when the rule behind a confirmed link was not handed in', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [], transactions: [linked], month: AUG,
      reviews: [review({ synced_transaction_id: 't-manual' })],
    });
    expect(valued(index.get('r-1|2026-08-25')).confidence).toBeNull();
  });

  it('keys confirmed entries into exactly the space `buildConfirmedOccurrences` uses', () => {
    const reviews = [review(), review({ rule_id: 'r-9', occurrence_date: null })];
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [linked], month: AUG, reviews,
    });
    for (const key of buildConfirmedOccurrences(reviews)) expect(index.has(key)).toBe(true);
  });

  it('SUPPRESS-ONLY when the linked transaction is not in the pool — never a fabricated figure', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [], month: AUG,
      reviews: [review({ synced_transaction_id: 'gone' })],
    });
    const entry = index.get('r-1|2026-08-25');

    expect(entry?.suppressOnly).toBe(true);
    expect(entry).toEqual({
      suppressOnly: true, ruleId: 'r-1', occurrenceDate: '2026-08-25',
      source: 'confirmed', reason: 'transaction_unavailable',
    });
    expect(entry).not.toHaveProperty('actualAmount');
  });

  it('SUPPRESS-ONLY for a legacy month-keyed review — it names no single occurrence', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [linked], month: AUG,
      reviews: [review({ occurrence_date: null })],
    });
    const entry = index.get('r-1|2026-08');

    expect(entry?.suppressOnly).toBe(true);
    expect(entry).toMatchObject({ reason: 'legacy_month_key', occurrenceDate: '2026-08' });
  });

  it('SUPPRESS-ONLY for a pending row — a debit that can still be reversed contributes no numbers', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [{ ...linked, pending: true }], month: AUG,
      reviews: [review({ synced_transaction_id: 't-manual' })],
    });
    expect(index.get('r-1|2026-08-25')).toMatchObject({
      suppressOnly: true, reason: 'transaction_pending',
    });
  });

  it('skips exactly what `buildConfirmedOccurrences` skips', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [linked], month: AUG,
      reviews: [
        review({ status: 'linked_txn' }),
        review({ status: 'linked_plan' }),
        review({ status: 'linked_car' }),
        review({ rule_id: null }),
        review({ occurrence_month: null }),
      ],
    });
    expect(index.size).toBe(0);
  });
});

describe('buildMatchedOccurrenceIndex — precedence when a key is produced twice', () => {
  const auto = txn({ id: 't-auto', date: '2026-08-05', amount: 1_200 });

  it('a confirmed link displaces an auto match — the human assertion is the better evidence', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [auto, txn({ id: 't-conf', account_id: 'savings-9', date: '2026-08-24', amount: 1_200 })],
      month: AUG,
      reviews: [review({ synced_transaction_id: 't-conf' })],
    });
    const entry = valued(index.get('r-1|2026-08-25'));

    expect(entry.source).toBe('confirmed');
    expect(entry.transactionId).toBe('t-conf');
    expect(entry.actualDate).toBe('2026-08-24');
  });

  it('a confirmed SUPPRESSION does not wipe out an auto match that has the figures', () => {
    const index = buildMatchedOccurrenceIndex({
      rules: [rule()], transactions: [auto], month: AUG,
      reviews: [review({ synced_transaction_id: 'gone' })],
    });
    const entry = valued(index.get('r-1|2026-08-25'));

    // Still suppressed either way — the key is present. But knowing the figures is strictly more
    // than knowing the fact, so the values survive.
    expect(entry.source).toBe('auto');
    expect(entry.actualAmount).toBe(1_200);
  });
});
