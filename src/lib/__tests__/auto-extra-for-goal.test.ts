// `autoExtraForGoalAtMonth` — one goal's ranked extra across every stop of a staged plan.
//
// The trap this closes: a goal is not always one target. `stopRowId` gives stop 1 the goal's own id
// and every later stop `${goalId}::stopN`, so a `map.get(goalId)` lookup reads $0 the moment a
// staged goal moves past its first stop — and the surface then prints nothing while real money is
// arriving. Tre's own move fund is exactly a staged goal ("Move fund, then emergency fund").

import { describe, it, expect } from 'vitest';
import { autoExtraForGoalAtMonth, autoExtraSeriesForGoal, nextAutoExtraForGoal } from '../auto-extra-projection';
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

// The Savings Growth chart and the goal ETA both take ONE array per goal (`extraByMonth`), so the
// staged-goal blind spot lands there as a line drawn without the money later stops receive.
describe('autoExtraSeriesForGoal', () => {
  it('returns the plain goal id series untouched', () => {
    expect(autoExtraSeriesForGoal(new Map([[GOAL, [510, 0, 120]]]), GOAL)).toEqual([510, 0, 120]);
  });

  it('WOULD-FAIL PROOF: sums every stop of a staged plan, month for month', () => {
    const map = new Map([
      [stopRowId(GOAL, 1), [300, 0, 0]],
      [stopRowId(GOAL, 2), [200, 450, 0]],
      [stopRowId(GOAL, 3), [0, 50, 75]],
    ]);
    // What the old call did — stop 1's array alone, blind to every later stop:
    expect(map.get(GOAL)).toEqual([300, 0, 0]);
    expect(autoExtraSeriesForGoal(map, GOAL)).toEqual([500, 500, 75]);
  });

  it('pads to the longest series and never picks up a lookalike id', () => {
    const map = new Map([
      [`${GOAL}-2`, [999, 999, 999, 999]],
      ['card-xyz', [999, 999]],
      [stopRowId(GOAL, 1), [40]],
      [stopRowId(GOAL, 2), [0, 0, 60]],
    ]);
    expect(autoExtraSeriesForGoal(map, GOAL)).toEqual([40, 0, 60]);
  });

  it('returns undefined for an unknown goal and an empty id — the untouched chart', () => {
    const map = new Map([[GOAL, [510]]]);
    expect(autoExtraSeriesForGoal(map, 'nobody')).toBeUndefined();
    expect(autoExtraSeriesForGoal(map, '')).toBeUndefined();
    expect(autoExtraSeriesForGoal(new Map(), GOAL)).toBeUndefined();
  });

  it('agrees with the per-month lookup at every index', () => {
    const map = new Map([
      [stopRowId(GOAL, 1), [300, 0, 0]],
      [stopRowId(GOAL, 2), [200, 450, 0]],
    ]);
    const series = autoExtraSeriesForGoal(map, GOAL) ?? [];
    series.forEach((v, i) => expect(v).toBe(autoExtraForGoalAtMonth(map, GOAL, i)));
  });
});

// The month with no extra is the one a surface goes silent in, and silence reads as "this never
// happens". On Tre's live data 2026-08-27 month 0 has no surplus at all while 40 of the next 60
// months do — the first being $168 in month 12.
describe('nextAutoExtraForGoal', () => {
  it('finds the first month ahead that takes an extra, and says which', () => {
    const map = new Map([[GOAL, [0, 0, 0, 168, 0, 200]]]);
    expect(nextAutoExtraForGoal(map, GOAL)).toEqual({ monthIndex: 3, amount: 168 });
  });

  it('skips the current month by default — it is the month the caller already states', () => {
    const map = new Map([[GOAL, [510, 0, 120]]]);
    expect(nextAutoExtraForGoal(map, GOAL)).toEqual({ monthIndex: 2, amount: 120 });
    // ...and looks at it when asked to.
    expect(nextAutoExtraForGoal(map, GOAL, 0)).toEqual({ monthIndex: 0, amount: 510 });
  });

  it('sees a staged goal past stop 1, exactly as the per-month lookup does', () => {
    const map = new Map([[stopRowId(GOAL, 2), [0, 0, 800]]]);
    expect(map.get(GOAL)).toBeUndefined();
    expect(nextAutoExtraForGoal(map, GOAL)).toEqual({ monthIndex: 2, amount: 800 });
  });

  it('sums stops landing in the same month', () => {
    const map = new Map([
      [stopRowId(GOAL, 1), [0, 40]],
      [stopRowId(GOAL, 2), [0, 60]],
    ]);
    expect(nextAutoExtraForGoal(map, GOAL)).toEqual({ monthIndex: 1, amount: 100 });
  });

  it('returns null when no month ahead has one, for an unknown goal, and for an empty id', () => {
    expect(nextAutoExtraForGoal(new Map([[GOAL, [510, 0, 0]]]), GOAL)).toBeNull();
    expect(nextAutoExtraForGoal(new Map([[GOAL, [0, 168]]]), 'nobody')).toBeNull();
    expect(nextAutoExtraForGoal(new Map([[GOAL, [0, 168]]]), '')).toBeNull();
  });
});
