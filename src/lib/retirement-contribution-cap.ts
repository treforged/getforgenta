/**
 * THE ANNUAL IRA CAP, AND LEVEL MONTHLY CONTRIBUTIONS.
 *
 * Tre, 2026-08-26: *"roth IRA has a max contribution per year, that should be auto capped each year
 * between the legal time frame"* and, in the same breath, *"but make the payments consistent so
 * users can set up auto transfer and forget about it."*
 *
 * Those are two rules, and the second is the one that changes what the app does. A waterfall fills
 * the highest unfinished target as fast as the surplus allows, so a capped IRA gets $2,400 in
 * January, $2,400 in February, $2,200 in March and nothing for nine months. That is a correct total
 * and a useless instruction: nobody can set up a standing transfer against it. Levelling spreads
 * what is left of the year's allowance evenly over the months that are left, so the answer is a
 * figure a person can type into their bank once and forget.
 *
 * Pure: no database, no clock, no engine. The date arrives as an argument.
 *
 * ⚠️ {@link levelMonthlyToDate} OUTGREW THIS FILE'S TITLE and deliberately was not moved. It is the
 * second rule above — level a remaining need over the months until a date — and that question is
 * asked by every dated target, not just an investing one. Generalising the function the IRA rule
 * already sits beside keeps ONE model of "what does this need per month"; a second copy in a
 * savings module is how two answers to the same question start disagreeing.
 *
 * ── WHAT IS DELIBERATELY NOT MODELLED ────────────────────────────────────────
 *
 * **401(k) and HSA are not capped here.** They have their own, different statutory limits, and one
 * of them (the 401k elective deferral) is a payroll figure this app never sees. Applying the IRA
 * number to them would be a fabricated constraint on a real person's money, which is worse than no
 * constraint at all. Only `roth_ira` and `ira` are capped.
 *
 * **The Jan 1 – Apr 15 carry-back is not modelled.** A contribution made in the first months of a
 * year may legally be ELECTED to count against the previous tax year, but the election is the
 * account holder's and this app has no record of it. Contributions are therefore attributed to the
 * calendar year they are made in — the conservative reading, because it can only ever hold a user
 * back from over-contributing, never push them past the limit. {@link IRA_CARRY_BACK_NOTE} is the
 * sentence the UI shows so the user knows the app is not counting that window for them.
 *
 * **Catch-up contributions are not modelled.** The higher limit for savers aged 50+ needs a date of
 * birth the app does not hold, and guessing it either denies a real allowance or invents one.
 */

/** Account types the IRA annual limit actually governs. */
const IRA_ACCOUNT_TYPES = new Set(['roth_ira', 'ira']);

/**
 * The IRA annual contribution limit this app plans against.
 *
 * ⚠️ ONE DEFINITION, and this is it. `SavingsGoals.tsx` had its own `ROTH_IRA_LIMIT = 7000` for the
 * lump-sum panel; two copies of a statutory number is exactly the shape that goes stale in one place
 * and not the other, so that one now reads this.
 */
export const IRA_ANNUAL_LIMIT = 7000;

/** What the UI says about the window this module does not model. One sentence, so it fits a row. */
export const IRA_CARRY_BACK_NOTE =
  'Counted by calendar year. If you mean a contribution to count against last tax year, tell your '
  + 'provider — we cannot see that election.';

/** True when a goal's contributions are governed by the IRA annual limit. */
export function isIraCapped(accountType: string | null | undefined): boolean {
  return accountType != null && IRA_ACCOUNT_TYPES.has(accountType);
}

/**
 * How much of a calendar year is left to contribute in, counting the given month.
 *
 * December is 1, not 0: money can still go in this month. That off-by-one is the difference between
 * a level figure and a division by zero.
 */
export function monthsLeftInYear(month: number): number {
  const m = Math.trunc(Number(month));
  if (!Number.isFinite(m) || m < 0 || m > 11) return 1;
  return 12 - m;
}

/**
 * THE LEVEL MONTHLY FIGURE: what may go in THIS month so that the rest of the year's allowance is
 * spread evenly over the months that are left.
 *
 * `alreadyContributed` is what has gone in this calendar year already, from every source — the
 * goal's own standing transfer and any ranked extra alike. They fill the same allowance, so counting
 * only one of them would let the pair breach the limit together while each looked compliant.
 *
 * Returns 0 once the year is used up, which the waterfall already reads as "pass these dollars to
 * the next rank".
 */
export function levelMonthlyAllowance(params: {
  annualCap: number;
  alreadyContributed: number;
  /** 0 = January. */
  month: number;
}): number {
  const cap = Number(params.annualCap);
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  const used = Math.max(0, Number(params.alreadyContributed) || 0);
  const left = cap - used;
  if (left <= 0) return 0;
  return left / monthsLeftInYear(params.month);
}

/**
 * Whole months from `from` to a stored `YYYY-MM-DD` date, counting CALENDAR MONTHS, so 0 means "the
 * same month" and a past date is negative. `null` for anything that is not a readable date, which
 * {@link levelMonthlyToDate} reads as "no date, nothing to spread over".
 *
 * ⚠️ Parsed at NOON-free local midnight (`T00:00:00`) and compared by year and month only, so the
 * day of the month and the timezone can never move the answer by a month. That is the same bug that
 * once deleted a paycheck landing on its own end date.
 */
export function monthsUntilTargetDate(
  targetDate: string | null | undefined, from: Date,
): number | null {
  if (typeof targetDate !== 'string' || targetDate.length < 7) return null;
  const t = new Date(`${targetDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(t.getTime())) return null;
  return (t.getFullYear() - from.getFullYear()) * 12 + (t.getMonth() - from.getMonth());
}

/**
 * THE SAME LEVELLING FOR ANY DATED TARGET — "only take exactly what it needs to reach the goal on
 * time". It began as the no-ceiling twin of the IRA rule ("same auto transfer concept for investing
 * but dont cap it", Tre 2026-08-26) and is now what every dated target is paced by, whatever it is
 * saving for: a move fund, a down payment, a stop inside a staged plan.
 *
 * There is no statutory ceiling to spread, so what gets spread is the target's own remaining need
 * across the months until its own date. A target with no date has nothing to spread over and is
 * returned UNCAPPED (`Infinity`), which leaves the waterfall exactly as it was — the levelling is
 * an answer to "by when", and without a date there is no question.
 *
 * ⚠️ THE DATE'S OWN MONTH COUNTS (`months + 1`). A target due this month is due IN FULL now, and a
 * target eleven months out is spread over twelve payments, the last of which lands in the month it
 * is wanted. Self-correcting month to month: a month that underfunds leaves a bigger need over
 * fewer months, so the next month's level figure rises to make it up.
 *
 * ⚠️ `Infinity` rather than a big number, and rather than the remaining need. The caller takes a
 * `Math.min` against real capacity, so an unbounded allowance has to be a value that cannot win that
 * comparison; returning the remaining need instead would silently re-impose a one-month-fill.
 */
export function levelMonthlyToDate(params: {
  remainingNeed: number;
  /** Months from now until the target's own date, 0 = this month. Null when it has no date. */
  monthsUntilDate: number | null;
}): number {
  const need = Number(params.remainingNeed);
  if (!Number.isFinite(need) || need <= 0) return 0;
  const months = params.monthsUntilDate;
  if (months == null || !Number.isFinite(Number(months))) return Number.POSITIVE_INFINITY;
  // A date already reached, or reached this month, cannot be spread: the whole need is due now.
  const spread = Math.max(1, Math.trunc(Number(months)) + 1);
  return need / spread;
}
