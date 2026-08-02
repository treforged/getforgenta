// Month-by-month projection behind the "Savings Growth Projection" chart on the
// Goals page. Kept pure and separate from the page so the math is testable.
//
// Model (one step per calendar month, month 0 = the current month):
//   - month 0 is the goal's balance as it stands today; nothing is applied to it
//   - every later month:  balance = balance * (1 + monthlyRate)
//                                 + monthly contribution (once contributions have started)
//                                 + any planned lump sums dated in that month
//   - interest accrues in EVERY month, including months before contributions begin
//   - balances are NOT capped at the target, so a goal that overshoots keeps
//     showing its real trajectory instead of flat-lining at the target

export const GROWTH_MONTHS = 12;

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
};

/** One line on the chart. `key` is the recharts dataKey, `name` the label. */
export type GrowthSeries = { key: string; name: string };

export type GrowthRow = { month: string } & Record<string, string | number>;

export type GrowthChartData = { rows: GrowthRow[]; series: GrowthSeries[] };

/** Whole months from (baseYear, baseMonth) to the month containing `dateStr`. */
function monthOffset(dateStr: string, baseYear: number, baseMonth: number): number | null {
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  return (d.getFullYear() - baseYear) * 12 + (d.getMonth() - baseMonth);
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
  });

  const rows: GrowthRow[] = [];
  for (let i = 0; i < months; i++) {
    const row: GrowthRow = {
      month: new Date(baseYear, baseMonth + i).toLocaleString('en', { month: 'short', year: '2-digit' }),
    };
    state.forEach((s, gi) => {
      if (i > 0) {
        s.balance = s.balance * (1 + s.rate)
          + (i >= s.startOffset ? s.pmt : 0)
          + (s.lumpsByMonth.get(i) ?? 0);
      }
      row[series[gi].key] = Math.round(s.balance * 100) / 100;
    });
    rows.push(row);
  }

  return { rows, series };
}
