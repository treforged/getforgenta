// `autoExtraForGoalAtMonth` — one goal's ranked extra across every stop of a staged plan.
//
// The trap this closes: a goal is not always one target. `stopRowId` gives stop 1 the goal's own id
// and every later stop `${goalId}::stopN`, so a `map.get(goalId)` lookup reads $0 the moment a
// staged goal moves past its first stop — and the surface then prints nothing while real money is
// arriving. Tre's own move fund is exactly a staged goal ("Move fund, then emergency fund").

import { describe, it, expect } from 'vitest';
import { autoExtraForGoalAtMonth } from '../auto-extra-projection';
import { stopRowId } from '../ranked-extra-payment-targets';

const GOAL = 'goal-abc';

describe('autoExtraForGoalAtMonth', () => {
  it('reads the plain goal id — stop 1 of a staged plan, and every unstaged goal', () => {
    expect(stopRowId(GOAL, 1)).toBe(GOAL);
    const map = new Map([[GOAL, [510, 0, 120]]]);
    expect(autoExtraForGoalAtMonth(map, GOAL, 0)).toBe(510);
    expect(autoExtraForGoalAtMonth(map, GOAL, 2)).toBe(120);
  });

  it('WOULD-FAIL PROOF: a later stop is invisible to a bare goal-id lookup', () => {
    const laterStop = stopRowId(GOAL, 2);
    expect(laterStop).toBe(`${GOAL}::stop2`);
    const map = new Map([[laterStop, [800, 800]]]);
    // What the old call did:
    expect(map.get(GOAL)?.[0] ?? 0).toBe(0);
    // What it does now:
    expect(autoExtraForGoalAtMonth(map, GOAL, 0)).toBe(800);
  });

  it('sums stops funded in the same month rather than taking one of them', () => {
    const map = new Map([
      [stopRowId(GOAL, 1), [300, 0]],
      [stopRowId(GOAL, 2), [200, 450]],
      [stopRowId(GOAL, 3), [0, 50]],
    ]);
    expect(autoExtraForGoalAtMonth(map, GOAL, 0)).toBe(500);
    expect(autoExtraForGoalAtMonth(map, GOAL, 1)).toBe(500);
  });

  it('never picks up another target whose id merely starts the same way', () => {
    // A different goal, and a card. Only `::stop` — the one separator `stopRowId` emits — counts.
    const map = new Map([
      [`${GOAL}-2`, [999, 999]],
      ['card-xyz', [999, 999]],
      [stopRowId(GOAL, 1), [40, 40]],
    ]);
    expect(autoExtraForGoalAtMonth(map, GOAL, 0)).toBe(40);
  });

  it('returns 0 for an unknown goal, an empty id, and a month past the end', () => {
    const map = new Map([[GOAL, [510]]]);
    expect(autoExtraForGoalAtMonth(map, 'nobody', 0)).toBe(0);
    expect(autoExtraForGoalAtMonth(map, '', 0)).toBe(0);
    expect(autoExtraForGoalAtMonth(map, GOAL, 7)).toBe(0);
  });
});
