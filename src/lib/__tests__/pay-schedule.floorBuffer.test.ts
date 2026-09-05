/**
 * THE VARIANCE BUFFER REACHES THE FLOOR — and adds NOTHING when nobody sized one.
 *
 * The cash floor is what the converged engine holds debt payments back to reach, so a dollar
 * added here moves every payoff date in the app. That makes the NO-OP the most important case
 * in this file, not the feature: a change that quietly moves every user's floor on the day it
 * ships is a change that cannot ship, however good the feature is.
 *
 * The buffer itself is sized in `variable-bill-buffer.ts` from a rule's own matched payment
 * history, and is computed by the CALLER rather than here — this module has never known about
 * transactions, and putting the matcher inside the pay schedule would make the floor depend on
 * sync state. See the parameter's own note.
 *
 * Would-fail checks: drop the `+ buffer` and the "raises the floor" case fails; remove the
 * `> 0` guard and the negative case starts LOWERING a cash floor, which is the one direction
 * this must never move in.
 */
import { describe, it, expect } from 'vitest';
import { getPrePaycheckNextMonthBills } from '@/lib/pay-schedule';
import type { RuleRow } from '@/hooks/useSupabaseData';

/** Pinned so a boundary case does not drift with the wall clock. */
const NOW = new Date('2026-09-05T12:00:00');

/** Paid on the 20th, so a bill due on the 10th of next month lands before the next paycheck. */
const CONFIG = {
  weeklyGross: 2000, taxRate: 0.2, paycheckDay: 20, frequency: 'monthly' as const,
};

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: 'rule-electric', user_id: 'u1', name: 'Electric', amount: 120,
  rule_type: 'expense', frequency: 'monthly', due_day: 10, due_month: null,
  start_date: '2026-01-01', end_date: null, category: 'Utilities',
  payment_source: null, deposit_account: null, active: true, notes: null,
  created_at: '', updated_at: '',
  ...over,
} as unknown as RuleRow);

describe('per-rule variance buffers in the pre-paycheck bills total', () => {
  it('adds NOTHING when no map is passed — the floor is what it was', () => {
    const before = getPrePaycheckNextMonthBills([rule()], CONFIG, null, NOW);
    expect(before.total).toBe(120);
    expect(before.items).toHaveLength(1);
    expect(before.items[0]).toEqual({ name: 'Electric', amount: 120, dueDay: 10 });
  });

  it('adds NOTHING when the map is empty, or does not mention this rule', () => {
    const baseline = getPrePaycheckNextMonthBills([rule()], CONFIG, null, NOW).total;

    expect(getPrePaycheckNextMonthBills([rule()], CONFIG, null, NOW, new Map()).total)
      .toBe(baseline);
    expect(getPrePaycheckNextMonthBills(
      [rule()], CONFIG, null, NOW, new Map([['some-other-rule', 60]]),
    ).total).toBe(baseline);
  });

  it('raises the reserve by exactly the buffer, on the item as well as the total', () => {
    // Tre's electric bill: planned $120, p90 of its own history $180.88, so a $60.88 buffer.
    const result = getPrePaycheckNextMonthBills(
      [rule()], CONFIG, null, NOW, new Map([['rule-electric', 60.88]]),
    );
    expect(result.total).toBeCloseTo(180.88, 2);
    // The ITEM carries it too, so the floor breakdown a user reads shows the real reserve
    // rather than a total that does not add up from the lines above it.
    expect(result.items[0].amount).toBeCloseTo(180.88, 2);
  });

  it('NEVER lowers the floor, whatever the map says', () => {
    const baseline = getPrePaycheckNextMonthBills([rule()], CONFIG, null, NOW).total;

    // A negative buffer is ignored rather than corrected. The floor is the line the plan is
    // forbidden to spend below; a bad map entry must not be able to move it down.
    expect(getPrePaycheckNextMonthBills(
      [rule()], CONFIG, null, NOW, new Map([['rule-electric', -500]]),
    ).total).toBe(baseline);

    // So is a non-finite one, which is what an arithmetic slip upstream produces.
    expect(getPrePaycheckNextMonthBills(
      [rule()], CONFIG, null, NOW, new Map([['rule-electric', Number.NaN]]),
    ).total).toBe(baseline);
  });

  it('buffers each rule independently, not by category or by name', () => {
    const rules = [
      rule(),
      rule({ id: 'rule-water', name: 'Water', amount: 40 }),
    ];
    const result = getPrePaycheckNextMonthBills(
      rules, CONFIG, null, NOW, new Map([['rule-electric', 60], ['rule-water', 5]]),
    );
    expect(result.total).toBe(120 + 60 + 40 + 5);
    const byName = Object.fromEntries(result.items.map(i => [i.name, i.amount]));
    expect(byName.Electric).toBe(180);
    expect(byName.Water).toBe(45);
  });
});
