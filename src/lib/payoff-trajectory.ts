// The shape of the payoff run, for the Dashboard milestone.
//
// DIRECTION.md's audience already thinks in build threads: a number on everything and
// progress you can scroll back through. A payoff DATE alone is inert — it says when, not
// how far. This module turns the trajectory the engine already published into the curve
// that falls to zero on that date, so the milestone reads as a run in progress rather
// than a fact.
//
// It derives NOTHING. `monthlyRevolvingBalances` is the converged sim's own per-card
// balance-by-month map — the same map `selectRevolvingPayoff`'s third fallback reads the
// payoff month off — so the curve and the date cannot come to disagree.

export interface PayoffTrajectoryPoint {
  /** 1-indexed month, month 1 = this month — the convention the engine uses everywhere. */
  month: number;
  /** Total revolving balance across the given cards in that month. Never negative. */
  balance: number;
}

export interface PayoffTrajectory {
  points: PayoffTrajectoryPoint[];
  /** Revolving balance today. Always > 0 — a run that starts at zero is not a run. */
  startBalance: number;
  /** 1-indexed month the curve reaches its last point, i.e. the payoff month. */
  endMonth: number;
}

export interface PayoffTrajectoryInput {
  /** `CardProjectionResult.monthlyRevolvingBalances`. */
  monthlyRevolvingBalances: Map<string, number[]> | null | undefined;
  /** Cards to sum, normally `simCards.map(c => c.id)`. */
  cardIds: readonly string[];
  /** 1-indexed payoff month from `selectRevolvingPayoff`. */
  payoffMonth: number;
}

/**
 * The revolving balance month by month, from today to the month it clears.
 *
 * Returns null rather than a flat line whenever there is nothing honest to draw: no
 * trajectory published, no cards, a payoff month inside month 1, or a balance that is
 * already zero today. A sparkline pinned at the axis and a sparkline that failed to read
 * look identical, which is the confident-zero rule in chart form.
 */
export function buildPayoffTrajectory({
  monthlyRevolvingBalances,
  cardIds,
  payoffMonth,
}: PayoffTrajectoryInput): PayoffTrajectory | null {
  if (!monthlyRevolvingBalances || cardIds.length === 0) return null;
  if (!Number.isFinite(payoffMonth) || payoffMonth < 2) return null;

  const points: PayoffTrajectoryPoint[] = [];
  for (let month = 1; month <= payoffMonth; month++) {
    let total = 0;
    let sawAny = false;
    for (const id of cardIds) {
      const series = monthlyRevolvingBalances.get(id);
      if (!series) continue;
      // The map is 0-indexed on month 0 = this month; `month` is the 1-indexed convention.
      const value = series[month - 1];
      if (value == null || !Number.isFinite(value)) continue;
      sawAny = true;
      total += Math.max(0, value);
    }
    // A month no card published a figure for is a hole in the data, not a zero balance.
    if (!sawAny) return null;
    points.push({ month, balance: total });
  }

  const startBalance = points[0]?.balance ?? 0;
  if (startBalance <= 0) return null;

  return { points, startBalance, endMonth: payoffMonth };
}

/**
 * A months-away count in the words someone actually uses. "22 months away" is a figure to
 * decode; "1 yr 10 mo away" is a length of time. Below a year it stays in months, because
 * "0 yr 7 mo" is worse than "7 months".
 */
export function formatMonthsAway(monthsAway: number): string {
  if (!Number.isFinite(monthsAway) || monthsAway <= 0) return 'This month';
  if (monthsAway < 12) return `${monthsAway} month${monthsAway === 1 ? '' : 's'} away`;
  const years = Math.floor(monthsAway / 12);
  const months = monthsAway % 12;
  const yearPart = `${years} yr`;
  return months === 0 ? `${yearPart} away` : `${yearPart} ${months} mo away`;
}
