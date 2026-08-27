// THE ANNUAL IRA CAP, AND LEVEL MONTHLY CONTRIBUTIONS.
//
// Tre, 2026-08-26: "roth IRA has a max contribution per year, that should be auto capped each year
// between the legal time frame ... but make the payments consistent so users can set up auto
// transfer and forget about it", and for investing "same auto transfer concept ... but dont cap it".
//
// The levelling is the half that changes what the app does, and it is the half worth pinning: a
// waterfall fills the top unfinished target as fast as the surplus allows, so an uncapped IRA takes
// $2,400 / $2,400 / $2,200 and then nothing for nine months. Correct total, useless instruction.

import { describe, it, expect } from 'vitest';
import {
  IRA_ANNUAL_LIMIT, isIraCapped, levelMonthlyAllowance, levelMonthlyToDate, monthsLeftInYear,
} from '../retirement-contribution-cap';

describe('isIraCapped — only the accounts the IRA limit actually governs', () => {
  it('caps roth_ira and ira', () => {
    expect(isIraCapped('roth_ira')).toBe(true);
    expect(isIraCapped('ira')).toBe(true);
  });

  it('does NOT cap 401k or hsa — they have their own, different statutory limits, and one of them '
    + 'is a payroll figure this app never sees. A fabricated constraint on real money is worse '
    + 'than no constraint', () => {
    expect(isIraCapped('401k')).toBe(false);
    expect(isIraCapped('hsa')).toBe(false);
    expect(isIraCapped('brokerage')).toBe(false);
    expect(isIraCapped(null)).toBe(false);
    expect(isIraCapped(undefined)).toBe(false);
  });
});

describe('monthsLeftInYear', () => {
  it('counts THIS month, so December is 1 and not a division by zero', () => {
    expect(monthsLeftInYear(0)).toBe(12);
    expect(monthsLeftInYear(6)).toBe(6);
    expect(monthsLeftInYear(11)).toBe(1);
  });

  it('is 1 for anything unreadable rather than 0 or NaN', () => {
    expect(monthsLeftInYear(Number.NaN)).toBe(1);
    expect(monthsLeftInYear(-3)).toBe(1);
    expect(monthsLeftInYear(99)).toBe(1);
  });
});

describe('levelMonthlyAllowance — the figure a person can set up once and forget', () => {
  it('spreads a whole untouched year evenly: $7,000 over 12 months in January', () => {
    expect(levelMonthlyAllowance({ annualCap: 7_000, alreadyContributed: 0, month: 0 }))
      .toBeCloseTo(7_000 / 12, 6);
  });

  it('spreads what is LEFT over the months that are left, not the whole cap', () => {
    // Half the year gone, $3,000 already in: $4,000 over the remaining 6 months.
    expect(levelMonthlyAllowance({ annualCap: 7_000, alreadyContributed: 3_000, month: 6 }))
      .toBeCloseTo(4_000 / 6, 6);
  });

  it('holds level month after month when exactly the allowance is taken — the whole point', () => {
    let used = 0;
    const monthly: number[] = [];
    for (let m = 0; m < 12; m += 1) {
      const allowed = levelMonthlyAllowance({ annualCap: 7_000, alreadyContributed: used, month: m });
      monthly.push(allowed);
      used += allowed;
    }
    for (const m of monthly) expect(m).toBeCloseTo(7_000 / 12, 6);
    expect(used).toBeCloseTo(7_000, 6);
  });

  it('never exceeds the cap even when an earlier month over-contributed', () => {
    expect(levelMonthlyAllowance({ annualCap: 7_000, alreadyContributed: 7_000, month: 5 })).toBe(0);
    expect(levelMonthlyAllowance({ annualCap: 7_000, alreadyContributed: 9_999, month: 5 })).toBe(0);
  });

  it('gives the whole remainder in December, because there is no later month to spread into', () => {
    expect(levelMonthlyAllowance({ annualCap: 7_000, alreadyContributed: 6_000, month: 11 }))
      .toBeCloseTo(1_000, 6);
  });

  it('is 0 for a cap that is not a positive number', () => {
    expect(levelMonthlyAllowance({ annualCap: 0, alreadyContributed: 0, month: 0 })).toBe(0);
    expect(levelMonthlyAllowance({ annualCap: Number.NaN, alreadyContributed: 0, month: 0 })).toBe(0);
  });

  it('pins the limit this app plans against, so a change to it is a deliberate edit', () => {
    expect(IRA_ANNUAL_LIMIT).toBe(7_000);
  });
});

describe('levelMonthlyToDate — the same idea with no ceiling ("dont cap it")', () => {
  it('spreads the remaining need over the months until the date, counting this one', () => {
    expect(levelMonthlyToDate({ remainingNeed: 1_200, monthsUntilDate: 11 })).toBeCloseTo(100, 6);
    expect(levelMonthlyToDate({ remainingNeed: 1_200, monthsUntilDate: 0 })).toBeCloseTo(1_200, 6);
  });

  it('is UNCAPPED for a target with no date — levelling answers "by when", and without a date '
    + 'there is no question', () => {
    expect(levelMonthlyToDate({ remainingNeed: 5_000, monthsUntilDate: null }))
      .toBe(Number.POSITIVE_INFINITY);
  });

  it('returns Infinity rather than the remaining need, because the caller takes a Math.min against '
    + 'real capacity and the need would silently re-impose a one-month fill', () => {
    const need = 5_000;
    const allowance = levelMonthlyToDate({ remainingNeed: need, monthsUntilDate: null });
    expect(Math.min(need, allowance)).toBe(need);
  });

  it('treats a date already past as due now rather than dividing by zero or going negative', () => {
    expect(levelMonthlyToDate({ remainingNeed: 900, monthsUntilDate: -5 })).toBeCloseTo(900, 6);
  });

  it('is 0 when there is nothing left to need', () => {
    expect(levelMonthlyToDate({ remainingNeed: 0, monthsUntilDate: 6 })).toBe(0);
    expect(levelMonthlyToDate({ remainingNeed: -100, monthsUntilDate: 6 })).toBe(0);
  });
});
