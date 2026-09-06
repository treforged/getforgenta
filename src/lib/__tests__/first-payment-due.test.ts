// A new card's FIRST payment rarely lands on its steady cycle day. Tre's Robinhood Gold
// opened in September and its first payment is due 10 October, then the 10th every month.
//
// Would-fail checks: return payment_due_day in the first-payment month and "returns the DAY of
// the first payment due date" fails, which is the whole bug; fall back to 1 or 31 when neither
// field is set and "never invents a day" fails, which would move real money in the forecast.

import { describe, it, expect } from 'vitest';
import { firstPaymentDueMonthOffset, dueDayForMonthOffset } from '../first-payment-due';

describe('firstPaymentDueMonthOffset', () => {
  const now = new Date(2026, 8, 6);

  it('null / undefined / empty-string date returns null', () => {
    expect(firstPaymentDueMonthOffset(null, now)).toBeNull();
    expect(firstPaymentDueMonthOffset(undefined, now)).toBeNull();
    expect(firstPaymentDueMonthOffset('', now)).toBeNull();
  });

  it('a date in the CURRENT month returns 0', () => {
    const date = '2026-09-15';
    expect(firstPaymentDueMonthOffset(date, now)).toBe(0);
  });

  it('a date in the NEXT month returns 1', () => {
    const date = '2026-10-10';
    expect(firstPaymentDueMonthOffset(date, now)).toBe(1);
  });

  it('a date 4 months out returns 4', () => {
    const now = new Date(2026, 10, 6); // November 6, 2026
    const date = '2027-03-02';
    expect(firstPaymentDueMonthOffset(date, now)).toBe(4);
  });

  it('a date in a PAST month returns null', () => {
    const date = '2026-08-15';
    expect(firstPaymentDueMonthOffset(date, now)).toBeNull();
  });

  it('a garbage string returns null', () => {
    const date = 'not-a-date';
    expect(firstPaymentDueMonthOffset(date, now)).toBeNull();
    const invalidDate = '2026-13-45';
    expect(firstPaymentDueMonthOffset(invalidDate, now)).toBeNull();
  });

  it('the LAST day of the current month returns 0, the FIRST day of the next month returns 1', () => {
    const lastDayOfCurrentMonth = '2026-09-30';
    expect(firstPaymentDueMonthOffset(lastDayOfCurrentMonth, now)).toBe(0);
    const firstDayOfNextMonth = '2026-10-01';
    expect(firstPaymentDueMonthOffset(firstDayOfNextMonth, now)).toBe(1);
  });
});

describe('dueDayForMonthOffset', () => {
  it('in the first-payment month, returns the DAY of the first payment due date, not payment_due_day', () => {
    const account = { first_payment_due_date: '2026-10-10', payment_due_day: 25 };
    const now = new Date(2026, 8, 6); // September 6, 2026
    expect(dueDayForMonthOffset(account, 1, now)).toBe(10);
  });

  it('in any OTHER month, returns payment_due_day', () => {
    const account = { first_payment_due_date: '2026-10-10', payment_due_day: 25 };
    const now = new Date(2026, 8, 6);
    expect(dueDayForMonthOffset(account, 2, now)).toBe(25);
  });

  it('with no first_payment_due_date at all, every month returns payment_due_day', () => {
    const account = { payment_due_day: 25 };
    const now = new Date(2026, 8, 6);
    expect(dueDayForMonthOffset(account, 1, now)).toBe(25);
  });

  it('with neither field set, returns null', () => {
    const account = {};
    const now = new Date(2026, 8, 6);
    expect(dueDayForMonthOffset(account, 1, now)).toBeNull();
  });

  it('once the first payment month is in the past, every month returns payment_due_day again', () => {
    const account = { first_payment_due_date: '2026-09-15', payment_due_day: 25 };
    const now = new Date(2026, 10, 6); // November 6, 2026
    expect(dueDayForMonthOffset(account, 0, now)).toBe(25);
  });
});
