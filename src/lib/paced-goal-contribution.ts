/**
 * 585ec24a — DEBT-AWARE PACING OF A GOAL'S OWN MONTHLY CONTRIBUTION.
 *
 * Tre, 2026-09-18: "keep the date but we need to transfer less initially. it doesnt need to be
 * consistently the same every month. the goals is to save on interest when there is credit card
 * debt."
 *
 * A goal whose first stop SHARES its rank with the cards (a split weight), has a date, and whose
 * contribution is not a linked bank rule, draws a BACK-LOADED schedule instead of its flat
 * `monthly_contribution` - but only while a card carries a balance. The sim (useCardProjection)
 * deducts it before it sizes the card cascade, so the freed early cash reaches card principal with
 * no new plumbing, and the engine reads the same schedule so month i agrees on both sides.
 *
 * MEASURED on Tre's real fixture (paced-goal-contribution.realData.test.ts, flat vs paced):
 *   card payments 66,423 -> 66,002 over the horizon; card balance on Jul 2027 15,464 -> 14,660;
 *   payoff Sep 2028 on both; no month under the floor; the move account holds 5,758.88 by May 2027,
 *   before the $3,830 June and $1,900 July move expenses leave it.
 *
 * THREE THINGS THAT BROKE ON THE WAY, each now gated:
 *   1. The ranked reserve refilled the goal from the cash the schedule freed (payoff went to Dec
 *      2028). The reserve now paces only what the schedule leaves uncovered - `scheduledAfter`.
 *   2. A ramp ending in the TARGET month was ~$2,250 short in June, because the money leaves the
 *      account before the date. The deadline is the month before the first planned outflow.
 *   3. The recomputed ramp (backLoadedMonthlyCeiling) is NOT the linear ramp that file's comment
 *      describes - its last month takes ~40% of the need. A true linear ramp was measured too: it
 *      saves $184 against this one's $421. Kept this shape under Tre's standing rule to take the
 *      answer that saves the most money, and the card SHOWS the largest month (his constraint 4).
 */
import { backLoadedMonthlyCeiling, runPaceToDeadline } from './back-loaded-pace';
import { monthsUntilTargetDate } from './retirement-contribution-cap';
import { goalStages, type RankableGoal } from './ranked-extra-payment-targets';

/** Kill switch: false restores the flat `monthly_contribution` at every site in one edit. */
export const PACED_CONTRIBUTIONS_ENABLED = true;

let pacingOverride: boolean | null = null;
/**
 * TEST ONLY. Runs the real sim and engine with pacing forced on or off, so a real-data gate can
 * compare the two arms in one process (and keep a positive control that only the flat arm
 * produces). `null` restores the kill switch. Never called by app code.
 */
export function setPacedContributionsForTest(on: boolean | null): void {
  pacingOverride = on;
}

/**
 * A savings goal with optional paced contribution schedule.
 */
export type PacedGoal = RankableGoal & {
  monthly_contribution?: number | null;
  contribution_start_date?: string | null;
  linked_rule_id?: string | null;
  linked_rule_ids?: string[] | null;
};

/** A planned expense paid OUT of an account: which account, and the `YYYY-MM-DD` it leaves. */
export type AccountOutflow = { accountId: string; date: string };

/**
 * Planned one-time expenses paid from an account, as the schedule needs them. Mirrors
 * `otherAccountOneTimeByMonth` in useForecastEngineInputs.ts: a real (not generated) expense with a
 * payment_source. The schedule only reads the ones in FUTURE months, so settled rows cannot move it.
 */
export function accountOutflowsFrom(
  transactions: ReadonlyArray<{ type?: string | null; date?: string | null; payment_source?: string | null; amount?: number | string | null; isGenerated?: boolean }> | null | undefined,
): AccountOutflow[] {
  return (transactions ?? [])
    .filter(t => t.type === 'expense' && !t.isGenerated && t.payment_source && t.date && Number(t.amount) > 0)
    // Stored as `account:<uuid>` (see otherAssetSourceId, other-account-cash.ts); compared bare.
    .map(t => ({ accountId: (t.payment_source as string).replace(/^account:/, ''), date: t.date as string }));
}

/**
 * Returns a paced contribution schedule for a goal if it qualifies.
 * Returns null if the goal does not qualify.
 */
export function pacedContributionSchedule(
  goal: PacedGoal,
  asOf: Date,
  horizon: number,
  outflows: ReadonlyArray<AccountOutflow> = [],
): number[] | null {
  // Rule 1: monthly_contribution must be a finite positive number
  const monthlyContribution = Number(goal.monthly_contribution);
  if (!Number.isFinite(monthlyContribution) || monthlyContribution <= 0) {
    return null;
  }

  // Rule 2: no linked rules
  if (
    goal.linked_rule_id !== undefined &&
    goal.linked_rule_id !== null &&
    goal.linked_rule_id.trim() !== ''
  ) {
    return null;
  }

  if (
    goal.linked_rule_ids !== undefined &&
    goal.linked_rule_ids !== null &&
    goal.linked_rule_ids.length > 0
  ) {
    return null;
  }

  // Rule 3: contribution_start_date must be in past or same month
  const contribStartDate = goal.contribution_start_date;
  if (contribStartDate !== undefined && contribStartDate !== null) {
    const contribMonths = monthsUntilTargetDate(contribStartDate, asOf);
    if (contribMonths === null || contribMonths > 0) {
      return null;
    }
  }

  // Rule 4: first stop must exist with size > 0 and share
  const { stops } = goalStages(goal, 0);
  if (stops.length === 0 || stops[0].size <= 0 || stops[0].share === null) {
    return null;
  }

  // Rule 5: target date must be valid and in future or same month
  const stop = stops[0];
  const targetDate = stop.targetDate ?? goal.target_date ?? null;
  const months = monthsUntilTargetDate(targetDate, asOf);
  if (months === null || months < 0) {
    return null;
  }

  // Rule 6: need must be > 0.01
  const currentAmount = Math.max(0, Number(goal.current_amount) || 0);
  const need = stop.threshold - currentAmount;
  if (need <= 0.01) {
    return null;
  }

  // ⚠️ THE MONEY MUST BE THERE BEFORE IT LEAVES, NOT ON THE DATE. Measured 2026-09-23 on Tre's
  // fixture: the move account pays a $3,830 lease-break fee in June and the goal's date is 3 July,
  // so a ramp ending in July left the account ~$2,250 short in June. The deadline is therefore the
  // month BEFORE the first planned outflow from the goal's own account, when that comes first.
  // Outflows in the current month are ignored: they are not something a schedule can still fund.
  let deadline = Math.trunc(months);
  const acct = goal.linked_account ?? null;
  if (acct) {
    for (const o of outflows) {
      if (o.accountId !== acct) continue;
      const m = monthsUntilTargetDate(o.date, asOf);
      if (m == null || m < 1 || m > deadline) continue;
      deadline = Math.min(deadline, m - 1);
    }
  }
  const payments = deadline + 1;
  const { perMonth } = runPaceToDeadline(
    need,
    payments,
    backLoadedMonthlyCeiling
  );

  // Round to cents and adjust last payment
  const cents = perMonth.map(x => Math.round(x * 100) / 100);
  const total = cents.reduce((s, x) => s + x, 0);
  if (cents.length > 0) {
    const last = cents.length - 1;
    cents[last] = Math.round((cents[last] + (need - total)) * 100) / 100;
  }

  // Truncate or pad to horizon
  const len = Math.max(0, Math.trunc(horizon));
  const schedule = Array.from({ length: len }, (_, i) => cents[i] ?? 0);

  return schedule;
}

/**
 * True when any active credit card carries a balance. Pacing exists to save CARD INTEREST (Tre,
 * 2026-09-18: "the goals is to save on interest when there is credit card debt"), so with no card
 * balance there is nothing to save and the flat contribution - money in the goal sooner, less
 * risk late - is simply better. Read off `accounts` so the sim and the engine decide it identically.
 */
export function hasCardDebt(
  accounts: ReadonlyArray<{ account_type?: string | null; active?: boolean | null; balance?: number | string | null }> | null | undefined,
): boolean {
  return (accounts ?? []).some(a => a.account_type === 'credit_card' && a.active !== false && Number(a.balance) > 0.005);
}

/**
 * Builds a map of paced contribution schedules for all qualifying goals. Empty when `cardDebt` is
 * false - see {@link hasCardDebt}.
 */
export function buildPacedContributionSchedules(
  goals: readonly PacedGoal[] | null | undefined,
  asOf: Date,
  horizon: number,
  outflows: ReadonlyArray<AccountOutflow> = [],
  cardDebt = true,
): Map<string, number[]> {
  const schedules = new Map<string, number[]>();
  if (!(pacingOverride ?? PACED_CONTRIBUTIONS_ENABLED) || !goals || !cardDebt) return schedules;

  for (const goal of goals) {
    const schedule = pacedContributionSchedule(goal, asOf, horizon, outflows);
    if (schedule && goal.id) {
      schedules.set(goal.id, schedule);
    }
  }

  return schedules;
}

/**
 * What a paced goal's schedule will still deposit AFTER month `monthIdx`. The ranked reserve paces
 * a stop against its remaining need; for a paced goal that need is already covered by these future
 * payments, so the reserve must only close the gap they leave. Without this the reserve sees the
 * small early payments as a shortfall and refills the goal from the cash the schedule freed for the
 * cards — measured 2026-09-23 on Tre's fixture, card payoff Sep 2028 -> Dec 2028.
 */
export function scheduledAfter(
  schedules: ReadonlyMap<string, number[]>, goalId: string | null | undefined, monthIdx: number,
): number {
  const schedule = goalId ? schedules.get(goalId) : undefined;
  if (!schedule) return 0;
  return schedule.slice(Math.max(0, monthIdx + 1)).reduce((s, x) => s + x, 0);
}

/**
 * Returns the contribution amount for a specific month index.
 * Falls back to monthly_contribution if no schedule exists.
 */
export function goalContributionForMonth(
  goal: PacedGoal,
  monthIdx: number,
  schedules: ReadonlyMap<string, number[]>
): number {
  const schedule = goal.id ? schedules.get(goal.id) : undefined;
  if (!schedule) return Number(goal.monthly_contribution) || 0;
  // A paced goal's schedule ENDS in its target month. Past it the goal has been paid in full,
  // so it draws nothing — never the flat monthly_contribution it replaced.
  return schedule[monthIdx] ?? 0;
}
