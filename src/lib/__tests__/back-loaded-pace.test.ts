import { describe, it, expect } from 'vitest';
import {
  backLoadedMonthlyCeiling, levelMonthlyCeiling, runPaceToDeadline,
} from '../back-loaded-pace';

/**
 * THE DEADLINE IS THE PROPERTY UNDER TEST, NOT THE SHAPE.
 *
 * Tre asked for a far-out goal to take less early and more later so a credit card can be killed
 * first - "Just make sure they both still hit their targets." A pace that is merely smaller early
 * is easy to write and misses the date, so every arm here that checks the RAMP is paired with one
 * that checks the goal is still FULLY FUNDED by the deadline.
 *
 * ⚠️ THE FIRST TWO ARMS ARE POSITIVE CONTROLS ON THE COMPARISON ITSELF. "Back-loaded takes less
 * early" is satisfied perfectly by a function that returns 0 forever, and "it hits the target" is
 * satisfied by one that returns the whole need in month 1. Neither is the feature. The pair is.
 */
describe('a back-loaded pace', () => {
  it('POSITIVE CONTROL: the level pace it replaces is flat and finishes on time', () => {
    const r = runPaceToDeadline(1200, 12, levelMonthlyCeiling);
    expect(r.perMonth.every(v => Math.abs(v - 100) < 0.005)).toBe(true);
    expect(r.stillOwed).toBe(0);
  });

  it('takes LESS than the level pace in the first month', () => {
    expect(backLoadedMonthlyCeiling(1200, 12)).toBeLessThan(levelMonthlyCeiling(1200, 12));
  });

  it('and MORE than the level pace in the last months - it loads up, it does not just shrink', () => {
    const r = runPaceToDeadline(1200, 12, backLoadedMonthlyCeiling);
    expect(r.perMonth[11]).toBeGreaterThan(100);
    expect(r.perMonth[11]).toBeGreaterThan(r.perMonth[0]);
  });

  it('⚠️ STILL HITS THE TARGET EXACTLY, which is the thing he said must not break', () => {
    const r = runPaceToDeadline(1200, 12, backLoadedMonthlyCeiling);
    expect(r.stillOwed).toBe(0);
    expect(r.paid).toBeCloseTo(1200, 6);
  });

  it('rises every month - a ramp, asserted month by month rather than at the ends', () => {
    const r = runPaceToDeadline(1200, 12, backLoadedMonthlyCeiling);
    for (let i = 1; i < r.perMonth.length; i += 1) {
      expect(r.perMonth[i]).toBeGreaterThan(r.perMonth[i - 1]);
    }
  });

  it('frees real money early - the whole point, stated as a number', () => {
    const level = runPaceToDeadline(1200, 12, levelMonthlyCeiling);
    const ramp = runPaceToDeadline(1200, 12, backLoadedMonthlyCeiling);
    const firstSix = (v: number[]) => v.slice(0, 6).reduce((a, b) => a + b, 0);
    // MEASURED, not guessed - my first version of this line asserted "< 350" from a mental
    // estimate and the real figure is 150.00, which is a much steeper back-load than I expected.
    // Level reserves HALF the need in the first half of the run; the ramp reserves an EIGHTH, and
    // the $450 difference is what the card keeps while it is still accruing 29.99%.
    // The full 12-month profile, $1,200 over 12 months, to the cent:
    //   15.38 17.95 21.21 25.45 31.11 38.89 50.00 66.67 93.33 140.00 233.33 466.67
    expect(firstSix(level.perMonth)).toBeCloseTo(600, 6);
    expect(firstSix(ramp.perMonth)).toBeCloseTo(150, 2);
    expect(level.stillOwed).toBe(0);
    expect(ramp.stillOwed).toBe(0);
  });

  it('the final month closes the gap however lean the earlier ones were', () => {
    // Three months with almost no cash, then the deadline. The identity that makes this safe is
    // that at one month left the ceiling IS the whole remaining need.
    const r = runPaceToDeadline(1200, 12, backLoadedMonthlyCeiling, i => (i < 11 ? 5 : 2000));
    expect(r.stillOwed).toBe(0);
  });

  it('a month with NO cash costs the goal nothing at the deadline', () => {
    const r = runPaceToDeadline(1200, 12, backLoadedMonthlyCeiling, i => (i === 3 ? 0 : 1e9));
    expect(r.stillOwed).toBe(0);
  });

  it('one month left means the whole need, under either pace', () => {
    expect(backLoadedMonthlyCeiling(500, 1)).toBe(500);
    expect(levelMonthlyCeiling(500, 1)).toBe(500);
  });

  it('a deadline that has arrived or cannot be read is never treated as generous', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(backLoadedMonthlyCeiling(500, bad)).toBe(500);
    }
  });

  it('nothing owed means nothing reserved', () => {
    expect(backLoadedMonthlyCeiling(0, 12)).toBe(0);
    expect(backLoadedMonthlyCeiling(0.004, 12)).toBe(0);
    expect(backLoadedMonthlyCeiling(Number.NaN, 12)).toBe(0);
  });
});
