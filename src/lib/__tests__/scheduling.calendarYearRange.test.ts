import { describe, it, expect } from 'vitest';
import { getCalendarYearMonthRange, getCalendarYearLabel } from '../scheduling';

// Regression for switching Forecast's and the Debt Payoff accordion's "Year 1-5" filters from a
// rolling 12-month window (which put a date like Jan 2029 in a different "Year" bucket depending
// on what month "today" happened to be) to real calendar years, so both pages agree on which
// bucket a given month falls into.

describe('getCalendarYearMonthRange', () => {
  it('Year 1 runs from today through December of the current calendar year', () => {
    const now = new Date(2026, 5, 20); // June 20, 2026
    expect(getCalendarYearMonthRange(1, now)).toEqual([0, 7]); // Jun-Dec 2026 = 7 months
  });

  it('Years 2-5 each cover a full January-December', () => {
    const now = new Date(2026, 5, 20);
    expect(getCalendarYearMonthRange(2, now)).toEqual([7, 19]); // all of 2027
    expect(getCalendarYearMonthRange(3, now)).toEqual([19, 31]); // all of 2028
    expect(getCalendarYearMonthRange(4, now)).toEqual([31, 43]); // all of 2029
    expect(getCalendarYearMonthRange(5, now)).toEqual([43, 55]); // all of 2030
  });

  it('January 2029 (month index 31 from a June 2026 anchor) falls in Year 4, not Year 3', () => {
    const now = new Date(2026, 5, 20);
    const [, year3End] = getCalendarYearMonthRange(3, now);
    const [year4Start] = getCalendarYearMonthRange(4, now);
    expect(year3End).toBe(31); // Year 3 ends just before index 31
    expect(year4Start).toBe(31); // Year 4 starts exactly at index 31 (Jan 2029)
  });

  it('Year 1 covers the full 12 months when today is January', () => {
    const now = new Date(2026, 0, 5); // January 5, 2026
    expect(getCalendarYearMonthRange(1, now)).toEqual([0, 12]);
    expect(getCalendarYearMonthRange(2, now)).toEqual([12, 24]);
  });
});

describe('getCalendarYearLabel', () => {
  it('maps year slots to real calendar years', () => {
    const now = new Date(2026, 5, 20);
    expect(getCalendarYearLabel(1, now)).toBe(2026);
    expect(getCalendarYearLabel(2, now)).toBe(2027);
    expect(getCalendarYearLabel(5, now)).toBe(2030);
  });
});
