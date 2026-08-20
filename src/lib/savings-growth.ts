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
//                                 + the forecast engine's ranked automatic extra for that month,
//                                   when the caller supplies `extraByMonth` (see that field)
//   - interest accrues in EVERY month, including months before contributions begin
//   - the monthly contribution STOPS after the month that first reaches
//     `targetAmount` (see `contributionCutoffIdx`); interest and planned lump sums
//     carry on, so a funded goal keeps earning instead of flat-lining
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
   * The goal's target. When present and positive, `buildSavingsGrowthData` stops the monthly
   * contribution once it is reached, matching what the Forecast, Dashboard and Debt engine
   * already do via `goal-linkage.ts`. Omit it for a raw "contribute forever" projection.
   */
  targetAmount?: number | null;
  /**
   * The RANKED AUTOMATIC EXTRA the forecast engine diverts to this goal, month by month, index 0
   * being the current month — i.e. `ForecastMonthRow.autoExtraByTarget[goalId]` lifted straight
   * off the projection rows. Optional, and omitting it (or passing all zeros) leaves every number
   * in this module exactly as it was.
   *
   * It is READ from the engine rather than re-derived here on purpose. The ranked surplus is not
   * flat — it grows as cards retire and shrinks as goals fill — so any second model of it would
   * put this chart a few months away from the Forecast, which is the §2.5 bug class this file's
   * header exists to prevent. The engine also stops diverting once a goal is funded, so these
   * values need no cutoff of their own.
   */
  extraByMonth?: number[];
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
  /** First month index at which the contribution stops, or null for "never stops". */
  cutoffOffset: number | null;
  lumpsByMonth: Map<number, number>;
  extraByMonth: number[];
};

/**
 * Translate a completion month index into the first month index whose contribution should NOT
 * be made: month k's contribution is the one that tipped the goal over, so 0..k still count and
 * k+1 onward do not. A goal already at target (k=0) stops immediately, month 0 included.
 * null in, null out — a goal that never completes never stops contributing.
 *
 * Exported so this rule lives in exactly ONE place: `goal-linkage.ts`'s engine cutoffs and this
 * module's chart derive their stop month from the same line, which is what keeps the Goals chart
 * and the Forecast from drifting a month apart.
 */
export function contributionCutoffIdx(completionIdx: number | null): number | null {
  if (completionIdx == null) return null;
  return completionIdx === 0 ? 0 : completionIdx + 1;
}

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
    // Set by the caller that knows the target; `estimateGoalCompletionMonths` must leave it
    // null or it would be defining its own answer in terms of itself.
    cutoffOffset: null,
    lumpsByMonth,
    // Sanitised at the boundary: a hole or a NaN in the engine's output must add nothing rather
    // than turn the whole projected line into NaN.
    extraByMonth: (g.extraByMonth ?? []).map(v => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0)),
  };
}

/** Advance one calendar month. Month 0 is the starting balance and is never stepped. */
function stepMonth(s: GoalState, monthIndex: number): number {
  const contributing = monthIndex >= s.startOffset
    && (s.cutoffOffset == null || monthIndex < s.cutoffOffset);
  s.balance = s.balance * (1 + s.rate)
    + (contributing ? s.pmt : 0)
    // The engine's own ranked extra for this month. Deliberately NOT gated on `contributing`:
    // the engine has already decided both whether this goal ranks and when it stops, so gating it
    // again here would be this module second-guessing the allocation it is quoting.
    + (s.extraByMonth[monthIndex] ?? 0)
    + (s.lumpsByMonth.get(monthIndex) ?? 0);
  return s.balance;
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

  const state = goals.map(g => {
    const s = initState(g, baseYear, baseMonth, months);
    // Stop contributing once the goal is funded — the same month the engines stop counting it.
    const target = Number(g.targetAmount) || 0;
    if (target > 0) {
      s.cutoffOffset = contributionCutoffIdx(
        estimateGoalCompletionMonths(g, target, { today }),
      );
    }
    return s;
  });

  const rows: GrowthRow[] = [];
  for (let i = 0; i < months; i++) {
    const row: GrowthRow = {
      month: new Date(baseYear, baseMonth + i).toLocaleString('en', { month: 'short', year: '2-digit' }),
    };
    state.forEach((s, gi) => {
      if (i > 0) stepMonth(s, i);
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
  if (s.pmt <= 0 && s.rate <= 0 && s.lumpsByMonth.size === 0
    && !s.extraByMonth.some(v => v > 0)) return null;

  for (let i = 1; i < maxMonths; i++) {
    if (stepMonth(s, i) >= target) return i;
  }
  return null;
}

/**
 * The projected balance `months` from now, on the exact same accrual as the chart — interest,
 * planned lump sums, a future contribution start date, and the stop-at-target cutoff all
 * included.
 *
 * Exists so the lump-sum modal's "projected balance on that date" preview reads the shared
 * model instead of its own closed-form annuity, which ignored both lump sums and the cutoff and
 * so could tell the user a goal would hold more on a date than the chart right above it showed.
 */
export function projectGoalBalanceAt(
  goal: GrowthGoalInput,
  months: number,
  opts: { today?: Date } = {},
): number {
  const horizon = Math.max(1, Math.floor(months) + 1);
  const { rows, series } = buildSavingsGrowthData([goal], { months: horizon, today: opts.today });
  return Number(rows[horizon - 1][series[0].key]);
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
