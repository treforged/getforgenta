import { describe, it, expect } from 'vitest';
import {
  autoApplyDecision, isOrdinaryForMerchant,
  MIN_LINKS_TO_AUTO_APPLY, UNUSUAL_SD, MIN_HISTORY_FOR_OUTLIER,
} from '../auto-apply';

/**
 * ONE RULE, HIS FOUR CASES, JUDGED TOGETHER.
 *
 * The first describe is the whole specification. Tre reported four things on 2026-09-12 that look
 * like four features and are one threshold, and the rule is only right if it gets ALL FOUR at once:
 * three that should stop asking, and one that must still be refused. Testing them apart is how a
 * threshold gets tuned to pass whichever case is in front of you.
 *
 * The amounts are from his real history (measured 2026-09-13, see
 * docs/matching-thresholds-measured-2026-09-13.md), not invented.
 */

/** LOCKHEED MARTIN PAYROLL: 34 charges, mean $821.12, sd $106.90. */
const PAYROLL_HISTORY = [852.54, 848.46, 848.47, 815.75, 820.10, 835.22, 811.90, 826.40];
/** DUKE ENERGY, the variable utility he named. Never the same twice. */
const ELECTRICITY_HISTORY = [99.69, 142.11, 170.04, 131.50, 158.20, 118.75];
/** APPLE.COM/BILL: 8 charges, sd exactly 0. */
const APPLE_HISTORY = [9.99, 9.99, 9.99, 9.99, 9.99, 9.99];

describe('the four cases that must be right together', () => {
  it('1. AUTO-APPLIES the payroll card — 25 prior links and an ordinary amount', () => {
    // "it should be obvious and not have prompted me again after the first time"
    expect(autoApplyDecision({
      linkedCount: 25, conflictingCount: 0,
      amount: 815.75, targetAmount: 848.46, history: PAYROLL_HISTORY,
    })).toEqual({ verdict: 'auto', reason: 'confident' });
  });

  it('2. AUTO-APPLIES the variable utility — varying is NORMAL for it', () => {
    // "it properly suggests it, I shouldn't have to select that"
    expect(autoApplyDecision({
      linkedCount: 6, conflictingCount: 0,
      amount: 131.50, targetAmount: 170, history: ELECTRICITY_HISTORY,
    }).verdict).toBe('auto');
  });

  it('3. AUTO-APPLIES an already-categorized merchant from the 28-charge batch', () => {
    // "this section shouldn't exist. it should auto apply"
    expect(autoApplyDecision({
      linkedCount: 10, conflictingCount: 0,
      amount: 51.88, targetAmount: null, history: [51.88, 60.12, 44.90, 58.30, 49.10, 55.02],
    }).verdict).toBe('auto');
  });

  it('4. STILL REFUSES $15 against the $1,100 rent rule — and REFUSES, not asks', () => {
    // The pairing that started all of this. `never`, because a suggestion the app can see is wrong
    // should not reach a human at all — putting it to them as a question is how it got accepted.
    expect(autoApplyDecision({
      linkedCount: 12, conflictingCount: 0,
      amount: 15, targetAmount: 1100, history: [1100, 1094, 1100, 350, 600, 150],
    })).toEqual({ verdict: 'never', reason: 'implausible-amount' });
  });
});

describe('the anomalies he named himself', () => {
  it('asks when the same merchant was charged twice in the period', () => {
    // "oh, I was charged twice or something like that in the same month"
    expect(autoApplyDecision({
      linkedCount: 25, conflictingCount: 0,
      amount: 815.75, targetAmount: 848.46, history: PAYROLL_HISTORY,
      duplicateThisPeriod: true,
    })).toEqual({ verdict: 'ask', reason: 'duplicate-this-period' });
  });

  it('asks when the amount is far out of line FOR THAT MERCHANT', () => {
    // "the difference is just so large that it makes sense to confirm and verify"
    expect(autoApplyDecision({
      linkedCount: 25, conflictingCount: 0,
      amount: 220.90, targetAmount: 848.46, history: PAYROLL_HISTORY,
    })).toEqual({ verdict: 'ask', reason: 'unusual-for-this-merchant' });
  });

  it('asks when the merchant has been linked two different ways', () => {
    expect(autoApplyDecision({
      linkedCount: 25, conflictingCount: 2,
      amount: 815.75, targetAmount: 848.46, history: PAYROLL_HISTORY,
    })).toEqual({ verdict: 'ask', reason: 'conflicting-history' });
  });

  it('asks when it is not yet a habit', () => {
    expect(autoApplyDecision({
      linkedCount: MIN_LINKS_TO_AUTO_APPLY - 1, conflictingCount: 0,
      amount: 815.75, targetAmount: 848.46, history: PAYROLL_HISTORY,
    })).toEqual({ verdict: 'ask', reason: 'too-few-links' });
  });
});

describe('isOrdinaryForMerchant — why a fixed tolerance cannot work', () => {
  it('A CONSTANT merchant treats ANY change as unusual', () => {
    // Apple.com is $9.99 every month, sd exactly 0. A z-score would divide by zero and say nothing
    // useful; the fallback is exact agreement, which is what a person would expect.
    expect(isOrdinaryForMerchant(9.99, APPLE_HISTORY)).toBe(true);
    expect(isOrdinaryForMerchant(19.99, APPLE_HISTORY)).toBe(false);
    expect(isOrdinaryForMerchant(10.99, APPLE_HISTORY)).toBe(false);
  });

  it('A VARIABLE merchant tolerates a wide swing — the same rule, opposite answer', () => {
    // This is the point. $118 and $170 are both ordinary for electricity and would both be far
    // outside any tolerance tight enough to catch the Apple case above.
    expect(isOrdinaryForMerchant(118.75, ELECTRICITY_HISTORY)).toBe(true);
    expect(isOrdinaryForMerchant(170.04, ELECTRICITY_HISTORY)).toBe(true);
  });

  it('DOES NOT JUDGE on a history too short to judge from', () => {
    // Fewer than MIN_HISTORY_FOR_OUTLIER points cannot say what normal is, so it declines rather
    // than computing a confident sd from three numbers.
    const tiny = [10, 10, 10];
    expect(tiny.length).toBeLessThan(MIN_HISTORY_FOR_OUTLIER);
    expect(isOrdinaryForMerchant(9999, tiny)).toBe(true);
  });

  it('sits where UNUSUAL_SD says, on both sides', () => {
    // mean 100, sd 10 — so the line is at 100 ± 25.
    const h = [90, 95, 100, 105, 110, 100];
    const mean = h.reduce((a, b) => a + b, 0) / h.length;
    const sd = Math.sqrt(h.reduce((s, x) => s + (x - mean) ** 2, 0) / (h.length - 1));
    expect(isOrdinaryForMerchant(mean + UNUSUAL_SD * sd - 0.5, h)).toBe(true);
    expect(isOrdinaryForMerchant(mean + UNUSUAL_SD * sd + 0.5, h)).toBe(false);
  });
});
