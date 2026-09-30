import { describe, it, expect } from 'vitest';
import { shortfallByMonth } from '@/lib/breach-levers';
import type { ForecastResult } from '@/lib/forecast-engine';

// e3566eab - an account-paid expense its own account cannot cover is paid from the month's cash.
const result = (rows: { month: string; endingCash: number; monthMinSafe: number; unfundedAccountOutflow?: number }[]) =>
  ({ data: [{ month: 'Sep 2026', endingCash: 0, monthMinSafe: 0 }, ...rows] } as unknown as ForecastResult);

describe('shortfallByMonth charges the unfunded part of an account-paid expense', () => {
  it('a month with headroom but an unfunded 2,000 fee is short', () => {
    const r = shortfallByMonth(result([{ month: 'Mar 2027', endingCash: 1000, monthMinSafe: 150, unfundedAccountOutflow: 2000 }]), 12);
    expect(r).toEqual([{ month: 'Mar 2027', shortfall: 1150 }]);
  });

  it('the headroom absorbs a smaller unfunded amount (control: not every flag is a shortfall)', () => {
    expect(shortfallByMonth(result([{ month: 'Mar 2027', endingCash: 2433, monthMinSafe: 150, unfundedAccountOutflow: 2000 }]), 12)).toEqual([]);
  });

  it('the spent cash stays spent: later months carry the unfunded dollars', () => {
    const r = shortfallByMonth(result([
      { month: 'Mar 2027', endingCash: 2338, monthMinSafe: 150, unfundedAccountOutflow: 2001.33 },
      { month: 'Apr 2027', endingCash: 1477, monthMinSafe: 1475 },
    ]), 12);
    expect(r).toEqual([{ month: 'Apr 2027', shortfall: 1999.33 }]);
  });

  it('a row without the field reads exactly as before', () => {
    expect(shortfallByMonth(result([{ month: 'Oct 2026', endingCash: 2132, monthMinSafe: 2525 }]), 12))
      .toEqual([{ month: 'Oct 2026', shortfall: 393 }]);
  });
});
