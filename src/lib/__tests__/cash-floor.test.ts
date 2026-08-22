// The cash floor policy. One definition, six readers.
//
// The load-bearing property is that automatic mode resolves to 0 — NOT "no floor". `getMinSafeCash`
// takes max(thisValue, prePaycheckBills), so 0 means "contribute nothing of your own and let the
// measured bills decide". Anything else here would be a floor nobody could source.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MANUAL_CASH_FLOOR, displayedManualCashFloor, isManualCashFloor, resolveCashFloor,
} from '../cash-floor';

describe('resolveCashFloor', () => {
  it('is AUTOMATIC by default — an absent flag contributes nothing of its own', () => {
    expect(resolveCashFloor({ cash_floor: 1000 })).toBe(0);
    expect(resolveCashFloor({ cash_floor: 1000, cash_floor_is_manual: null })).toBe(0);
    expect(resolveCashFloor(null)).toBe(0);
    expect(resolveCashFloor(undefined)).toBe(0);
  });

  it('ignores the saved figure entirely while automatic — 42 of 46 profiles never chose theirs', () => {
    expect(resolveCashFloor({ cash_floor: 2500, cash_floor_is_manual: false })).toBe(0);
  });

  it('uses the stored figure once the user takes it over', () => {
    expect(resolveCashFloor({ cash_floor: 2500, cash_floor_is_manual: true })).toBe(2500);
  });

  it('accepts a numeric string, which is what supabase-js hands back for `numeric`', () => {
    expect(resolveCashFloor({ cash_floor: '1500', cash_floor_is_manual: true })).toBe(1500);
  });

  it('honours a deliberate zero rather than treating it as unset', () => {
    expect(resolveCashFloor({ cash_floor: 0, cash_floor_is_manual: true })).toBe(0);
  });

  it('falls back to the default when a manual floor is missing or unusable', () => {
    for (const cash_floor of [null, undefined, Number.NaN, -50, 'abc']) {
      expect(resolveCashFloor({ cash_floor: cash_floor as number, cash_floor_is_manual: true }))
        .toBe(DEFAULT_MANUAL_CASH_FLOOR);
    }
  });
});

describe('isManualCashFloor', () => {
  it('is true only for an explicit true — never for a missing column', () => {
    expect(isManualCashFloor({ cash_floor_is_manual: true })).toBe(true);
    expect(isManualCashFloor({ cash_floor_is_manual: false })).toBe(false);
    expect(isManualCashFloor({})).toBe(false);
    expect(isManualCashFloor(null)).toBe(false);
  });
});

describe('displayedManualCashFloor — why the toggle is reversible', () => {
  it('keeps showing the saved figure WHILE automatic is on', () => {
    // If this returned 0 the input would read as empty, the user would think their number was
    // lost, and switching back would look destructive. The column is the saved preference.
    expect(displayedManualCashFloor({ cash_floor: 2500, cash_floor_is_manual: false })).toBe(2500);
  });

  it('defaults a profile that has never stored one', () => {
    expect(displayedManualCashFloor({})).toBe(DEFAULT_MANUAL_CASH_FLOOR);
    expect(displayedManualCashFloor(null)).toBe(DEFAULT_MANUAL_CASH_FLOOR);
  });
});
