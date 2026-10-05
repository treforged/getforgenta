import { describe, it, expect } from 'vitest';
import { forecastLowPoint } from '../forecast-low-point';

describe('forecastLowPoint', () => {
  it('picks lowest from four rows', () => {
    const rows = [
      { month: 'Jan', endingCash: 100 },
      { month: 'Feb', endingCash: 50 },
      { month: 'Mar', endingCash: 75 },
      { month: 'Apr', endingCash: 25 },
    ];
    const result = forecastLowPoint(rows);
    expect(result).toEqual({ month: 'Apr', endingCash: 25 });
  });

  it('tie picks earliest', () => {
    const rows = [
      { month: 'Jan', endingCash: 50 },
      { month: 'Feb', endingCash: 50 },
    ];
    const result = forecastLowPoint(rows);
    expect(result).toEqual({ month: 'Jan', endingCash: 50 });
  });

  it('empty -> null', () => {
    expect(forecastLowPoint([] as ReadonlyArray<{ month: string; endingCash: number }>)).toBeNull();
  });

  it('skips NaN row', () => {
    const rows = [
      { month: 'Jan', endingCash: NaN },
      { month: 'Feb', endingCash: 100 },
    ];
    const result = forecastLowPoint(rows);
    expect(result).toEqual({ month: 'Feb', endingCash: 100 });
  });

  it('all-NaN -> null', () => {
    const rows = [
      { month: 'Jan', endingCash: NaN },
      { month: 'Feb', endingCash: NaN },
    ];
    expect(forecastLowPoint(rows)).toBeNull();
  });

  it('negative beats positive', () => {
    const rows = [
      { month: 'Jan', endingCash: -50 },
      { month: 'Feb', endingCash: 10 },
    ];
    const result = forecastLowPoint(rows);
    expect(result).toEqual({ month: 'Jan', endingCash: -50 });
  });

  it('returns new object, not input row', () => {
    const row = { month: 'Test', endingCash: 0 }
    const result = forecastLowPoint([row]);
    expect(result).not.toBe(row);
  });
});
