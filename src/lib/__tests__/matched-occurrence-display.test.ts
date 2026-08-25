// The render half of §1B: a real payment shown in place of the projection it answered.
//
// Tre, 2026-08-24: "if a transaction matches a budget rule, the real transaction date and costs
// should auto override the transaction for that month. the real one should actually show." The lib
// slice found the charge and kept it; this file pins what the surfaces are allowed to do with it.
//
// The assertions that matter are the REFUSALS. A substitution that fires when it should not moves a
// number the user is looking at, and every one of those cases (a suppress-only entry, a direction
// that contradicts the occurrence, a charge in the neighbouring month) looks like a successful
// match from one line away.

import { describe, it, expect } from 'vitest';
import type { MatchedOccurrence, MatchedOccurrenceIndex } from '../auto-matched-occurrences';
import type { EnrichedTransaction } from '../pay-schedule';
import type { ScheduledEvent } from '../scheduling';
import {
  lookupMatchedOccurrence,
  matchedMonthAmountDelta,
  matchedRuleIdsInMonth,
  realDisplayAmount,
  substituteMatchedLedgerRows,
  substituteSettledOccurrences,
} from '../matched-occurrence-display';

const valued = (over: Partial<MatchedOccurrence> & { ruleId: string; occurrenceDate: string }): MatchedOccurrence => ({
  suppressOnly: false,
  transactionId: 'txn-1',
  actualDate: over.occurrenceDate,
  actualAmount: 100,
  merchantName: 'ACME',
  confidence: 'strong',
  source: 'auto',
  ...over,
} as MatchedOccurrence);

const suppressOnly = (ruleId: string, occurrenceDate: string): MatchedOccurrence => ({
  suppressOnly: true, ruleId, occurrenceDate, source: 'confirmed', reason: 'legacy_month_key',
});

const indexOf = (...entries: MatchedOccurrence[]): MatchedOccurrenceIndex =>
  new Map(entries.map(e => [`${e.ruleId}|${e.occurrenceDate}`, e]));

const event = (over: Partial<ScheduledEvent> = {}): ScheduledEvent => ({
  date: '2026-08-28', name: 'Rent', amount: 1600, type: 'expense', ruleId: 'rule-rent', ...over,
});

const generated = (over: Partial<EnrichedTransaction> = {}): EnrichedTransaction => ({
  id: 'gen:rule-rent:2026-08-28', date: '2026-08-28', type: 'expense', amount: 1600,
  category: 'Bills', note: 'Rent', isGenerated: true, ruleId: 'rule-rent', ...over,
});

describe('lookupMatchedOccurrence', () => {
  it('finds the exact occurrence key', () => {
    const index = indexOf(valued({ ruleId: 'r1', occurrenceDate: '2026-08-28' }));
    expect(lookupMatchedOccurrence(index, 'r1', '2026-08-28')?.occurrenceDate).toBe('2026-08-28');
  });

  it('falls back to a legacy month key, as isRuleOccurrenceConfirmed does', () => {
    const index = indexOf(suppressOnly('r1', '2026-08'));
    expect(lookupMatchedOccurrence(index, 'r1', '2026-08-28')?.suppressOnly).toBe(true);
  });

  it('is undefined for another rule, another date, or an empty index', () => {
    const index = indexOf(valued({ ruleId: 'r1', occurrenceDate: '2026-08-28' }));
    expect(lookupMatchedOccurrence(index, 'r2', '2026-08-28')).toBeUndefined();
    expect(lookupMatchedOccurrence(index, 'r1', '2026-09-28')).toBeUndefined();
    expect(lookupMatchedOccurrence(new Map(), 'r1', '2026-08-28')).toBeUndefined();
  });
});

describe('realDisplayAmount — the one place the sign convention is converted', () => {
  it('reads an outflow-positive charge as an expense magnitude', () => {
    expect(realDisplayAmount('expense', 1608.42)).toBe(1608.42);
  });

  it('reads an inflow-negative deposit as an income magnitude', () => {
    expect(realDisplayAmount('income', -2100)).toBe(2100);
  });

  it('REFUSES a charge whose direction contradicts the occurrence', () => {
    // A refund is not evidence a bill was paid, and flipping it would render rent as income.
    expect(realDisplayAmount('expense', -1608.42)).toBeNull();
    expect(realDisplayAmount('income', 2100)).toBeNull();
  });

  it('refuses zero and non-finite amounts rather than rendering them', () => {
    expect(realDisplayAmount('expense', 0)).toBeNull();
    expect(realDisplayAmount('expense', Number.NaN)).toBeNull();
  });
});

describe('substituteSettledOccurrences — Dashboard Upcoming This Week', () => {
  it('gives a matched occurrence the real date and the real amount', () => {
    const index = indexOf(valued({
      ruleId: 'rule-rent', occurrenceDate: '2026-08-28', actualDate: '2026-08-26', actualAmount: 1608.42,
    }));
    const [row] = substituteSettledOccurrences([event()], index);
    expect(row.date).toBe('2026-08-26');
    expect(row.amount).toBe(1608.42);
    expect(row.settledDate).toBe('2026-08-26');
    expect(row.projectedAmount).toBe(1600);
  });

  it('DROPS an occurrence known to be handled but carrying no figures', () => {
    // A legacy month-keyed confirmation. Listing it as still upcoming would be false, and drawing a
    // date and an amount on it would be invented.
    const out = substituteSettledOccurrences([event()], indexOf(suppressOnly('rule-rent', '2026-08')));
    expect(out).toEqual([]);
  });

  it('DROPS rather than flips an occurrence whose real charge runs the wrong way', () => {
    const index = indexOf(valued({
      ruleId: 'rule-rent', occurrenceDate: '2026-08-28', actualDate: '2026-08-26', actualAmount: -1608.42,
    }));
    expect(substituteSettledOccurrences([event()], index)).toEqual([]);
  });

  it('leaves an unmatched occurrence untouched, by identity', () => {
    const e = event();
    const index = indexOf(valued({ ruleId: 'other-rule', occurrenceDate: '2026-08-28' }));
    expect(substituteSettledOccurrences([e], index)[0]).toBe(e);
  });

  it('leaves obligations that are not rule occurrences alone', () => {
    // Card payments, vehicle obligations and plan installments carry no ruleId and this index does
    // not key them; a substitution reaching one would be a coincidence of dates.
    const card = event({ name: 'Discover payment', ruleId: undefined });
    const index = indexOf(valued({ ruleId: 'rule-rent', occurrenceDate: '2026-08-28' }));
    expect(substituteSettledOccurrences([card], index)[0]).toBe(card);
  });
});

describe('substituteMatchedLedgerRows — the Transactions ledger', () => {
  it('puts the real date and the real amount on the generated occurrence', () => {
    const index = indexOf(valued({
      ruleId: 'rule-rent', occurrenceDate: '2026-08-28', actualDate: '2026-08-26', actualAmount: 1608.42,
    }));
    const [row] = substituteMatchedLedgerRows([generated()], index);
    expect(row.date).toBe('2026-08-26');
    expect(row.amount).toBe(1608.42);
    expect(row.matchedActualDate).toBe('2026-08-26');
    expect(row.matchedProjectedAmount).toBe(1600);
    // Still the rule's row: the note, the category and the generated flag all survive.
    expect(row.note).toBe('Rent');
    expect(row.isGenerated).toBe(true);
  });

  it('keeps the row in the OBLIGATION’s month when the charge settled in the next one', () => {
    // The matcher reaches five days either side, so an occurrence near a boundary can be answered
    // by a charge in the neighbouring month. Moving the row there would take the bill out of the
    // month the user is looking at and stand it beside that month's own projection.
    const index = indexOf(valued({
      ruleId: 'rule-rent', occurrenceDate: '2026-08-31', actualDate: '2026-09-02', actualAmount: 1608.42,
    }));
    const [row] = substituteMatchedLedgerRows(
      [generated({ id: 'gen:rule-rent:2026-08-31', date: '2026-08-31' })],
      index,
    );
    expect(row.date).toBe('2026-08-31');
    // The real date is still what the surface renders.
    expect(row.matchedActualDate).toBe('2026-09-02');
    expect(row.amount).toBe(1608.42);
  });

  it('leaves a suppress-only occurrence exactly as it was, rather than deleting the row', () => {
    const [row] = substituteMatchedLedgerRows([generated()], indexOf(suppressOnly('rule-rent', '2026-08')));
    expect(row.date).toBe('2026-08-28');
    expect(row.amount).toBe(1600);
    expect(row.matchedActualDate).toBeUndefined();
  });

  it('never touches a real ledger row, only generated occurrences', () => {
    const real: EnrichedTransaction = {
      id: 'txn-real', date: '2026-08-28', type: 'expense', amount: 1600, category: 'Bills', note: 'Rent',
    };
    const index = indexOf(valued({
      ruleId: 'rule-rent', occurrenceDate: '2026-08-28', actualDate: '2026-08-26', actualAmount: 1608.42,
    }));
    expect(substituteMatchedLedgerRows([real], index)[0]).toBe(real);
  });
});

describe('matchedMonthAmountDelta — Budget Control monthly totals', () => {
  const rule = {
    id: 'rule-rent', amount: 1600, rule_type: 'expense', frequency: 'monthly', due_day: 28,
  };

  it('is zero when nothing matched, so an unconnected user sees the same figures', () => {
    expect(matchedMonthAmountDelta(rule, 2026, 7, new Map())).toBe(0);
    expect(matchedMonthAmountDelta(rule, 2026, 7, indexOf(valued({ ruleId: 'other', occurrenceDate: '2026-08-28' })))).toBe(0);
  });

  it('reports what the real charge added over the rule amount', () => {
    const index = indexOf(valued({
      ruleId: 'rule-rent', occurrenceDate: '2026-08-28', actualDate: '2026-08-26', actualAmount: 1608.42,
    }));
    expect(matchedMonthAmountDelta(rule, 2026, 7, index)).toBeCloseTo(8.42, 5);
  });

  it('reports a NEGATIVE delta when the real charge came in under the rule', () => {
    const index = indexOf(valued({
      ruleId: 'rule-rent', occurrenceDate: '2026-08-28', actualDate: '2026-08-28', actualAmount: 1590,
    }));
    expect(matchedMonthAmountDelta(rule, 2026, 7, index)).toBeCloseTo(-10, 5);
  });

  it('sums one delta per matched occurrence of a weekly rule and ignores the rest', () => {
    // August 2026 has five Fridays: 7, 14, 21, 28. (The 31st is a Monday.) Two matched, two not.
    const weekly = { id: 'rule-fuel', amount: 60, rule_type: 'expense', frequency: 'weekly', due_day: 5 };
    const index = indexOf(
      valued({ ruleId: 'rule-fuel', occurrenceDate: '2026-08-07', actualDate: '2026-08-07', actualAmount: 72 }),
      valued({ ruleId: 'rule-fuel', occurrenceDate: '2026-08-21', actualDate: '2026-08-21', actualAmount: 55 }),
    );
    expect(matchedMonthAmountDelta(weekly, 2026, 7, index)).toBeCloseTo(12 - 5, 5);
  });

  it('contributes nothing for a suppress-only entry, which has no amount to contribute', () => {
    expect(matchedMonthAmountDelta(rule, 2026, 7, indexOf(suppressOnly('rule-rent', '2026-08')))).toBe(0);
  });

  it('contributes nothing when the real charge contradicts the rule’s direction', () => {
    const income = { id: 'rule-pay', amount: 2100, rule_type: 'income', frequency: 'monthly', due_day: 15 };
    const index = indexOf(valued({
      ruleId: 'rule-pay', occurrenceDate: '2026-08-15', actualDate: '2026-08-15', actualAmount: 2100,
    }));
    // Outflow-positive 2100 against an INCOME rule is a debit, not a deposit.
    expect(matchedMonthAmountDelta(income, 2026, 7, index)).toBe(0);
  });
});

describe('matchedRuleIdsInMonth — the auto-matched badge', () => {
  it('names every rule with a matched occurrence in the month, whatever its frequency', () => {
    const index = indexOf(
      valued({ ruleId: 'rule-rent', occurrenceDate: '2026-08-28' }),
      valued({ ruleId: 'rule-fuel', occurrenceDate: '2026-08-07' }),
    );
    expect(matchedRuleIdsInMonth(index, '2026-08')).toEqual(new Set(['rule-rent', 'rule-fuel']));
  });

  it('leaves out an occurrence from another month, so one confirmation does not badge forever', () => {
    const index = indexOf(valued({ ruleId: 'rule-rent', occurrenceDate: '2026-06-28', source: 'confirmed' }));
    expect(matchedRuleIdsInMonth(index, '2026-08')).toEqual(new Set());
  });

  it('counts a legacy month-keyed confirmation in its own month and no other', () => {
    const index = indexOf(suppressOnly('rule-rent', '2026-08'));
    expect(matchedRuleIdsInMonth(index, '2026-08')).toEqual(new Set(['rule-rent']));
    expect(matchedRuleIdsInMonth(index, '2026-09')).toEqual(new Set());
  });
});
