// Lifts the forecast engine's per-target ranked automatic extra off its projection rows and
// turns it into the month-indexed array `savings-growth.ts` consumes.
//
// It exists so the Goals page's "Savings Growth Projection" chart shows the SAME dollars the
// Forecast diverts when "Auto Extra" is ticked, instead of a second model of the allocation.
// The ranked surplus is not flat — it grows as cards retire and shrinks as goals fill — so a
// flat "extra monthly contribution" would put this chart months away from the Forecast, which is
// the §2.5 disagreement class this codebase has already paid to fix once.

import type { ForecastMonthRow } from './forecast-engine';

/**
 * `rows[i].autoExtraByTarget` re-keyed as `targetId -> extra per month`, index 0 being the
 * current month and the array as long as `rows`.
 *
 * Targets that never take a ranked extra are simply absent, so a caller can treat "no entry" and
 * "all zeros" as the same thing. Only ids that appear somewhere get an array, which keeps the map
 * small in the ordinary case where nothing is opted in.
 */
export function buildAutoExtraByTarget(rows: readonly ForecastMonthRow[]): Map<string, number[]> {
  const byTarget = new Map<string, number[]>();
  rows.forEach((row, i) => {
    for (const [id, amount] of Object.entries(row.autoExtraByTarget ?? {})) {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) continue;
      let months = byTarget.get(id);
      if (!months) {
        months = new Array<number>(rows.length).fill(0);
        byTarget.set(id, months);
      }
      months[i] = value;
    }
  });
  return byTarget;
}

/**
 * One goal's ranked extra in a given month, across EVERY stop of a staged plan.
 *
 * ⚠️ A GOAL IS NOT ALWAYS ONE TARGET. `stopRowId` (ranked-extra-payment-targets.ts) gives stop 1 the
 * goal's own id and every later stop `${goalId}::stopN`, so a lookup by goal id alone goes blind the
 * moment a staged goal moves past its first stop — and the surface then prints nothing where real
 * money is arriving. Matching the id and its stop suffixes is what makes "no extra" mean no extra.
 *
 * Returns 0 for an unknown goal or an out-of-range month, which is the same thing every caller
 * wants: render nothing rather than a figure nobody can source.
 */
export function autoExtraForGoalAtMonth(
  byTarget: ReadonlyMap<string, number[]>,
  goalId: string,
  monthIndex: number,
): number {
  if (!goalId) return 0;
  const stopPrefix = `${goalId}::stop`;
  let total = 0;
  for (const [id, months] of byTarget) {
    if (id !== goalId && !id.startsWith(stopPrefix)) continue;
    total += months[monthIndex] ?? 0;
  }
  return total;
}

/**
 * The FIRST month from `fromMonthIndex` onward in which this goal takes a ranked extra, or null.
 *
 * A surface that only ever states the current month's extra goes silent in a month with none, and
 * silence reads as "this never happens" — on Tre's live data 2026-08-27 month 0 has no surplus at
 * all, while 40 of the next 60 months do, the first being $168 in month 12. Same stop-aware
 * matching as `autoExtraForGoalAtMonth`, because a staged goal's later stops are separate targets.
 *
 * `monthIndex` is an offset from the projection's month 0, so the caller owns turning it into a
 * date — this module has no calendar and inventing one here would be a second source of truth.
 */
export function nextAutoExtraForGoal(
  byTarget: ReadonlyMap<string, number[]>,
  goalId: string,
  fromMonthIndex = 1,
): { monthIndex: number; amount: number } | null {
  if (!goalId) return null;
  const stopPrefix = `${goalId}::stop`;
  let horizon = 0;
  for (const [id, months] of byTarget) {
    if (id !== goalId && !id.startsWith(stopPrefix)) continue;
    horizon = Math.max(horizon, months.length);
  }
  for (let i = Math.max(0, fromMonthIndex); i < horizon; i++) {
    const amount = autoExtraForGoalAtMonth(byTarget, goalId, i);
    if (amount > 0) return { monthIndex: i, amount };
  }
  return null;
}
