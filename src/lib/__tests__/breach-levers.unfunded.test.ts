import { describe, it, expect } from 'vitest';
import { shortfallByMonth } from '@/lib/breach-levers';
import type { ForecastResult } from '@/lib/forecast-engine';

// f3c0cdf5 - the unfunded part of an account-paid expense is paid from checking INSIDE the engine,
// so `endingCash` already carries it. shortfallByMonth must read endingCash alone: charging the
// `unfundedAccountOutflow` field again (the e3566eab behaviour) would count the same dollars twice.
const result = (rows: { month: string; endingCash: number; monthMinSafe: number; unfundedAccountOutflow?: number }[]) =>
  ({ data: [{ month: 'Sep 2026', endingCash: 0, monthMinSafe: 0 }, ...rows] } as unknown as ForecastResult);

describe('shortfallByMonth does not charge an unfunded outflow twice', () => {
  it('a month whose cash is already net of the unfunded fee is short only by its own cash', () => {
    const r = shortfallByMonth(result([{ month: 'Mar 2027', endingCash: 100, monthMinSafe: 150, unfundedAccountOutflow: 2000 }]), 12);
    expect(r).toEqual([{ month: 'Mar 2027', shortfall: 50 }]);
  });

  it('headroom in a month with an unfunded flag is not a shortfall (the flag alone charges nothing)', () => {
    expect(shortfallByMonth(result([{ month: 'Mar 2027', endingCash: 2433, monthMinSafe: 150, unfundedAccountOutflow: 2000 }]), 12)).toEqual([]);
  });

  it('later months are not charged for an earlier unfunded month (their cash carries it already)', () => {
    const r = shortfallByMonth(result([
      { month: 'Mar 2027', endingCash: 338, monthMinSafe: 150, unfundedAccountOutflow: 2001.33 },
      { month: 'Apr 2027', endingCash: 1477, monthMinSafe: 1475 },
    ]), 12);
    expect(r).toEqual([]);
  });

  it('a row without the field reads exactly as before', () => {
    expect(shortfallByMonth(result([{ month: 'Oct 2026', endingCash: 2132, monthMinSafe: 2525 }]), 12))
      .toEqual([{ month: 'Oct 2026', shortfall: 393 }]);
  });
});
