// The forecast trimming a goal's contribution is the app spending Tre's money differently from
// the plan it shows him. These pin both what that detection reports AND what it deliberately
// does not, because the second half is the part somebody will try to "fix" into a cry-wolf.
import { describe, it, expect } from 'vitest';
import {
  findContributionShortfalls,
  describeShortfall,
  type ShortfallRow,
} from '../goal-contribution-shortfall';

const GOAL = 'move-fund-id';
const row = (month: string, items: { goalId?: string; amount: number }[]): ShortfallRow =>
  ({ month, savingsGoalItems: items });

// His real shape, measured 2026-09-18: configured $510/mo, trimmed to $279 in November.
const REAL: ShortfallRow[] = [
  row('Aug 2026', [{ goalId: GOAL, amount: 510 }]),
  row('Sep 2026', []),                                   // nothing at all - see the absence test
  row('Oct 2026', [{ goalId: GOAL, amount: 510 }]),
  row('Nov 2026', [{ goalId: GOAL, amount: 279 }]),
  row('Dec 2026', [{ goalId: GOAL, amount: 510 }]),
];

describe('findContributionShortfalls', () => {
  it('finds the trimmed month on his real shape', () => {
    const out = findContributionShortfalls(REAL, GOAL, 510);
    expect(out).toEqual([{ month: 'Nov 2026', planned: 510, actual: 279 }]);
  });

  // POSITIVE CONTROL. Every other assertion here is about finding FEW or NO shortfalls, and a
  // function that always returns [] satisfies all of them perfectly.
  it('a fully-funded plan reports nothing', () => {
    const clean = REAL.filter(r => r.month !== 'Nov 2026');
    expect(findContributionShortfalls(clean, GOAL, 510)).toEqual([]);
  });

  it('ignores other goals in the same month', () => {
    const mixed = [row('Nov 2026', [{ goalId: 'other', amount: 5 }, { goalId: GOAL, amount: 510 }])];
    expect(findContributionShortfalls(mixed, GOAL, 510)).toEqual([]);
  });

  // ⚠️ THE DELIBERATE UNDER-REACH, PINNED SO IT IS A DECISION RATHER THAN A BUG. A month with no
  // row for this goal is NOT reported. Absent is indistinguishable from "not started yet",
  // "already funded" and "trimmed to zero", and reporting it would fire on every month after a
  // goal completes - which is how a warning gets switched off. Sep 2026 in REAL is exactly this.
  it('does NOT report a month where the goal has no line at all', () => {
    expect(findContributionShortfalls(REAL, GOAL, 510).map(s => s.month)).not.toContain('Sep 2026');
  });

  // ⚠️ HALF A CENT, NOT ZERO. These amounts come out of a convergence loop; an exact comparison
  // would report a rounding artefact as the app shortchanging him - a false alarm about money.
  it('a rounding artefact is not a shortfall', () => {
    expect(findContributionShortfalls([row('Nov 2026', [{ goalId: GOAL, amount: 509.999 }])], GOAL, 510)).toEqual([]);
    expect(findContributionShortfalls([row('Nov 2026', [{ goalId: GOAL, amount: 509.99 }])], GOAL, 510)).toHaveLength(1);
  });

  it.each([
    ['no rows', null, GOAL, 510],
    ['no goal id', REAL, null, 510],
    ['no planned amount', REAL, GOAL, 0],
  ])('returns nothing with %s', (_label, rows, goalId, planned) => {
    expect(findContributionShortfalls(rows as ShortfallRow[] | null, goalId as string | null, planned as number)).toEqual([]);
  });
});

describe('describeShortfall', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeShortfall([])).toBeNull();
  });

  it('names the amount, the month and the reason', () => {
    const s = describeShortfall(findContributionShortfalls(REAL, GOAL, 510));
    expect(s).toBe('Forecast trims this to $279 in Nov 2026 to hold your cash floor.');
  });

  // The WORST month, not the first - that is the one that answers "what is this costing me".
  it('reports the worst month across several', () => {
    const many = [
      { month: 'Oct 2026', planned: 510, actual: 400 },
      { month: 'Nov 2026', planned: 510, actual: 279 },
      { month: 'Dec 2026', planned: 510, actual: 450 },
    ];
    expect(describeShortfall(many)).toBe(
      'Forecast trims this in 3 months, as low as $279 in Nov 2026, to hold your cash floor.');
  });
});
