import { describe, it, expect } from 'vitest';
import { paydayColumns, quickSetupReady, quickCardAccount } from '../quick-setup';
import { buildPayConfig, getNextPaycheckDate } from '../pay-schedule';

describe('paydayColumns', () => {
  // 2026-10-16 is a Friday, 2026-10-14 a Wednesday.
  it('weekly: the weekday of the next payday', () => {
    expect(paydayColumns('weekly', '2026-10-14')).toEqual({ paycheck_day: 3 });
  });
  it('biweekly: the weekday plus the date as the phase anchor', () => {
    expect(paydayColumns('biweekly', '2026-10-16')).toEqual({ paycheck_day: 5, paycheck_start_date: '2026-10-16' });
  });
  it('monthly: the day of the month', () => {
    expect(paydayColumns('monthly', '2026-10-28')).toEqual({ paycheck_day: 28 });
  });
  it('no answer, or a malformed or impossible date, writes nothing', () => {
    expect(paydayColumns('weekly', undefined)).toEqual({});
    expect(paydayColumns('weekly', '')).toEqual({});
    expect(paydayColumns('weekly', '10/16/2026')).toEqual({});
    expect(paydayColumns('monthly', '2026-02-31')).toEqual({});
  });
  it('round-trips through the engine: the schedule it builds pays on that day', () => {
    // A biweekly anchor read back by the real pay-schedule code lands a paycheck on the anchor's
    // weekday, 14 days apart - the columns mean what the engine reads them as.
    const cols = paydayColumns('biweekly', '2026-10-16');
    const cfg = buildPayConfig({ weekly_gross_income: 2000, paycheck_frequency: 'biweekly', tax_rate: 22, ...cols } as never);
    const next = getNextPaycheckDate(cfg);
    expect(next.getDay()).toBe(5);
    const anchor = new Date(2026, 9, 16).getTime();
    const days = Math.round((next.getTime() - anchor) / 86_400_000);
    expect(Math.abs(days) % 14).toBe(0);
  });
});

describe('quickSetupReady', () => {
  it('needs a positive pay figure', () => {
    expect(quickSetupReady('1500')).toBe(true);
    expect(quickSetupReady('')).toBe(false);
    expect(quickSetupReady('0')).toBe(false);
    expect(quickSetupReady('abc')).toBe(false);
  });
});

describe('quickCardAccount', () => {
  it('a positive balance becomes a credit-card ACCOUNT the payoff engine reads', () => {
    expect(quickCardAccount('2450.5', '24.99')).toEqual({ name: 'Credit card', account_type: 'credit_card', balance: 2450.5, apr: 24.99, credit_limit: null, min_payment: null, payment_due_day: null });
  });
  it('an unknown APR is null, not 0 (0% would claim the card is interest-free)', () => {
    expect(quickCardAccount('900', '')?.apr).toBeNull();
  });
  it('no card, zero or junk writes nothing', () => {
    expect(quickCardAccount('', '20')).toBeNull();
    expect(quickCardAccount('0', '20')).toBeNull();
    expect(quickCardAccount('x', '20')).toBeNull();
  });
});
