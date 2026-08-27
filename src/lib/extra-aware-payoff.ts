/**
 * WHICH MONTH AN EXTRA-AWARE BALANCE ARRAY SAYS A DEBT WAS CLEARED IN.
 *
 * Found 2026-08-27, on Tre's own Garage card: it printed "paying this loan off by **Jul 2029**" a
 * few inches above an amortization table whose final payment lands in **Aug 2029** — and the engine
 * itself sends $2,343 of extra principal that August, which it would not send into a loan it had
 * already cleared.
 *
 * ── THE CAUSE: ONE ARRAY, TWO CONVENTIONS ────────────────────────────────────
 *
 * `carLoanBalancesByFundId` / `nonCCLiabilityBalancesById` are SEEDED as the balance a month OPENS
 * at (`schedule[monthsElapsed + i].startBalance`). But `forecast-engine.ts` steps 4c-ii-b/c reduce
 * them from index `i` INCLUSIVE, and deliberately so — a lump sum and a ranked extra have to land
 * in the month the drawer itemises them, or the drawer contradicts itself.
 *
 * So the array means two different things depending on whether an extra has touched an entry:
 *   no extra at i  →  balances[i] is what month i OPENS owing
 *   extra at i     →  balances[i] is what is left AFTER month i's extra
 *
 * Which makes a single constant offset wrong half the time. `firstZero - 1` is right when ordinary
 * amortization runs the balance out (month `firstZero` opened at nothing, so the last payment was
 * the month before) and a month EARLY when an extra is what finished it (the money went in during
 * `firstZero` itself). Three call sites carried that `- 1`; this is the one rule they now share.
 *
 * ⚠️ THE FIX IS HERE, NOT IN THE ENGINE. Changing 4c-ii-b to reduce from `i + 1` would make this
 * function trivial and would also move every drawer line, every `carLoanBreakdown` row and the
 * Forecast's own liability itemisation by a month. The reducer's convention is load-bearing and
 * documented; what was wrong is the reading of it.
 *
 * Pure: no clock, no engine.
 */

/** Half a cent. The engine's reducers clamp with `Math.max(0, …)`, so a cleared balance is an
 *  exact zero — but a seeded one can carry amortization dust, and dust is not a debt. */
const PAID_OFF = 0.005;

/**
 * The month INDEX (0 = this month) the debt is cleared in, or `null` when the array never reaches
 * zero inside the horizon — which is the honest answer for a debt the projection does not retire,
 * and must not be rendered as a date.
 *
 * `extrasByMonth` is what the ranked waterfall actually sent this target, month by month — the same
 * `buildAutoExtraByTarget` array every caller already holds. Omit it and the answer is the
 * un-accelerated reading, which is what an array nothing has touched deserves.
 */
export function extraAwarePayoffMonthIndex(
  balances: readonly number[] | null | undefined,
  extrasByMonth?: readonly number[] | null,
): number | null {
  if (!balances || balances.length === 0) return null;
  const firstZero = balances.findIndex(b => b <= PAID_OFF);
  // `<= 0` and not `< 0`: index 0 reading zero means the debt is already paid, which is not a
  // payoff DATE to print — it is a row that should not be offering one.
  if (firstZero <= 0) return null;
  // Did money actually go in during the month the balance ran out? Then that is the month it was
  // cleared. Otherwise the balance was already gone when the month opened, and the last payment
  // was the month before.
  const extraThatMonth = Number(extrasByMonth?.[firstZero] ?? 0);
  return extraThatMonth > 0 ? firstZero : firstZero - 1;
}
