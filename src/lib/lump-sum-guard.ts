/**
 * WHY MANUAL LUMP SUMS TURN OFF WHEN AUTO-EXTRA IS ON — AND WHY IT IS **NOT** ABOUT CORRECTNESS.
 *
 * Tre, 2026-09-05: *"lump sum transfers should only be available when the auto extra goal is
 * disabled."* He was protecting against a double-count: auto-extra sweeps surplus on a schedule
 * and a lump sum moves it by hand, so counting both against the same dollars would show money
 * spent twice.
 *
 * ⚠️ **THAT DOUBLE-COUNT DOES NOT HAPPEN, AND IT WAS MEASURED RATHER THAN ASSUMED.**
 * `forecast-engine.lumpSumDoubleCount.test.ts` holds auto-extra ON in both arms and varies only
 * the lump sum: auto-extra drops by exactly the lump amount, **ending cash is unchanged to the
 * cent**, and the amount is still reported on its own line. The goal receives the same total
 * either way; only the ROUTE changes. So the restriction buys nothing for correctness.
 *
 * ⚠️ **KEEP IT ANYWAY, FOR THE OTHER REASON.** With auto-extra on, entering a lump sum changes
 * neither cash nor the goal's total — it relabels part of a sweep that was already happening.
 * Somebody who types one in and watches every number stay put has met a **control that appears to
 * do nothing**, which is the failure this repo keeps finding, arriving from the opposite
 * direction. Disabling it with a sentence saying where the money already goes is honest; leaving
 * it enabled and inert is not.
 *
 * ⚠️ **ONE COPY, TWO SURFACES.** There are two lump-sum panels — `LumpSumPanel` (vehicles: loans
 * and savings cards) and `GoalLumpSumPanel` (the Savings Goals page). Until 2026-09-06 only the
 * first carried the guard; the Savings Goals page did not mention `auto_extra` at all, so a goal
 * with the sweep switched on still offered an Add button that would do nothing visible. The
 * message lives here so the two cannot say different things about the same rule.
 */

/** Shown in place of the Add control when the sweep already handles this target. */
export const LUMP_SUM_AUTO_EXTRA_NOTE =
  'Extra payments here are handled automatically from your left-over cash, so manual ones are ' +
  'turned off. Change that under "Where the extra money goes".';

/**
 * Whether manual lump sums are blocked for a target.
 *
 * ⚠️ Takes the target's PERSISTED `auto_extra` switch, not whether the waterfall happened to send
 * money this month. A sweep that reached zero this month is still on, and a control that
 * flickered between enabled and disabled month to month would be worse than either state.
 * Anything that is not exactly `true` reads as off, so a missing or unreadable flag leaves the
 * control available rather than silently taking it away.
 */
export function lumpSumsBlocked(autoExtra: boolean | null | undefined): boolean {
  return autoExtra === true;
}
