import { describe, it, expect } from 'vitest';
import { shiftIsoDays } from '@/lib/credit-card-engine';

// Run under every zone by `npm run test:tz`. A UTC-midnight Date read back with local getters
// lands a day early west of UTC, so these pin the calendar answer in each zone.
describe('shiftIsoDays', () => {
  it('shifts forward and back within a month', () => {
    expect(shiftIsoDays('2026-10-12', -20)).toBe('2026-09-22');
    expect(shiftIsoDays('2026-10-12', 25)).toBe('2026-11-06');
  });
  it('crosses a year and a leap day', () => {
    expect(shiftIsoDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftIsoDays('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('crosses the US DST change without losing a day', () => {
    expect(shiftIsoDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(shiftIsoDays('2026-03-08', 1)).toBe('2026-03-09');
  });
});
