// Income that STOPS on a date — and the final earned paycheck that lands after it.
//
// THE ASK. "Users need to be able to have income stop when scheduled. ex. my gf will stop work
// around the time we move. And since she's paid biweekly, if it stops on a week she's not paid,
// the next week still needs to have that final paycheck."
//
// THREE MEASURED DEFECTS, all on a $1,100 biweekly partner income ending 2027-08-31 (the month the
// GF income cliff already lands on):
//
//  1. THE TRAILING CHEQUE WAS DELETED. Every generator truncated strictly at `end_date`, so the
//     schedule stopped at 2027-08-27 and the 2027-09-10 payday — work already done, money that
//     really arrives — appeared nowhere. Cost: one full paycheck, in the month a household planning
//     a move is at its thinnest.
//
//  2. `generateScheduledEvents` STOPPED A FULL CYCLE EARLY when `end_date` landed ON a payday.
//     It bounded the loop with `new Date(rule.end_date)`, which parses as UTC MIDNIGHT — 20:00 the
//     previous day in US Eastern — so a noon-anchored occurrence on its own end date compared
//     GREATER and was dropped. With end_date 2027-08-27 the last event emitted was 2027-08-13.
//     The per-month generators parse at 'T12:00:00' and did not have the bug, so the forecast path
//     and the Transactions path disagreed by a paycheck.
//
//  3. `countRuleOccurrencesInMonth` DID NOT STOP AT ALL INSIDE THE FINAL MONTH for weekly rules.
//     `countWeekdayInMonth` counts every matching weekday in the month regardless of `end_date`, so
//     a weekly income ending 2027-08-05 was counted as FOUR August paychecks while
//     `getRuleOccurrenceDatesInMonth` said none.
//
// ⚠️ WHY ONLY WEEKLY AND BIWEEKLY GET A TRAILING CHEQUE. They are paid in arrears: a payday settles
// the cycle ending on it, so work after the last payday is genuinely unpaid and lands next payday.
// A monthly salary is normally paid current, and the app models it as one payment on `due_day` with
// no period boundary to reason about — inventing a trailing payment there would be inventing money.
// Expenses get nothing at all; rent does not arrive a cycle late because the lease ended. Pinned
// below so the asymmetry cannot be "tidied" away.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateScheduledEvents,
  countRuleOccurrencesInMonth,
  countWeekdayInMonth,
  getBiweeklyDatesInMonth,
  occurrenceSurvivesEndDate,
  trailingEarnedPayDate,
  toLocalDateStr,
} from '../scheduling';
import { getRuleOccurrenceDatesInMonth, getRemainingNonPaycheckIncomeByDay } from '../pay-schedule';

/** Well before every date below, so nothing here depends on the day the suite runs. */
const FROM = new Date(2026, 7, 27, 12, 0, 0);

/**
 * Tre's partner income: $1,100 biweekly, Fridays, phase-anchored on 2026-01-02 (a Friday), ending
 * 2027-08-31 (a TUESDAY — mid-cycle, which is the whole point). Grid paydays around the end:
 * … 2027-07-30, 2027-08-13, 2027-08-27, 2027-09-10.
 */
const GF = {
  id: 'gf', name: 'GF Half of Rent/Groceries', amount: 1100,
  rule_type: 'income', frequency: 'biweekly', active: true,
  due_day: 5,
  start_date: '2026-01-02' as string | null,
  end_date: '2027-08-31' as string | null,
  created_at: '2026-01-02T00:00:00+00:00',
};

const datesOf = (rule: typeof GF) =>
  generateScheduledEvents([rule], [], 60, FROM).map(e => e.date);

describe('trailingEarnedPayDate — the final EARNED paycheck', () => {
  it('pays a biweekly income one more time after its end date, on the next scheduled payday', () => {
    expect(trailingEarnedPayDate(GF, FROM)).toBe('2027-09-10');
  });

  it('pays nothing extra when a payday lands exactly ON the end date — that cheque settled it', () => {
    expect(trailingEarnedPayDate({ ...GF, end_date: '2027-08-27' }, FROM)).toBeNull();
  });

  it('uses the next matching weekday for a weekly income', () => {
    // Ends Tue 2027-08-31; the rule bills Fridays, so the final cheque is Fri 2027-09-03.
    expect(trailingEarnedPayDate({ ...GF, frequency: 'weekly' }, FROM)).toBe('2027-09-03');
    // Ends ON a Friday — settled, nothing trails it.
    expect(trailingEarnedPayDate({ ...GF, frequency: 'weekly', end_date: '2027-08-27' }, FROM)).toBeNull();
  });

  it('gives monthly, yearly and semi_monthly income nothing — they are not paid in arrears here', () => {
    for (const frequency of ['monthly', 'yearly', 'semi_monthly']) {
      expect(trailingEarnedPayDate({ ...GF, frequency }, FROM)).toBeNull();
    }
  });

  it('gives an EXPENSE nothing, at every frequency', () => {
    for (const frequency of ['weekly', 'biweekly', 'monthly', 'yearly']) {
      expect(trailingEarnedPayDate({ ...GF, rule_type: 'expense', frequency }, FROM)).toBeNull();
      expect(trailingEarnedPayDate({ ...GF, rule_type: 'transfer', frequency }, FROM)).toBeNull();
    }
  });

  it('returns null for a rule that ends before it starts, rather than inventing a cheque', () => {
    expect(trailingEarnedPayDate({ ...GF, start_date: '2027-01-01', end_date: '2026-06-01' }, FROM)).toBeNull();
  });

  // due_day holds a DAY OF MONTH on monthly rules, so a rule flipped monthly -> weekly can carry a
  // 15. An unclamped weekday walk would never terminate; this must return in finite time, on the
  // same Friday fallback `resolveBiweeklyAnchor` clamps to.
  it('terminates on a weekly rule carrying an out-of-range due_day', () => {
    expect(trailingEarnedPayDate({ ...GF, frequency: 'weekly', due_day: 15 }, FROM)).toBe('2027-09-03');
  });
});

describe('the trailing paycheck reaches every generator', () => {
  // Defect 1. This is the paycheck the forecast used to delete outright.
  it('generateScheduledEvents emits 2027-09-10 after an end_date of 2027-08-31', () => {
    const dates = datesOf(GF);
    expect(dates.slice(-3)).toEqual(['2027-08-13', '2027-08-27', '2027-09-10']);
    // Emitted once, not twice — the loops stop at end_date so the trailing push cannot duplicate.
    expect(dates.filter(d => d === '2027-09-10')).toHaveLength(1);
  });

  it('getRuleOccurrenceDatesInMonth puts it in SEPTEMBER, the month after the rule ended', () => {
    expect(getRuleOccurrenceDatesInMonth(GF, 2027, 7)).toEqual(['2027-08-13', '2027-08-27']);
    expect(getRuleOccurrenceDatesInMonth(GF, 2027, 8)).toEqual(['2027-09-10']);
    expect(getRuleOccurrenceDatesInMonth(GF, 2027, 9)).toEqual([]);
  });

  it('countRuleOccurrencesInMonth counts it, then counts nothing after', () => {
    expect(countRuleOccurrencesInMonth(GF, 2027, 7, FROM)).toBe(2);
    expect(countRuleOccurrencesInMonth(GF, 2027, 8, FROM)).toBe(1);
    expect(countRuleOccurrencesInMonth(GF, 2027, 9, FROM)).toBe(0);
  });

  // The trailing cheque can also land in the SAME month the rule ended, which the whole-month
  // end_date gate never reaches — a separate branch from the case above.
  it('lands in the end date\'s own month when the next payday is still that month', () => {
    const early = { ...GF, end_date: '2027-08-05' }; // next grid payday: 2027-08-13
    expect(getRuleOccurrenceDatesInMonth(early, 2027, 7)).toEqual(['2027-08-13']);
    expect(countRuleOccurrencesInMonth(early, 2027, 7, FROM)).toBe(1);
    expect(datesOf(early).slice(-2)).toEqual(['2027-07-30', '2027-08-13']);
  });

  it('carries the money, not just the date — $1,100 in Sep 2027, $0 in Oct', () => {
    const events = generateScheduledEvents([GF], [], 60, FROM);
    const sum = (prefix: string) => events
      .filter(e => e.date.startsWith(prefix)).reduce((s, e) => s + e.amount, 0);
    expect(sum('2027-08')).toBe(2200);
    expect(sum('2027-09')).toBe(1100);
    expect(sum('2027-10')).toBe(0);
  });
});

describe('end_date stops the income on the RIGHT date', () => {
  // Defect 2. Was ['2027-07-30', '2027-08-13'] — the 2027-08-27 payday, landing on its own end
  // date, was thrown away by the UTC-midnight bound.
  it('keeps a paycheck that falls exactly ON the end date', () => {
    expect(datesOf({ ...GF, end_date: '2027-08-27' }).slice(-2)).toEqual(['2027-08-13', '2027-08-27']);
  });

  it('makes the forecast path and the per-month path agree, which they did not', () => {
    const onGrid = { ...GF, end_date: '2027-08-27' };
    const august = datesOf(onGrid).filter(d => d.startsWith('2027-08'));
    expect(august).toEqual(getRuleOccurrenceDatesInMonth(onGrid, 2027, 7));
    expect(august).toHaveLength(countRuleOccurrencesInMonth(onGrid, 2027, 7, FROM));
  });

  // Defect 3. Was 4 — every Friday in August — against getRuleOccurrenceDatesInMonth's 0.
  it('counts a weekly income that ends mid-month as its surviving paychecks, not the whole month', () => {
    const weekly = { ...GF, frequency: 'weekly', end_date: '2027-08-05' };
    // August Fridays are the 6th, 13th, 20th and 27th; all are past Aug 5, so only the trailing
    // final cheque (Fri Aug 6, for the Aug 1-5 worked) survives.
    expect(countRuleOccurrencesInMonth(weekly, 2027, 7, FROM)).toBe(1);
    expect(getRuleOccurrenceDatesInMonth(weekly, 2027, 7)).toEqual(['2027-08-06']);
    expect(datesOf(weekly).slice(-1)).toEqual(['2027-08-06']);
  });

  it('stops a MONTHLY income dead at its end date, with no trailing payment', () => {
    const monthly = { ...GF, frequency: 'monthly', due_day: 15, end_date: '2027-08-31' };
    expect(datesOf(monthly).slice(-1)).toEqual(['2027-08-15']);
    expect(countRuleOccurrencesInMonth(monthly, 2027, 8, FROM)).toBe(0);
    expect(getRuleOccurrenceDatesInMonth(monthly, 2027, 8)).toEqual([]);
  });

  it('stops a biweekly EXPENSE dead at its end date, with no trailing payment', () => {
    const rent = { ...GF, rule_type: 'expense', end_date: '2027-08-31' };
    expect(datesOf(rent).slice(-1)).toEqual(['2027-08-27']);
    expect(countRuleOccurrencesInMonth(rent, 2027, 8, FROM)).toBe(0);
    expect(getRuleOccurrenceDatesInMonth(rent, 2027, 8)).toEqual([]);
  });
});

describe('getRemainingNonPaycheckIncomeByDay honours end_date at all', () => {
  const NOW = new Date(2027, 8, 1, 9, 0, 0); // 2027-09-01
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const monthly = {
    id: 'side', name: 'Side job', amount: 500, rule_type: 'income', frequency: 'monthly',
    active: true, due_day: 15, start_date: '2020-01-01', end_date: null as string | null,
    created_at: '2020-01-01T00:00:00+00:00', deposit_account: null,
  };

  // It read `start_date` and never `end_date`, so an income rule that ended SEVEN YEARS ago was
  // still being counted as cash available to pay down a card.
  it('counts nothing for an income rule that has already ended', () => {
    expect(getRemainingNonPaycheckIncomeByDay([{ ...monthly, end_date: '2020-06-30' }] as never, 31, null)).toBe(0);
  });

  it('still counts a rule with no end_date — unchanged', () => {
    expect(getRemainingNonPaycheckIncomeByDay([monthly] as never, 31, null)).toBe(500);
  });

  it('still counts a rule whose end_date has not arrived', () => {
    expect(getRemainingNonPaycheckIncomeByDay([{ ...monthly, end_date: '2027-12-31' }] as never, 31, null)).toBe(500);
  });

  it('pays the final weekly cheque that lands after the end date', () => {
    // Weekly Fridays, ends Wed 2027-09-01. Sep Fridays: 3, 10, 17, 24 — only the 3rd survives.
    const weekly = { ...monthly, frequency: 'weekly', due_day: 5, end_date: '2027-09-01' };
    expect(getRemainingNonPaycheckIncomeByDay([weekly] as never, 31, null)).toBe(500);
    // …and only once. Ending the previous Friday leaves nothing at all.
    const settled = { ...weekly, end_date: '2027-08-27' };
    expect(getRemainingNonPaycheckIncomeByDay([settled] as never, 31, null)).toBe(0);
  });
});

describe('INERTNESS — a rule with no end_date is untouched', () => {
  const NO_END = { ...GF, end_date: null as string | null };

  // `countWeekdayInMonth` and `getBiweeklyDatesInMonth` are NOT modified by this change, so
  // agreeing with them across five years is a real inertness proof rather than the new code
  // re-asserting itself.
  it('matches the untouched reference generators for 60 months, weekly and biweekly', () => {
    const weekly = { ...NO_END, frequency: 'weekly' };
    for (let i = 0; i < 60; i++) {
      const d = new Date(2026, 7 + i, 1);
      const [y, m] = [d.getFullYear(), d.getMonth()];
      expect(countRuleOccurrencesInMonth(weekly, y, m, FROM)).toBe(countWeekdayInMonth(y, m, 5));
      const reference = getBiweeklyDatesInMonth(NO_END, y, m, FROM).map(toLocalDateStr);
      expect(getRuleOccurrenceDatesInMonth(NO_END, y, m)).toEqual(reference);
      expect(countRuleOccurrencesInMonth(NO_END, y, m, FROM)).toBe(reference.length);
    }
  });

  it('emits no trailing cheque and truncates nothing', () => {
    expect(trailingEarnedPayDate(NO_END, FROM)).toBeNull();
    for (const iso of ['1999-01-01', '2027-08-31', '2099-12-31']) {
      expect(occurrenceSurvivesEndDate(NO_END, iso, FROM)).toBe(true);
    }
  });

  it('generates the same 14-day-spaced schedule it always did', () => {
    const dates = datesOf(NO_END);
    expect(dates[0]).toBe('2026-08-28');
    expect(dates).toHaveLength(131);
    for (let i = 1; i < dates.length; i++) {
      // Rounded because a DST boundary makes noon-to-noon 14 days ± 1 hour.
      const gap = Math.round((new Date(dates[i] + 'T12:00:00').getTime()
        - new Date(dates[i - 1] + 'T12:00:00').getTime()) / 86400000);
      expect(gap).toBe(14);
    }
  });

  it('is unaffected by rule_type when there is no end_date', () => {
    for (const rule_type of ['income', 'expense', 'transfer', 'investment']) {
      expect(datesOf({ ...NO_END, rule_type })).toEqual(datesOf(NO_END));
    }
  });
});
