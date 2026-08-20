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
