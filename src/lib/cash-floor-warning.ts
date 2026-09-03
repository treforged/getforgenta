/**
 * "You will not meet your cash floor, and here is why."
 *
 * Tre, 2026-08-27: *"it just lets the user know a not meeting the cash floor is
 * inevitable and to check cash floor."*
 *
 * WHY THIS READS THE CONVERGED OUTPUT AND NOTHING ELSE. The debt page runs its
 * own simulation with a crude floor-protection prepass, and `floor-protection.ts`
 * already records what that costs: its heuristic once reported a $2,443 Prime
 * Visa reserve as "$200 Pay sibling to watch dogs", because it infers a cause
 * from whatever else is happening that month. `saveUpReason` is the opposite —
 * it names the mandatory outflow that ACTUALLY sized the reserve, and the engine
 * prefers it over every heuristic. A warning is only worth showing if the reason
 * attached to it is true, so this reads that map and declines to guess when it
 * is empty.
 */

export interface FloorWarningInput {
  /** `projections.data` from the converged run — needs `month` and `belowSafeMinimum`. */
  months: readonly { month: string; belowSafeMinimum?: boolean }[];
  /** `cardProjection.saveUpReason` — month index to the event that sized the reserve. */
  saveUpReason?: ReadonlyMap<number, { eventName: string; monthLabel: string }>;
}

export interface FloorWarning {
  /** Index of the first month projected below its own safe minimum. */
  monthIndex: number;
  monthLabel: string;
  /** The named cause, when the engine knows one. Null means do not invent one. */
  cause: string | null;
  message: string;
}

/**
 * The FIRST month below its safe minimum, or null when every month clears it.
 *
 * First, not worst: a person acts on the nearest problem, and a warning about
 * month 14 while month 2 is also short would send them to the wrong place.
 */
export function buildCashFloorWarning(input: FloorWarningInput): FloorWarning | null {
  const idx = input.months.findIndex(m => m.belowSafeMinimum === true);
  if (idx === -1) return null;

  const monthLabel = input.months[idx].month;

  // The reason for a shortfall in month N is recorded against the month that has
  // to SAVE UP for it, which is an earlier one. So take the nearest reason at or
  // before this month rather than requiring an exact hit.
  //
  // ⚠️ A MONTH-0 SHORTFALL THEREFORE HAS NO CAUSE, and that is not a bug to work
  // around: you cannot save up for a month that has already arrived, so no
  // `saveUpReason` is ever recorded against index 0. Verified live on 2026-09-03 —
  // the app showed a month-0 breach with the earliest reason at month 5, so the
  // message correctly fell back to the plain statement. The fixture happened to
  // breach at month 1 with a reason at month 0, which is why the named form looked
  // universal in testing and is not.
  //
  // Naming a cause anyway from the nearest LATER reason would be the exact defect
  // this file exists to avoid: attributing this month's shortfall to next spring's
  // expense. Better to say less.
  let cause: string | null = null;
  if (input.saveUpReason) {
    for (let m = idx; m >= 0; m--) {
      const r = input.saveUpReason.get(m);
      if (r) { cause = r.eventName; break; }
    }
  }

  const message = cause
    ? `Cash is projected below your safe minimum in ${monthLabel}, because of ${cause}. `
      + `Paying less to your cards will not fix it — check your cash floor.`
    // No named cause, so say only what is known. "Something is wrong somewhere" is
    // worse than a plain statement of the fact.
    : `Cash is projected below your safe minimum in ${monthLabel}. Check your cash floor.`;

  return { monthIndex: idx, monthLabel, cause, message };
}
