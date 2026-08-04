import { describe, it, expect } from 'vitest';
import { ordinal, ordinalSuffix } from '../ordinal';

// Live bugs this replaces: `Due 1th` on Tre's Discover card, `Due 22th` on Dashboard/Accounts/Debt,
// `due 2th` in Forecast's obligations list. Day-of-month is the only real input (1–31), but the
// 11/12/13 exception and the 21/22/23/31 cases are exactly what the old ternaries missed.

describe('ordinalSuffix', () => {
  it('handles the single digits', () => {
    expect(ordinalSuffix(1)).toBe('st');
    expect(ordinalSuffix(2)).toBe('nd');
    expect(ordinalSuffix(3)).toBe('rd');
    expect(ordinalSuffix(4)).toBe('th');
  });

  it('handles the 11/12/13 exception', () => {
    expect(ordinalSuffix(11)).toBe('th');
    expect(ordinalSuffix(12)).toBe('th');
    expect(ordinalSuffix(13)).toBe('th');
  });

  it('handles the cases the old ternaries got wrong', () => {
    expect(ordinalSuffix(21)).toBe('st');
    expect(ordinalSuffix(22)).toBe('nd');
    expect(ordinalSuffix(23)).toBe('rd');
    expect(ordinalSuffix(31)).toBe('st');
  });

  it('covers every day of the month', () => {
    const days = Array.from({ length: 31 }, (_, i) => ordinal(i + 1));
    expect(days).toEqual([
      '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th',
      '11th', '12th', '13th', '14th', '15th', '16th', '17th', '18th', '19th', '20th',
      '21st', '22nd', '23rd', '24th', '25th', '26th', '27th', '28th', '29th', '30th',
      '31st',
    ]);
  });

  it('returns an empty string for non-finite input rather than "NaNth"', () => {
    expect(ordinal(Number.NaN)).toBe('');
    expect(ordinalSuffix(Number.NaN)).toBe('');
  });
});
