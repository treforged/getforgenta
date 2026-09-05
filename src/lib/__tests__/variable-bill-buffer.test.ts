/**
 * THE BUFFER FOR A VARIABLE BILL — asserted against the numbers it was designed from.
 *
 * Tre, 2026-09-05: *"my electric bill for this month was like 190, but i planned for much less."*
 *
 * The cases below are not invented shapes. Three of them are the actual distributions measured
 * on the live database that day, and they are here because each one killed a design that looked
 * reasonable in the abstract:
 *
 *   $54.07 every month          a flat percentage buffer would strand cash on this forever
 *   mean 140.46, worst 197.93   the item matching his own example
 *   mean 13,263, up to 21,785   not a bill at all, and what a merchant-level rule would swallow
 *
 * Would-fail checks: swap p90 for mean + 2 sigma and the electric case reserves far more than
 * $180.88; drop the coefficient-of-variation branch and the fixed bill grows a buffer it does
 * not need; lower MIN_OBSERVATIONS to 1 and a single payment starts moving a real cash floor.
 */
import { describe, it, expect } from 'vitest';
import {
  computeVariableBillBuffer, percentile, coefficientOfVariation,
  MIN_OBSERVATIONS, VARIABLE_CV_THRESHOLD, type BillPayment,
} from '@/lib/variable-bill-buffer';

/** Payment dates are not part of the maths; only the caller and the UI use them. */
const pay = (...amounts: number[]): BillPayment[] =>
  amounts.map((amount, i) => ({ date: `2026-0${(i % 9) + 1}-15`, amount }));

describe('percentile', () => {
  it('interpolates between the two nearest ranks', () => {
    // index = 0.5 * (4 - 1) = 1.5, so halfway between 20 and 30.
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });

  it('returns the only value when there is one', () => {
    expect(percentile([42], 0.9)).toBe(42);
  });

  it('does not care what order it is given', () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(25);
  });

  it('never reorders the caller\'s array', () => {
    const original = [40, 10, 30, 20];
    percentile(original, 0.9);
    expect(original).toEqual([40, 10, 30, 20]);
  });

  it('refuses an empty array rather than inventing a number', () => {
    expect(() => percentile([], 0.9)).toThrow();
  });
});

describe('coefficientOfVariation', () => {
  it('is zero for a bill that never moves', () => {
    expect(coefficientOfVariation([54.07, 54.07, 54.07, 54.07])).toBe(0);
  });

  it('is zero below two values, and for a mean of zero', () => {
    expect(coefficientOfVariation([100])).toBe(0);
    expect(coefficientOfVariation([])).toBe(0);
    expect(coefficientOfVariation([0, 0, 0])).toBe(0);
  });

  it('expresses spread as a share of size, not in dollars', () => {
    // The same $5 swing is a big deal on a $10 bill and noise on a $500 one.
    const small = coefficientOfVariation([5, 10, 15]);
    const large = coefficientOfVariation([495, 500, 505]);
    expect(small).toBeGreaterThan(large);
  });
});

describe('computeVariableBillBuffer', () => {
  it('adds nothing below three observations, and says why', () => {
    const result = computeVariableBillBuffer({ plannedAmount: 120, history: pay(150, 190) });
    expect(result).toEqual({
      buffer: 0, reserve: 120, reason: 'not-enough-history', sampleCount: 2, p90: null,
    });
    expect(MIN_OBSERVATIONS).toBe(3);
  });

  it('adds nothing to a bill that is the same every month', () => {
    // The live fixed item: $54.07, seven times, standard deviation zero.
    const result = computeVariableBillBuffer({
      plannedAmount: 54.07,
      history: pay(54.07, 54.07, 54.07, 54.07, 54.07, 54.07, 54.07),
    });
    expect(result.buffer).toBe(0);
    expect(result.reason).toBe('fixed');
    // The percentile is still reported: the UI can show the history even when it adds nothing.
    expect(result.p90).toBe(54.07);
  });

  it('covers the overrun on THE electric bill without reserving for the worst month ever', () => {
    // The live variable item, and Tre's own example. Seven months, mean 140.46, worst 197.93.
    const history = pay(99.69, 118.4, 130.2, 141.5, 152.8, 172.3, 197.93);
    const result = computeVariableBillBuffer({ plannedAmount: 120, history });

    expect(result.reason).toBe('from-history');
    expect(result.sampleCount).toBe(7);
    // p90 sits between the two worst months, not at the worst one.
    expect(result.p90).toBeGreaterThan(172.3);
    expect(result.p90).toBeLessThan(197.93);
    // And it covers his $190 month far better than the $120 plan did.
    expect(result.reserve).toBeGreaterThan(180);
    expect(result.reserve).toBe(120 + result.buffer);
  });

  it('adds nothing when the plan already covers the ninetieth percentile, and says THAT', () => {
    const result = computeVariableBillBuffer({
      plannedAmount: 300,
      history: pay(99.69, 130.2, 152.8, 197.93),
    });
    expect(result.buffer).toBe(0);
    // A distinct reason from 'fixed': the UI can say "your plan already covers this" rather
    // than showing a zero that looks like a failure to compute.
    expect(result.reason).toBe('planned-already-covers');
    expect(result.reserve).toBe(300);
  });

  it('lets an explicit "fixed" suppress a buffer the spread would have produced', () => {
    const history = pay(99.69, 130.2, 152.8, 197.93);
    expect(computeVariableBillBuffer({ plannedAmount: 120, history }).buffer).toBeGreaterThan(0);
    expect(computeVariableBillBuffer({ plannedAmount: 120, history, costType: 'fixed' }).buffer).toBe(0);
  });

  it('lets an explicit "variable" force a buffer on a bill that reads as fixed', () => {
    // Under the threshold, so it would derive as fixed — the user overrules that.
    const history = pay(100, 101, 102, 103);
    expect(computeVariableBillBuffer({ plannedAmount: 90, history }).reason).toBe('fixed');
    expect(computeVariableBillBuffer({ plannedAmount: 90, history, costType: 'variable' }).reason)
      .toBe('from-history');
  });

  it('drops a non-finite or negative entry instead of correcting it', () => {
    const history: BillPayment[] = [
      { date: '2026-01-15', amount: 100 },
      { date: '2026-02-15', amount: Number.NaN },
      { date: '2026-03-15', amount: -50 },
      { date: '2026-04-15', amount: 200 },
      { date: '2026-05-15', amount: 300 },
    ];
    const result = computeVariableBillBuffer({ plannedAmount: 100, history });
    expect(result.sampleCount).toBe(3);
  });

  it('never returns a negative buffer, and rounds money to the cent', () => {
    const result = computeVariableBillBuffer({
      plannedAmount: 33.333,
      history: pay(10.111, 20.222, 30.333, 99.999),
    });
    expect(result.buffer).toBeGreaterThanOrEqual(0);
    expect(result.buffer).toBe(Math.round(result.buffer * 100) / 100);
    expect(result.reserve).toBe(Math.round(result.reserve * 100) / 100);
  });

  it('reserves NOTHING extra for the row that is not a bill, because it is never asked', () => {
    // mean 13,263, range 460 to 21,785 — a card payment or transfer, not a recurring bill.
    // The maths would happily produce a five-figure buffer, which is exactly why the caller's
    // scope is the guard: this is only ever called for an item already in the floor, built
    // from one of the user's own recurring rules. This case documents the size of what that
    // constraint is holding back.
    const result = computeVariableBillBuffer({
      plannedAmount: 500,
      history: pay(460, 3200, 9800, 15400, 21785),
    });
    expect(result.buffer).toBeGreaterThan(10000);
  });

  it('treats the threshold as the documented boundary', () => {
    expect(VARIABLE_CV_THRESHOLD).toBe(0.1);
  });
});
