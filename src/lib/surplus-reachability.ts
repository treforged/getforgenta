/**
 * "Will this actually get there, and if not, by how much does it miss?"
 *
 * The ranked list can say WHERE the surplus goes. It could not say whether the plan works. Live on
 * 2026-08-21 the `Move fund` read "$10,340 to go" — target date 2027-07-01, $0 saved, $0/month
 * scheduled, and ranked below a card block that consumes the whole pool. Every number on the row
 * was true and the row still told the user nothing: it reaches $0 of $10,340 and says so nowhere.
 *
 * Tre's words for the feature were "the app should tell me and have these abilities". This module
 * is the TELL half. It is deliberately separate from the allocator: the allocator decides one
 * month, this reads a whole projected schedule and reports the verdict.
 *
 * ⚠️ IT REPORTS, IT NEVER ESTIMATES. Every figure here comes from a schedule the caller measured —
 * `autoExtraByTarget` off the forecast rows, plus the target's own monthly contribution. Where
 * there is no schedule the verdict is `'unknown'` and the caller must print nothing rather than a
 * confident zero, which is the house rule this codebase already pays for elsewhere: a gauge
 * reading 0% and a gauge that failed to parse look identical.
 *
 * Pure: no database, no clock, no engine. `asOf` arrives as an argument.
 */

/** Half a cent. Below this a residual is rounding noise, not money. */
const CENT = 0.005;

export type ReachabilityVerdict =
  /** No schedule was supplied — say nothing, do not print a zero. */
  | 'unknown'
  /** Nothing left to fund. */
  | 'funded'
  /** No target date, so "late" has no meaning; `monthsToFund` still answers "when". */
  | 'undated'
  /** Fully funded on or before the target date. */
  | 'on_track'
  /** Funded, but after the target date. */
  | 'late'
  /** Not funded at all within the schedule supplied. */
  | 'never';

export type ReachabilityInput = {
  id: string;
  /** What is still needed today, in dollars. */
  remaining: number;
  /** The date it is needed BY, `YYYY-MM-DD`. Null where the concept does not apply. */
  targetDate: string | null;
  /**
   * Dollars this target is projected to receive each month, index 0 being the current month.
   * `undefined` (not an empty array) means nothing was measured — an empty array is a real
   * schedule that funds nothing, and the two must not read the same.
   */
  monthly?: readonly number[];
};

export type Reachability = {
  id: string;
  verdict: ReachabilityVerdict;
  /** Months from now until the need is met, 0 being this month. Null when it never is. */
  monthsToFund: number | null;
  /** The target date as an index into `monthly`, 0 being the current month. Null when undated. */
  targetMonthIndex: number | null;
  /** Dollars funded by the end of the target month. */
  fundedByTargetDate: number;
  /** Dollars still missing at the end of the target month. 0 when it makes it. */
  shortfall: number;
  /** How many months past the target date it lands. Null when on time, undated, or never. */
  monthsLate: number | null;
};

/** Whole calendar months from `asOf`'s month to `date`'s month. Negative when `date` is behind. */
export function monthIndexOf(asOf: string, date: string): number {
  const [ay, am] = asOf.slice(0, 7).split('-').map(Number);
  const [ty, tm] = date.slice(0, 7).split('-').map(Number);
  return (ty - ay) * 12 + (tm - am);
}

/**
 * The verdict for one target.
 *
 * The schedule is walked cumulatively, so a target whose funding grows as cards retire — which is
 * what the ranked allocator actually produces — is measured on the real curve rather than on a
 * flat monthly average. That difference is the whole reason this reads a schedule at all.
 */
export function assessReachability(input: ReachabilityInput, asOf: string): Reachability {
  const { id, remaining, targetDate, monthly } = input;
  const base: Reachability = {
    id, verdict: 'unknown', monthsToFund: null, targetMonthIndex: null,
    fundedByTargetDate: 0, shortfall: 0, monthsLate: null,
  };

  if (remaining < CENT) return { ...base, verdict: 'funded', monthsToFund: 0 };
  if (monthly === undefined) return base;

  let cumulative = 0;
  let monthsToFund: number | null = null;
  for (let i = 0; i < monthly.length; i += 1) {
    cumulative += Math.max(0, Number(monthly[i]) || 0);
    if (monthsToFund === null && cumulative + CENT >= remaining) monthsToFund = i;
  }

  if (targetDate == null) {
    return { ...base, verdict: 'undated', monthsToFund };
  }

  // A target date in the past is measured at month 0: the deadline is now, and whatever has landed
  // by now is all it gets. Clamping rather than going negative keeps the shortfall honest.
  const targetMonthIndex = Math.max(0, monthIndexOf(asOf, targetDate));
  const fundedByTargetDate = monthly
    .slice(0, targetMonthIndex + 1)
    .reduce((s, m) => s + Math.max(0, Number(m) || 0), 0);
  const shortfall = Math.max(0, remaining - fundedByTargetDate);

  if (shortfall < CENT) {
    return {
      ...base, verdict: 'on_track', monthsToFund, targetMonthIndex,
      fundedByTargetDate, shortfall: 0,
    };
  }
  if (monthsToFund === null) {
    return {
      ...base, verdict: 'never', monthsToFund: null, targetMonthIndex,
      fundedByTargetDate, shortfall,
    };
  }
  return {
    ...base, verdict: 'late', monthsToFund, targetMonthIndex,
    fundedByTargetDate, shortfall, monthsLate: monthsToFund - targetMonthIndex,
  };
}

export type SurplusCollision = {
  /** How many months were measured — the shorter of the horizon asked for and the schedule held. */
  horizonMonths: number;
  /** Everything the dated targets still need inside the horizon. */
  demand: number;
  /** Everything the surplus is projected to be, over the same months. */
  capacity: number;
  /** `demand - capacity`, floored at 0. Non-zero means the plan cannot be met as ranked. */
  shortfall: number;
  /** Ids that do not reach their own target date, worst shortfall first. */
  unreachable: { id: string; shortfall: number }[];
};

/**
 * Demand against supply across the whole list — the number nobody had until 2026-08-21.
 *
 * Session 6 priced Tre's by hand and found ~$29,000 of demand against $16,232 of capacity to
 * Aug 2027, about $13,000 short. That arithmetic was correct and it lived in a handoff file, which
 * is the wrong place for it: the app diverts the money, so the app is what has to say the money
 * does not go round.
 *
 * @param capacityByMonth The deployable surplus per month, index 0 the current month. This is the
 *   pool BEFORE it is split between the cards and everything else, so it is the honest ceiling on
 *   what every target combined can receive.
 */
export function assessSurplusCollision(
  targets: readonly ReachabilityInput[],
  capacityByMonth: readonly number[],
  asOf: string,
  horizonMonths = capacityByMonth.length,
): SurplusCollision {
  const months = Math.max(0, Math.min(horizonMonths, capacityByMonth.length));
  const capacity = capacityByMonth
    .slice(0, months)
    .reduce((s, m) => s + Math.max(0, Number(m) || 0), 0);

  // Only DATED demand inside the horizon counts. An undated goal is not competing for this
  // window's money in any way the user has committed to, and counting it would manufacture a
  // shortfall out of an aspiration.
  const demand = targets.reduce((s, t) => {
    if (t.targetDate == null) return s;
    const at = monthIndexOf(asOf, t.targetDate);
    if (at >= months) return s;
    return s + Math.max(0, Number(t.remaining) || 0);
  }, 0);

  const unreachable = targets
    .map(t => assessReachability(t, asOf))
    .filter(r => (r.verdict === 'never' || r.verdict === 'late') && r.shortfall >= CENT)
    .map(r => ({ id: r.id, shortfall: r.shortfall }))
    .sort((a, b) => b.shortfall - a.shortfall);

  return {
    horizonMonths: months,
    demand: Math.round(demand * 100) / 100,
    capacity: Math.round(capacity * 100) / 100,
    shortfall: Math.round(Math.max(0, demand - capacity) * 100) / 100,
    unreachable,
  };
}
