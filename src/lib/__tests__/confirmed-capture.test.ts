// §1B Stage 4 part A — a confirmed rule link suppresses that bill's month-0 occurrence.
//
// These tests pin the DECISIONS, not just the behaviour: which statuses count as a confirmation,
// that a degraded (rule deleted) review is skipped rather than throwing, and that the suppression
// can never reach a real ledger row or a different month.

import { describe, it, expect } from 'vitest';
import {
  buildConfirmedOccurrences,
  isOccurrenceConfirmed,
  isRuleOccurrenceConfirmed,
  type RuleOccurrenceReview,
} from '../confirmed-capture';

const RULE = 'e6a1f2c3-1111-4aaa-9bbb-000000000001';
const OTHER_RULE = 'e6a1f2c3-2222-4aaa-9bbb-000000000002';

const review = (over: Partial<RuleOccurrenceReview> = {}): RuleOccurrenceReview => ({
  status: 'linked_rule',
  rule_id: RULE,
  occurrence_month: '2026-08',
  ...over,
});

const genTxn = (ruleId: string, date: string) => ({
  id: `gen:${ruleId}:${date}`,
  date,
  isGenerated: true,
});

describe('buildConfirmedOccurrences — only an explicit rule link confirms', () => {
  it('collects a linked_rule review', () => {
    expect(buildConfirmedOccurrences([review()]).size).toBe(1);
  });

  it.each(['linked_txn', 'imported', 'ignored', 'categorized'])(
    'ignores %s — none of them asserts the projected bill was paid',
    (status) => {
      expect(buildConfirmedOccurrences([review({ status })]).size).toBe(0);
    },
  );

  it('skips a linked_rule whose rule was deleted (FK ON DELETE SET NULL), rather than throwing', () => {
    // The documented degraded state: still "handled", but no rule left to suppress an occurrence of.
    expect(buildConfirmedOccurrences([review({ rule_id: null })]).size).toBe(0);
  });

  it('skips a linked_rule with no occurrence_month — an unscoped confirmation is not a confirmation', () => {
    expect(buildConfirmedOccurrences([review({ occurrence_month: null })]).size).toBe(0);
  });

  it('treats null/undefined review lists as "nothing confirmed"', () => {
    expect(buildConfirmedOccurrences(null).size).toBe(0);
    expect(buildConfirmedOccurrences(undefined).size).toBe(0);
  });
});

describe('isOccurrenceConfirmed — scoped to one rule in one month', () => {
  const confirmed = buildConfirmedOccurrences([review()]);

  it('suppresses the confirmed rule occurrence in the confirmed month', () => {
    expect(isOccurrenceConfirmed(genTxn(RULE, '2026-08-25'), confirmed)).toBe(true);
  });

  it('leaves the SAME rule in a different month alone', () => {
    // The whole point of occurrence_month: confirming August must not silently pay September.
    expect(isOccurrenceConfirmed(genTxn(RULE, '2026-09-25'), confirmed)).toBe(false);
  });

  it('leaves a different rule in the confirmed month alone', () => {
    expect(isOccurrenceConfirmed(genTxn(OTHER_RULE, '2026-08-25'), confirmed)).toBe(false);
  });

  it('never suppresses a real ledger row — that is money the user actually recorded', () => {
    const real = { id: 'a-real-uuid', date: '2026-08-25', isGenerated: false };
    expect(isOccurrenceConfirmed(real, confirmed)).toBe(false);
  });

  it('ignores a generated row that is not a rule expansion (debt/plan generators)', () => {
    expect(isOccurrenceConfirmed({ id: 'debt:card1:2026-08-25', date: '2026-08-25', isGenerated: true }, confirmed))
      .toBe(false);
  });

  it('is inert when nothing is confirmed — the pre-Stage-4 path, byte for byte', () => {
    const none = buildConfirmedOccurrences([]);
    expect(isOccurrenceConfirmed(genTxn(RULE, '2026-08-25'), none)).toBe(false);
  });

  it('tolerates malformed rows without throwing', () => {
    expect(isOccurrenceConfirmed({ id: null, date: null, isGenerated: true }, confirmed)).toBe(false);
    expect(isOccurrenceConfirmed({ id: 'gen:only-two-parts', date: '2026-08-25', isGenerated: true }, confirmed))
      .toBe(false);
  });
});

// The rule-id form, for consumers that already know which rule produced a charge — the forecast's
// scheduledEvents carry `ruleId` and a date directly and never take the `gen:` id shape.
describe('isRuleOccurrenceConfirmed', () => {
  const confirmed = buildConfirmedOccurrences([review()]);

  it('matches on rule + month, reading only the month part of a full date', () => {
    expect(isRuleOccurrenceConfirmed(RULE, '2026-08-25', confirmed)).toBe(true);
    expect(isRuleOccurrenceConfirmed(RULE, '2026-08', confirmed)).toBe(true);
  });

  it('does not confirm another rule, or the same rule in another month', () => {
    expect(isRuleOccurrenceConfirmed(OTHER_RULE, '2026-08-25', confirmed)).toBe(false);
    expect(isRuleOccurrenceConfirmed(RULE, '2026-09-25', confirmed)).toBe(false);
  });

  it('is inert on a null rule id, a null date, or an empty set', () => {
    expect(isRuleOccurrenceConfirmed(null, '2026-08-25', confirmed)).toBe(false);
    expect(isRuleOccurrenceConfirmed(RULE, null, confirmed)).toBe(false);
    expect(isRuleOccurrenceConfirmed(RULE, '2026-08-25', buildConfirmedOccurrences([]))).toBe(false);
  });
});
