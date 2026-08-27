/**
 * THE BALANCE TRAJECTORY OF A NON-CREDIT-CARD DEBT, ready for recharts.
 *
 * The Credit Card Payoff tab has drawn a payoff trajectory since the engine shipped; Mortgage,
 * Student Loans and Other Debts have only ever shown three numbers per card. This is the series
 * builder those three tabs share, and it is a PURE function so the shape of the lines can be
 * pinned by tests instead of by looking at a screenshot.
 *
 * ── ONE ARRAY, TWO CONVENTIONS (again) ───────────────────────────────────────
 *
 * `nonCCLiabilityBalancesById` is seeded as the balance a month OPENS at and then reduced from
 * index `i` INCLUSIVE by whatever the ranked waterfall sent that month (see `extra-aware-payoff.ts`
 * for why the engine's reducer is right to do that). So the raw entry means one thing before an
 * extra touches it and another after, and plotting it beside a scheduled amortization drew the two
 * lines a month out of step — with the ACCELERATED one sitting ABOVE the un-accelerated one, which
 * is how /vehicles' chart looked before `6e676601`'s successor fixed it.
 *
 * Adding that month's own extra back gives the balance actually owed entering the month, which is
 * the same convention `projectLiabilityBalances` produces. Both lines then answer one question:
 * what is owed at the start of this month.
 */

/** Two debts whose scheduled and extra-aware balances never differ by this much are one line, and
 *  a second line drawn on top of the first is noise pretending to be information. */
const MEANINGFUL_DIFFERENCE_DOLLARS = 1;

export interface LiabilityTrajectoryInput {
  /** Stable key — the account id, or `debt:<id>` for a debts row with no account. */
  id: string;
  name: string;
  /** The engine's opening-balance array for this debt, extras already subtracted in place. */
  balances: readonly number[] | null | undefined;
  /** What the ranked waterfall actually sent this target, month by month. */
  extrasByMonth?: readonly number[] | null;
  /** Opening balances at the target payment ALONE. Drawn only when it differs from the line
   *  above — a debt receiving no extra money has one trajectory, not two. */
  scheduled?: readonly number[] | null;
}

export interface LiabilityTrajectorySeries {
  id: string;
  name: string;
  /** recharts `dataKey` for the extra-aware line. Unique across the returned series. */
  key: string;
  /** recharts `dataKey` for the scheduled companion line, when there is one. */
  scheduledKey: string | null;
}

export type LiabilityTrajectoryRow = Record<string, number | string | null>;

export interface LiabilityTrajectory {
  rows: LiabilityTrajectoryRow[];
  series: LiabilityTrajectorySeries[];
}

/** The balance owed entering month `i`, or null when the projection does not reach that far — a
 *  gap, never a zero, because "not projected" and "paid off" must not look the same. */
function openingBalanceAt(
  balances: readonly number[] | null | undefined,
  extrasByMonth: readonly number[] | null | undefined,
  i: number,
): number | null {
  if (!balances || i >= balances.length) return null;
  const raw = Number(balances[i]);
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, raw + Number(extrasByMonth?.[i] ?? 0));
}

/**
 * Month-indexed rows for a recharts LineChart, plus the series that actually draw something.
 *
 * A debt whose every plotted point is null or zero is dropped: it contributes a name and a colour
 * to a legend for a line nobody can see. That is a property of the DATA, not a special case for
 * any one debt type, so a fully-paid debt disappears for the same honest reason a never-projected
 * one does.
 */
export function buildLiabilityTrajectory(
  inputs: readonly LiabilityTrajectoryInput[],
  months: number,
  now: Date,
): LiabilityTrajectory {
  const usedKeys = new Set<string>();
  const prepared = inputs.map(input => {
    let key = input.name;
    let n = 2;
    while (usedKeys.has(key)) key = `${input.name} (${n++})`;
    usedKeys.add(key);

    const values = Array.from({ length: months }, (_, i) =>
      openingBalanceAt(input.balances, input.extrasByMonth, i));

    const scheduledValues = input.scheduled
      ? Array.from({ length: months }, (_, i) => openingBalanceAt(input.scheduled, null, i))
      : null;

    // The companion line earns its place only by disagreeing with the line it accompanies.
    const differs = !!scheduledValues && scheduledValues.some((s, i) => {
      const v = values[i];
      return s != null && v != null && s - v >= MEANINGFUL_DIFFERENCE_DOLLARS;
    });

    return { input, key, values, scheduledValues: differs ? scheduledValues : null };
  }).filter(p => p.values.some(v => v != null && v > 0));

  const rows: LiabilityTrajectoryRow[] = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const row: LiabilityTrajectoryRow = {
      month: d.toLocaleString('en', { month: 'short', year: 'numeric' }),
    };
    for (const p of prepared) {
      const v = p.values[i];
      row[p.key] = v == null ? null : Math.round(v);
      if (p.scheduledValues) {
        const s = p.scheduledValues[i];
        row[`${p.key} (no extra)`] = s == null ? null : Math.round(s);
      }
    }
    return row;
  });

  return {
    rows,
    series: prepared.map(p => ({
      id: p.input.id,
      name: p.input.name,
      key: p.key,
      scheduledKey: p.scheduledValues ? `${p.key} (no extra)` : null,
    })),
  };
}
