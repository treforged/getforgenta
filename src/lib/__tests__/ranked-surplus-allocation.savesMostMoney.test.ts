import { describe, it, expect } from 'vitest';
import { allocateRankedSurplus, type RankedTarget } from '../ranked-surplus-allocation';

/**
 * A SPLIT RANK SENDS THE SPARE MONEY WHERE IT SAVES THE MOST, WITHOUT MISSING THE GOAL'S DATE.
 *
 * Tre, 2026-09-17: *"we should always go in favor of what saves the user the most money so that's
 * how it should be calculated/coded."* Said while approving a due-date weighting between his Prime
 * Visa and the "Move fund, then emergency fund" goal, which share rank 1 at 50/50.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE BEHAVIOUR TURNED OUT TO BE ALREADY BUILT, AND "already built" is
 * a claim that has been wrong in this repo before in BOTH directions. It is pinned here so it
 * cannot be refactored away by someone who reads the 50/50 share and assumes a literal half.
 *
 * HOW IT ALREADY WORKS, in two parts that only make sense together:
 *   - the goal carries a `maxExtra` - its ON-TRACK PACE, `remainingNeed / monthsLeft` - so it can
 *     never take more than the date actually requires, however big the month is;
 *   - and the rank's leftovers cascade WITHIN the rank before falling to a lower one, so the half
 *     the goal cannot spend goes to its split partner rather than to whatever is ranked below.
 *
 * Together those ARE "save the most money": every dollar the goal does not need this month to stay
 * on schedule lands on the card instead, killing interest at 29.99% rather than sitting in a fund
 * that is already on pace. And it cannot cost the goal its date, because it never takes the goal
 * below its own pace while the cash is there.
 *
 * ⚠️ WHAT THIS DOES NOT SAY. It is not a claim that the SPLIT WEIGHT is chosen to save money - the
 * weight is still whatever the user set. It is a claim about what happens to money the goal cannot
 * use. A rank where the goal's pace is larger than its share behaves like an ordinary 50/50 split,
 * and the third arm below pins exactly that.
 */

const card = (over: Partial<RankedTarget> = {}): RankedTarget => ({
  id: 'prime-visa', kind: 'card', sortOrder: 1, minimum: 0, capacity: 6000, share: 50, ...over,
});

/** The goal's `maxExtra` is its on-track pace: 5623.56 still needed over 10 months. */
const ON_TRACK_PACE = 562.36;

const goal = (over: Partial<RankedTarget> = {}): RankedTarget => ({
  id: 'move-fund', kind: 'goal', sortOrder: 1, minimum: 0, capacity: 5623.56,
  maxExtra: ON_TRACK_PACE, share: 50, ...over,
});

const by = (r: ReturnType<typeof allocateRankedSurplus>, id: string) =>
  r.allocations.find(a => a.id === id)!.extra;

describe('a shared rank sends spare money where it saves the most', () => {
  it('a RICH month gives the goal only its pace and the card everything else', () => {
    // A literal 50/50 would hand the goal 1000. Its date only needs 562.36.
    const pool = 2000;
    const r = allocateRankedSurplus(pool, [card(), goal()]);
    expect(by(r, 'move-fund')).toBeCloseTo(ON_TRACK_PACE, 2);
    expect(by(r, 'prime-visa')).toBeCloseTo(pool - ON_TRACK_PACE, 2);
    // Nothing is destroyed and nothing leaks to a lower rank.
    expect(by(r, 'move-fund') + by(r, 'prime-visa') + r.unallocated).toBeCloseTo(pool, 2);
  });

  it('CONTROL: without the pace ceiling the same month really would split 50/50', () => {
    // The contrast is the evidence. If this also returned 562.36 the arm above would be measuring
    // the pool, not the ceiling.
    const pool = 2000;
    const r = allocateRankedSurplus(pool, [card(), goal({ maxExtra: undefined })]);
    expect(by(r, 'move-fund')).toBeCloseTo(1000, 2);
    expect(by(r, 'prime-visa')).toBeCloseTo(1000, 2);
  });

  it('a TIGHT month does NOT rob the goal - its half is smaller than its pace, and it keeps it', () => {
    // 50% of 600 is 300, below the 562.36 pace, so the ceiling never binds and the split is honest.
    // This is what stops "save the most money" being read as "the card always wins".
    const pool = 600;
    const r = allocateRankedSurplus(pool, [card(), goal()]);
    expect(by(r, 'move-fund')).toBeCloseTo(300, 2);
    expect(by(r, 'prime-visa')).toBeCloseTo(300, 2);
  });

  it('once the CARD IS PAID OFF the goal keeps its own pace and the rest is not forced onto it', () => {
    // Self-limiting: with no card left there is no interest to save, and the goal still may not
    // take more than its date requires - the surplus goes back to the caller for lower ranks.
    const pool = 2000;
    const r = allocateRankedSurplus(pool, [card({ capacity: 0 }), goal()]);
    expect(by(r, 'prime-visa')).toBeCloseTo(0, 2);
    expect(by(r, 'move-fund')).toBeCloseTo(ON_TRACK_PACE, 2);
    expect(r.unallocated).toBeCloseTo(pool - ON_TRACK_PACE, 2);
  });
});
