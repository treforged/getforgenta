import { describe, it, expect } from 'vitest';
import { generateScheduledEvents } from '../scheduling';

/**
 * The `monthly` branch advanced a single mutating Date with `setMonth(+1)`, which carries the
 * PREVIOUS occurrence's day-of-month forward. A day-31 rule therefore overflowed every short
 * month and, worse, the overflow was CUMULATIVE: from a Jul 15 clock a due_day-31 rule emitted
 * Jul 31, Aug 31, then **Oct 1** — September silently vanished — and from there the rule was
 * permanently stuck on the 1st of every month, forever.
 *
 * Unlike the yearly overflow (scheduling.yearlyDueMonthOverflow.test.ts), this one does NOT
 * depend on today's date — it hits any day-29/30/31 monthly rule at all times — and `setDate(1)`
 * does not fix it, because the defect is the carried-forward day, not today's day.
 *
 * Correct behavior, decided by Tre 2026-07-30: CLAMP to the month's last day, matching how Chase
 * and most billers actually bill a 31st due date. Every month gets exactly one charge and no
 * month is ever skipped.
 */
describe('generateScheduledEvents — monthly due_day clamping on short months', () => {
  const monthlyRule = {
    id: 'rent',
    name: 'Rent',
    amount: 1500,
    rule_type: 'expense',
    frequency: 'monthly',
    active: true,
    due_day: 31,
  };

  it('clamps a day-31 rule to each month\'s last day and never skips a month', () => {
    const events = generateScheduledEvents([monthlyRule], [], 8, new Date(2026, 6, 15));

    expect(events.map(e => e.date)).toEqual([
      '2026-07-31',
      '2026-08-31',
      '2026-09-30', // was 2026-10-01 — September used to vanish entirely
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
    ]);
  });

  it('clamps to Feb 29 in a leap year', () => {
    const events = generateScheduledEvents([monthlyRule], [], 2, new Date(2028, 0, 15));

    expect(events.map(e => e.date)).toEqual(['2028-01-31', '2028-02-29']);
  });

  it('clamps a day-30 rule to Feb 28 without disturbing 31-day months', () => {
    const rule = { ...monthlyRule, due_day: 30 };
    const events = generateScheduledEvents([rule], [], 3, new Date(2027, 0, 15));

    expect(events.map(e => e.date)).toEqual(['2027-01-30', '2027-02-28', '2027-03-30']);
  });

  it('leaves safe due days completely unchanged (no regression)', () => {
    const rule = { ...monthlyRule, due_day: 15 };
    const events = generateScheduledEvents([rule], [], 4, new Date(2026, 6, 15));

    expect(events.map(e => e.date)).toEqual([
      '2026-07-15',
      '2026-08-15',
      '2026-09-15',
      '2026-10-15',
      '2026-11-15',
    ]);
  });
});
