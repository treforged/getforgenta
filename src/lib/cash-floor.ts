/**
 * How much cash the app refuses to spend down to — one definition, six readers.
 *
 * Tre, 2026-08-21: *"give users the option to turn off a manual cashfloor and just have the system
 * automatically calculate for them each month. have it off by default."*
 *
 * ── WHAT "AUTOMATIC" ACTUALLY MEANS ──────────────────────────────────────────
 * It is NOT a new estimate. `getMinSafeCash` already computes
 * `max(cashFloor, prePaycheckBills)` — the bills that must clear before the next paycheck have
 * always been part of the floor. All automatic mode does is stop adding a hand-typed number on top
 * of them, so the floor becomes exactly "keep enough for the bills that land before you get paid
 * again", recomputed every month from the user's own rules.
 *
 * That matters because it means automatic invents nothing. There is no buffer constant here, no
 * "one month of expenses" heuristic, no percentage. Every dollar of an automatic floor traces to a
 * recurring rule the user entered and a payday the pay schedule knows about. A floor nobody can
 * source is exactly the confident number this codebase refuses to print.
 *
 * ── WHY MANUAL IS OFF BY DEFAULT ─────────────────────────────────────────────
 * 42 of 46 live profiles sat on `cash_floor = 1000` on 2026-08-21 — the column default, which is to
 * say they never chose it. Treating an untouched default as a deliberate instruction is how an app
 * ends up defending a number its user never picked. The four who DID type a figure keep it stored:
 * flipping the toggle back restores it exactly, because automatic mode reads `cash_floor` as 0
 * rather than overwriting it.
 *
 * ⚠️ NEVER ZERO `cash_floor` WHEN SWITCHING TO AUTOMATIC. The column is the user's saved preference,
 * not the value in force. Clearing it would make the toggle a one-way door.
 *
 * Pure: no database, no clock, no React.
 */

/** The `profiles` columns this reads. Structurally satisfied by the profile row. */
export type CashFloorSettings = {
  cash_floor?: number | string | null;
  /** FALSE (the default, and every pre-2026-08-21 row) ⇒ automatic. */
  cash_floor_is_manual?: boolean | null;
};

/** The manual floor a profile falls back to when it has never stored one. */
export const DEFAULT_MANUAL_CASH_FLOOR = 1000;

/**
 * The floor to hand the engine.
 *
 * Automatic ⇒ **0**, which is not "no floor": `getMinSafeCash` takes the greater of this and the
 * pre-paycheck bills, so the effective floor is the bills figure. Passing 0 is how this module says
 * "contribute nothing of your own and let the measured bills decide".
 *
 * Manual ⇒ the stored figure, or `DEFAULT_MANUAL_CASH_FLOOR` when the column is empty or unusable.
 */
export function resolveCashFloor(profile: CashFloorSettings | null | undefined): number {
  if (!isManualCashFloor(profile)) return 0;
  return readStoredFloor(profile?.cash_floor) ?? DEFAULT_MANUAL_CASH_FLOOR;
}

/**
 * The stored figure, or null when there is none.
 *
 * ⚠️ NULL AND ZERO ARE DIFFERENT ANSWERS and `Number()` collapses them: `Number(null) === 0`. An
 * empty column means "never set" and must fall back to the default, while a stored 0 is a user
 * saying "spend me down to nothing" and must be honoured exactly. Checking emptiness BEFORE the
 * numeric conversion is the only way to keep them apart.
 */
function readStoredFloor(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Whether the user has taken the floor over by hand. Absent / null ⇒ false ⇒ automatic. */
export function isManualCashFloor(profile: CashFloorSettings | null | undefined): boolean {
  return profile?.cash_floor_is_manual === true;
}

/**
 * The number to SHOW in the manual input, whichever mode is in force.
 *
 * Deliberately not `resolveCashFloor`: the input must keep displaying the user's saved figure while
 * automatic mode is on, or switching back would appear to lose it.
 */
export function displayedManualCashFloor(profile: CashFloorSettings | null | undefined): number {
  return readStoredFloor(profile?.cash_floor) ?? DEFAULT_MANUAL_CASH_FLOOR;
}
