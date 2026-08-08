// Month-by-month projection behind the "Savings Growth Projection" chart and
// the "Est. completion" line on the Goals page. Kept pure and separate from the
// page so the math is testable, and shared so the chart and the estimate can
// never disagree.
//
// Model (one step per calendar month, month 0 = the current month):
//   - month 0 is the goal's balance as it stands today; nothing is applied to it
//   - every later month:  balance = balance * (1 + monthlyRate)
//                                 + monthly contribution (once contributions have started)
//                                 + any planned lump sums dated in that month
//   - interest accrues in EVERY month, including months before contributions begin
//   - contributions STOP once the goal reaches its `targetAmount` (handoff item 4b: the
//     linked transfer really does stop), but interest and planned lump sums keep going,
//     so a funded goal shows an interest-only tail instead of a straight line
//   - balances are NOT capped at the target, so a goal that overshoots keeps
//     showing its real trajectory instead of flat-lining at the target

import { PROJECTION_MONTHS } from './scheduling';

/** Chart horizon: the same 5 years the Forecast projects over. */
export const GROWTH_MONTHS = PROJECTION_MONTHS;

/** How far out "Est. completion" will look before giving up. */
export const MAX_COMPLETION_MONTHS = 600;

export type GrowthLumpSum = { date: string; amount: number };

export type GrowthGoalInput = {
  id: string;
  name: string;
  currentAmount: number;
  monthlyContribution: number;
  /** Annual APY as a percent, e.g. 4.5 for 4.5%. */
  annualApyPercent: number;
  /** ISO date (YYYY-MM-DD) contributions begin, or null for "already running". */
  contributionStartDate: string | null;
  lumpSums: GrowthLumpSum[];
  /**
   * What the goal is saving toward. Optional: omit it (or pass 0) and contributions run for the
   * whole horizon, which is what `estimateGoalCompletionMonths` needs when it is searching for
   * the completion month itself and must not gate the very contributions it is measuring.
   */
  targetAmount?: number | null;
};

/** One line on the chart. `key` is the recharts dataKey, `name` the label. */
export type GrowthSeries = { key: string; name: string };

export type GrowthRow = { month: string } & Record<string, string | number>;

export type GrowthChartData = { rows: GrowthRow[]; series: GrowthSeries[] };

/** The bits of an account this model needs to price a goal's growth. */
export type ApyAccountLike = {
  apy_rate?: number | null;
  apr?: number | null;
  account_type?: string | null;
} | null | undefined;

/**
 * The APY a goal actually earns: the linked account's own rate when it has one, otherwise a
 * sensible default for that account type. A goal with no linked account earns nothing.
 *
 * Shared so the Goals page's "Est. completion" and the Forecast's "<goal> Complete!" milestone
 * price the same goal identically — site walk §2.5 had them three months apart because Goals
 * compounded at Marcus's 4.5% and Forecast projected a straight line.
 */
export function getGoalEffectiveApyPercent(account: ApyAccountLike): number {
  const rawRate = Number(account?.apy_rate ?? account?.apr ?? 0);
  if (rawRate > 0) return rawRate;
  const type = account?.account_type ?? '';
  if (['savings', 'high_yield_savings'].includes(type)) return 4.5;
  if (['brokerage', 'roth_ira', '401k', 'ira', 'hsa'].includes(type)) return 7;
  return 0;
}

/** Whole months from (baseYear, baseMonth) to the month containing `dateStr`. */
function monthOffset(dateStr: string, baseYear: number, baseMonth: number): number | null {
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return (d.getFullYear() - baseYear) * 12 + (d.getMonth() - baseMonth);
}

type GoalState = {
  balance: number;
  rate: number;
  pmt: number;
  startOffset: number;
  lumpsByMonth: Map<number, number>;
};

function initState(g: GrowthGoalInput, baseYear: number, baseMonth: number, months: number): GoalState {
  // Lump sums dated in the current month or earlier are assumed to already be
  // part of the balance, so only future months are scheduled.
  const lumpsByMonth = new Map<number, number>();
  for (const ls of g.lumpSums ?? []) {
    const offset = monthOffset(ls.date, baseYear, baseMonth);
    if (offset == null || offset < 1 || offset > months - 1) continue;
    lumpsByMonth.set(offset, (lumpsByMonth.get(offset) ?? 0) + Number(ls.amount || 0));
  }
  const startOffsetRaw = g.contributionStartDate
    ? monthOffset(g.contributionStartDate, baseYear, baseMonth)
    : null;
  return {
    balance: Number(g.currentAmount) || 0,
    rate: (Number(g.annualApyPercent) || 0) / 12 / 100,
    pmt: Number(g.monthlyContribution) || 0,
    // A start date in the past (or none) means contributions are already running.
    startOffset: Math.max(0, startOffsetRaw ?? 0),
    lumpsByMonth,
  };
}

/**
 * Advance one calendar month. Month 0 is the starting balance and is never stepped.
 *
 * `contribCutoff` is the first month index at which the contribution stops (null = never stops).
 * Only the contribution is gated: interest still compounds on the balance and planned lump sums
 * still land, because 4b stops the recurring transfer, not the account.
 */
function stepMonth(s: GoalState, monthIndex: number, contribCutoff: number | null = null): number {
  const contributing = monthIndex >= s.startOffset
    && (contribCutoff == null || monthIndex < contribCutoff);
  s.balance = s.balance * (1 + s.rate)
    + (contributing ? s.pmt : 0)
    + (s.lumpsByMonth.get(monthIndex) ?? 0);
  return s.balance;
}

/**
 * The first month index at which a goal's contributions should STOP because the target has been
 * reached: 0 = already at target, never contribute at all; k+1 when month k's contribution is the
 * one that tipped it over (so months 0..k still fund it); null when it never completes.
 *
 * Shared on purpose. `goal-linkage.ts` derives the Forecast's and the debt engines' transfer
 * cutoffs from this exact arithmetic, so the chart and the engines cannot drift into disagreeing
 * about which month a goal stops being funded.
 */
export function goalContributionCutoffIdx(
  goal: GrowthGoalInput,
  targetAmount: number,
  opts: { today?: Date; maxMonths?: number } = {},
): number | null {
  const completionIdx = estimateGoalCompletionMonths(goal, targetAmount, opts);
  if (completionIdx == null) return null; // never completes within the horizon
  return completionIdx === 0 ? 0 : completionIdx + 1;
}

export function buildSavingsGrowthData(
  goals: GrowthGoalInput[],
  opts: { months?: number; today?: Date } = {},
): GrowthChartData {
  const months = opts.months ?? GROWTH_MONTHS;
  const today = opts.today ?? new Date();
  const baseYear = today.getFullYear();
  const baseMonth = today.getMonth();

  // Series keys are positional rather than goal names: names are not unique and
  // recharts treats dots/brackets in a dataKey as a nested path lookup.
  const series: GrowthSeries[] = goals.map((g, i) => ({
    key: `s${i}`,
    name: g.name || `Goal ${i + 1}`,
  }));

  const state = goals.map(g => initState(g, baseYear, baseMonth, months));

  // A goal with a target stops being funded once it gets there, exactly as the linked transfer
  // does in the Forecast. A goal with no target keeps contributing for the whole horizon.
  const contribCutoffs = goals.map(g => {
    const target = Number(g.targetAmount) || 0;
    return target > 0 ? goalContributionCutoffIdx(g, target, { today }) : null;
  });

  const rows: GrowthRow[] = [];
  for (let i = 0; i < months; i++) {
    const row: GrowthRow = {
      month: new Date(baseYear, baseMonth + i).toLocaleString('en', { month: 'short', year: '2-digit' }),
    };
    state.forEach((s, gi) => {
      if (i > 0) stepMonth(s, i, contribCutoffs[gi]);
      row[series[gi].key] = Math.round(s.balance * 100) / 100;
    });
    rows.push(row);
  }

  return { rows, series };
}

/**
 * Months from now until the goal first reaches `targetAmount`, using the exact
 * same accrual as the chart (so interest and lump sums both count). Returns 0 if
 * already there, or null if it never gets there inside `maxMonths`.
 */
export function estimateGoalCompletionMonths(
  goal: GrowthGoalInput,
  targetAmount: number,
  opts: { today?: Date; maxMonths?: number } = {},
): number | null {
  const target = Number(targetAmount) || 0;
  const today = opts.today ?? new Date();
  const maxMonths = opts.maxMonths ?? MAX_COMPLETION_MONTHS;
  const s = initState(goal, today.getFullYear(), today.getMonth(), maxMonths);

  if (s.balance >= target) return 0;
  // Nothing going in and nothing accruing: it will never get there.
  if (s.pmt <= 0 && s.rate <= 0 && s.lumpsByMonth.size === 0) return null;

  for (let i = 1; i < maxMonths; i++) {
    if (stepMonth(s, i) >= target) return i;
  }
  return null;
}

/**
 * Label for "now + `months`", built the same way the forecast engine builds a projection row's
 * `monthLabel` — `new Date(year, month + i, 1)`.
 *
 * Day-1 construction is the whole point. `date.setMonth(date.getMonth() + months)` overflows when
 * today's day-of-month does not exist in the target month: on Aug 31, +6 months lands on Mar 3,
 * so Goals printed "Mar" for the month the Forecast milestone labels "Feb". Same month INDEX,
 * different month NAME — §2.5's disagreement returning on the last days of a long month.
 */
export function goalCompletionMonthLabel(months: number, today: Date = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth() + months, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
