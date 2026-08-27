// WHICH MONTH AN EXTRA-AWARE BALANCE ARRAY SAYS A DEBT WAS CLEARED IN.
//
// Found on Tre's own Garage card 2026-08-27: "paying this loan off by Jul 2029" printed a few
// inches above a schedule whose final payment lands in Aug 2029, while the engine sent $2,343 of
// extra principal that August — into a loan the label claimed was already gone.
//
// The cause is measured in `forecast-engine.extrasPayoffReadout.test.ts`: the array is SEEDED as
// the balance a month opens at, then reduced from index i INCLUSIVE by the extras, so a single
// constant offset is wrong half the time. Three call sites carried `firstZero - 1`.

import { describe, it, expect } from 'vitest';
import { extraAwarePayoffMonthIndex } from '../extra-aware-payoff';

describe('extraAwarePayoffMonthIndex', () => {
  it('subtracts one when AMORTIZATION ran the balance out — month 4 opened at nothing, so the '
    + 'final payment was month 3', () => {
    const balances = [400, 300, 200, 100, 0, 0];
    expect(extraAwarePayoffMonthIndex(balances, [0, 0, 0, 0, 0, 0])).toBe(3);
  });

  it('does NOT subtract one when an EXTRA is what finished it — the money went in during month 4, '
    + 'so month 4 is when it was cleared. This is the Jul-vs-Aug bug', () => {
    const balances = [400, 300, 200, 100, 0, 0];
    expect(extraAwarePayoffMonthIndex(balances, [0, 0, 0, 0, 250, 0])).toBe(4);
  });

  it('reads the un-accelerated answer with no extras supplied at all', () => {
    expect(extraAwarePayoffMonthIndex([400, 200, 0])).toBe(1);
    expect(extraAwarePayoffMonthIndex([400, 200, 0], null)).toBe(1);
  });

  it('is null when the balance never reaches zero — a debt the projection does not retire has no '
    + 'payoff date, and inventing the last index would print one', () => {
    expect(extraAwarePayoffMonthIndex([400, 300, 200], [0, 0, 0])).toBeNull();
  });

  it('is null when the debt is ALREADY paid at index 0 — that row should not be offering a date', () => {
    expect(extraAwarePayoffMonthIndex([0, 0, 0], [0, 0, 0])).toBeNull();
    expect(extraAwarePayoffMonthIndex([0, 0, 0], [500, 0, 0])).toBeNull();
  });

  it('is null for an empty or missing array rather than throwing on a target the engine never '
    + 'projected', () => {
    expect(extraAwarePayoffMonthIndex([])).toBeNull();
    expect(extraAwarePayoffMonthIndex(null)).toBeNull();
    expect(extraAwarePayoffMonthIndex(undefined)).toBeNull();
  });

  it('treats amortization dust as paid off — the reducers clamp to an exact zero, but a SEEDED '
    + 'entry can carry a fraction of a cent and dust is not a debt', () => {
    expect(extraAwarePayoffMonthIndex([400, 0.004, 0], [0, 0, 0])).toBe(0);
    expect(extraAwarePayoffMonthIndex([400, 0.02, 0], [0, 0, 0])).toBe(1);
  });

  it('reads the extras array SHORTER than the balances without crashing — a horizon mismatch is a '
    + 'missing answer, not a zero-extra assertion', () => {
    expect(extraAwarePayoffMonthIndex([400, 300, 0], [0])).toBe(1);
  });
});
