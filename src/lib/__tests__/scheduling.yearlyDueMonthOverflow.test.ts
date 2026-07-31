import { describe, it, expect } from 'vitest';
import { generateScheduledEvents } from '../scheduling';

/**
 * `generateScheduledEvents` built each yearly occurrence by mutating a copy of TODAY with
 * `setMonth()` while the day-of-month was still today's. On a day-29/30/31 clock any shorter
 * target month overflows into the next one: from Jul 30, `setMonth(1)` (February) lands on
 * "Feb 30" => Mar 2, and the following `setDate(due_day)` then pins the charge in MARCH.
 *
 * This displaces REAL CHARGES, not just labels — a February yearly bill was being scheduled a
 * month late every year, but only when the app was opened on the 29th/30th/31st. Same defect
 * class as the month-label bug fixed in credit-card-engine.ts (`57a48d5f`).
 *
 * The fix is `d.setDate(1)` before `setMonth()`. Do not "clean it up" — these tests are the
 * only thing standing between that line and a silent regression, and the bug is invisible on
 * days 1-28.
 */
describe('generateScheduledEvents — yearly due_month overflow on short months', () => {
  const yearlyRule = {
    id: 'pet-insurance',
    name: 'Pet Insurance',
    amount: 583,
    rule_type: 'expense',
    frequency: 'yearly',
    active: true,
    due_day: 21,
    due_month: 2, // February
  };

  it('schedules a February yearly bill in February from a day-30 clock', () => {
    const events = generateScheduledEvents([yearlyRule], [], 24, new Date(2026, 6, 30));
    const first = events.find(e => e.ruleId === 'pet-insurance');

    expect(first?.date).toBe('2027-02-21');
  });

  it('schedules a February yearly bill in February from a day-31 clock', () => {
    const events = generateScheduledEvents([yearlyRule], [], 24, new Date(2027, 0, 31));
    const first = events.find(e => e.ruleId === 'pet-insurance');

    expect(first?.date).toBe('2027-02-21');
  });

  it('still schedules correctly from a day-28 clock (no regression on safe days)', () => {
    const events = generateScheduledEvents([yearlyRule], [], 24, new Date(2026, 6, 28));
    const first = events.find(e => e.ruleId === 'pet-insurance');

    expect(first?.date).toBe('2027-02-21');
  });

  it('leaves long-month yearly bills where they already were', () => {
    const chewy = { ...yearlyRule, id: 'chewy', name: 'Chewy', amount: 79, due_day: 10, due_month: 5 };
    const events = generateScheduledEvents([chewy], [], 24, new Date(2026, 6, 30));

    expect(events.find(e => e.ruleId === 'chewy')?.date).toBe('2027-05-10');
  });

  it('repeats yearly in the correct month for every subsequent occurrence', () => {
    const events = generateScheduledEvents([yearlyRule], [], 48, new Date(2026, 6, 30));
    const dates = events.filter(e => e.ruleId === 'pet-insurance').map(e => e.date);

    expect(dates).toEqual(['2027-02-21', '2028-02-21', '2029-02-21', '2030-02-21']);
  });
});
