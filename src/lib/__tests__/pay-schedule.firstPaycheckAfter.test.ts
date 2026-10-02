import { describe, it, expect } from 'vitest';
import { buildPayConfig, getFirstPaycheckAfter } from '../pay-schedule';
import { toLocalDateStr } from '../scheduling';

// 18541ba1: Tre's shape - weekly, Fridays (paycheck_day 5). 2026-10-02 is a Friday and his payday.
const weekly = buildPayConfig({ weekly_gross_income: 1093, paycheck_frequency: 'weekly', paycheck_day: 5 });
const after = (d: string) => {
  const hit = getFirstPaycheckAfter(weekly, d);
  return hit ? toLocalDateStr(hit) : null;
};

describe('getFirstPaycheckAfter', () => {
  it('ON payday, returns the NEXT paycheck, never today (the $0 Safe to Spend on 10-02)', () => {
    expect(after('2026-10-02')).toBe('2026-10-09');
  });

  it('the day before payday returns payday', () => {
    expect(after('2026-10-01')).toBe('2026-10-02');
  });

  it('crosses into next month when the last paycheck of this one has passed', () => {
    expect(after('2026-10-30')).toBe('2026-11-06');
  });

});
