// Coverage audit (2026-08-11): does a payment plan's monthly schedule land correctly on every
// month of its horizon, including short months?
//
// `getPaymentDates`'s `monthly` branch is `d.setMonth(d.getMonth() + 1)` on a live `Date`, with no
// day-of-month clamp. `recurring_rules`' monthly/yearly occurrence math (`pay-schedule.ts`,
// `scheduling.ts`) deliberately re-derives the date from a `(year, monthIndex)` cursor instead of
// mutating a `Date` in place, specifically because JS Date rollover carries an out-of-range day
// into the FOLLOWING month rather than clamping it — `scheduling.ts` even has a comment calling out
// that a day-31 anchor mutated this way "silently skipped September". `getPaymentDates` is the one
// generator in this file that still does it the old way, so a plan that starts on the 29th/30th/31st
// skips whichever short month it lands on and drifts for every payment after.
//
// This pins the CORRECT (clamped) behavior and is expected to fail until `getPaymentDates` gets the
// same per-month cursor treatment as the recurring-rule generators.

import { describe, it, expect } from 'vitest';
import { getPaymentDates } from '../payment-plan-generator';

describe('getPaymentDates — monthly month-end clamp (KNOWN GAP)', () => {
  it('clamps a day-31 start to the last day of a shorter month instead of rolling over', () => {
    // 2026 is not a leap year, so February has 28 days.
    expect(getPaymentDates('2026-01-31', 'monthly', 4)).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    ]);
  });

  it('does not let a skipped short month drift every later date by the same offset', () => {
    const dates = getPaymentDates('2026-01-31', 'monthly', 6);
    // Regardless of the clamp, June's payment must fall in June — a drifted schedule instead
    // lands it in early July.
    expect(dates[5].startsWith('2026-06')).toBe(true);
  });
});
