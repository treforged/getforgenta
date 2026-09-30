import { describe, expect, test } from 'vitest';
import {
  buildVariableBillBuffers,
  applyFloorBuffers,
  type HistoryRule,
  type HistoryReview,
  type HistoryCharge,
} from '../variable-bill-history';

/* ---------- tiny factories ---------- */
const rule = (
  id: string,
  amount: number,
  frequency = 'monthly',
  extra: Partial<HistoryRule> = {}
): HistoryRule => ({
  id,
  amount,
  rule_type: 'expense',
  frequency,
  active: true,
  cost_type: null,
  ...extra,
});

const charge = (id: string, amount: number, date: string): HistoryCharge => ({
  id,
  amount,
  date,
});

const link = (
  ruleId: string,
  chargeId: string,
  month: string | null,
  date: string | null = null,
  status = 'linked_rule'
): HistoryReview => ({
  status,
  rule_id: ruleId,
  synced_transaction_id: chargeId,
  occurrence_month: month,
  occurrence_date: date,
});

/* ---------- shared electric data (a & b) ---------- */
const electricRule = rule('e1', 120);
const electricCharges = [
  charge('c1', 99.69, '2026-04-04'),
  charge('c2', 169.52, '2026-07-15'),
  charge('c3', 197.93, '2026-08-20'),
  charge('c4', 190.13, '2026-09-10'),
];
const electricLinks = [
  link('e1', 'c1', '2026-04'),
  link('e1', 'c2', '2026-07'),
  link('e1', 'c3', '2026-08'),
  link('e1', 'c4', '2026-09'),
];

/* ---------- tests ---------- */
describe('variable-bill-history', () => {
  test('a) discriminating case (monthly)', () => {
    const buf = buildVariableBillBuffers([electricRule], electricLinks, electricCharges);
    const entry = buf.byRuleId.get('e1')!;
    expect(entry.sampleCount).toBe(4);
    expect(entry.p90).toBe(195.59);
    expect(entry.buffer).toBe(75.59);
    expect(entry.reason).toBe('from-history');
  });

  test('b) same history, higher planned amount', () => {
    const rule185 = { ...electricRule, amount: 185.86 };
    const buf = buildVariableBillBuffers([rule185], electricLinks, electricCharges);
    const entry = buf.byRuleId.get('e1')!;
    expect(entry.buffer).toBe(9.73);
  });

  test('c) multiple charges in one month are summed', () => {
    const r = rule('rC', 100);
    const ch = [
      charge('c5', 50, '2026-01-05'),
      charge('c6', 60, '2026-01-20'),
      charge('c7', 70, '2026-02-10'),
    ];
    const rev = [
      link('rC', 'c5', '2026-01'),
      link('rC', 'c6', '2026-01'),
      link('rC', 'c7', '2026-02'),
    ];
    const buf = buildVariableBillBuffers([r], rev, ch);
    const e = buf.byRuleId.get('rC')!;
    expect(e.sampleCount).toBe(2);
    expect(e.reason).toBe('not-enough-history');
    expect(e.buffer).toBe(0);
  });

  test('d) weekly rule groups by occurrence_date', () => {
    const r = rule('rW', 80, 'weekly');
    const ch = [
      charge('c8', 30, '2026-03-01'),
      charge('c9', 40, '2026-03-08'),
    ];
    const rev = [
      link('rW', 'c8', null, '2026-03-01'),
      link('rW', 'c9', null, '2026-03-08'),
    ];
    const buf = buildVariableBillBuffers([r], rev, ch);
    const e = buf.byRuleId.get('rW')!;
    expect(e.sampleCount).toBe(2);
    expect(e.history.map(h => h.amount)).toEqual([30, 40]);
  });

  test('e) split guard drops both reviews', () => {
    const r1 = rule('s1', 50);
    const r2 = rule('s2', 60);
    const ch = [charge('c10', 55, '2026-05-01')];
    const rev = [
      link('s1', 'c10', '2026-05'),
      link('s2', 'c10', '2026-05'),
    ];
    const buf = buildVariableBillBuffers([r1, r2], rev, ch);
    expect(buf.dropped.splitCharge).toBe(2);
    expect(buf.byRuleId.size).toBe(0);
  });

  test('f) income rule is ignored', () => {
    const inc = { ...rule('inc', 200), rule_type: 'income' };
    const ch = [charge('c11', 200, '2026-06-01')];
    const rev = [link('inc', 'c11', '2026-06')];
    const buf = buildVariableBillBuffers([inc], rev, ch);
    expect(buf.dropped.notAnExpenseRule).toBe(1);
    expect(buf.byRuleId.size).toBe(0);
  });

  test('g) non-linked status is ignored', () => {
    const r = rule('rG', 70);
    const ch = [charge('c12', 70, '2026-07-01')];
    const rev = [link('rG', 'c12', '2026-07', null, 'categorized')];
    const buf = buildVariableBillBuffers([r], rev, ch);
    expect(buf.dropped).toEqual({ chargeNotFound: 0, splitCharge: 0, notAnExpenseRule: 0 });
    expect(buf.byRuleId.size).toBe(0);
  });

  test('h) missing charge counted', () => {
    const r = rule('rH', 90);
    const rev = [link('rH', 'missing', '2026-08')];
    const buf = buildVariableBillBuffers([r], rev, []);
    expect(buf.dropped.chargeNotFound).toBe(1);
  });


  test('i) a flat bill with no cost_type reads as fixed from its own spread', () => {
    const r = rule('rF', 54);
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
    const ch = months.map((m, i) => charge(`cF${i}`, 54.07, `${m}-10`));
    const rev = ch.map((c, i) => link('rF', c.id, months[i]));
    const e = buildVariableBillBuffers([r], rev, ch).byRuleId.get('rF')!;
    expect(e.sampleCount).toBe(5);
    expect(e.reason).toBe('fixed');
    expect(e.buffer).toBe(0);
  });

  test('j) applyFloorBuffers: identity with no buffer, copies only the buffered rule', () => {
    const rules = [rule('e1', 120), rule('other', 50)];
    const none = buildVariableBillBuffers(rules, [], []);
    expect(applyFloorBuffers(rules, none)).toBe(rules);

    const buffers = buildVariableBillBuffers(rules, electricLinks, electricCharges);
    const out = applyFloorBuffers(rules, buffers);
    expect(out).not.toBe(rules);
    expect((out[0] as HistoryRule & { floor_buffer?: number }).floor_buffer).toBe(75.59);
    expect(out[1]).toBe(rules[1]);
    expect('floor_buffer' in rules[0]).toBe(false);
  });

  test('k) inputs are never mutated', () => {
    const rules = [rule('e1', 120)];
    const snapshot = JSON.stringify([rules, electricLinks, electricCharges]);
    applyFloorBuffers(rules, buildVariableBillBuffers(rules, electricLinks, electricCharges));
    expect(JSON.stringify([rules, electricLinks, electricCharges])).toBe(snapshot);
  });
});
