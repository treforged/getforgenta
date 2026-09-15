/**
 * Build the `budgetCategories` input for `budgetAdherenceBucket` from the two halves the app
 * already holds: `budget_items` (the BUDGETED side) and the monthly expense model's `byCategory`
 * (the SPENT side).
 *
 * ⚠️ `budget_items` HAS NO `spent` COLUMN. Its columns are `amount, category, created_at, id,
 * label, updated_at, user_id`. An earlier session reported it as carrying the shape this bucket
 * wants, having counted matching column names rather than reading them. The spend half comes from
 * `expenseModel.byCategory` and from nowhere else.
 *
 * ⚠️ THE BUDGET IS PRO-RATED TO THE DAY, AND THAT IS THE WHOLE POINT OF THIS FILE.
 * `byCategory` is MONTH-TO-DATE spend. Comparing it against a WHOLE-MONTH budget would score
 * almost everybody as on track on the 2nd of the month and publish that to a board other people
 * read - a metric that is systematically inflated for most of its life is worse than no metric,
 * because it looks like a measurement. So the budget is scaled by the fraction of the month
 * elapsed before the comparison.
 */

/** A `budget_items` row, narrowed to the two fields this needs. */
export interface BudgetItemLike {
  category: string | null;
  amount: number | null;
}

/**
 * Fraction of `asOf`'s month that has elapsed, counting the current day as whole.
 *
 * Day 1 of a 30-day month returns 1/30, the last day returns 1. Always in (0, 1].
 */
export function monthElapsedFraction(asOf: Date): number {
  const daysInMonth = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate();
  return asOf.getDate() / daysInMonth;
}

/**
 * Join budgeted against spent, keyed on category.
 *
 * Returns `null` when no category has a usable budget - the absence must not be published as a
 * zero, which would read as "spent everything" rather than "nothing to report".
 *
 * Categories are summed, because several budget items may share one category. A budgeted category
 * with no spend row is spend 0, not a missing row: budgeting and then spending nothing is on
 * track, and dropping it would silently narrow the denominator.
 */
export function buildBudgetCategories(
  budgetItems: ReadonlyArray<BudgetItemLike> | null | undefined,
  spentByCategory: Readonly<Record<string, number>> | null | undefined,
  asOf: Date,
): ReadonlyArray<{ spent: number | null; budgeted: number | null }> | null {
  if (!budgetItems || budgetItems.length === 0) return null;

  const budgeted = new Map<string, number>();
  for (const item of budgetItems) {
    // Locals before testing them, matching `goalProgressBucket` in leaderboard-metrics.ts.
    const category = item.category;
    const amount = item.amount;
    if (category === null || amount === null) continue;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const key = category || 'Other';
    budgeted.set(key, (budgeted.get(key) ?? 0) + amount);
  }
  if (budgeted.size === 0) return null;

  const elapsed = monthElapsedFraction(asOf);
  const spend = spentByCategory ?? {};
  const out: Array<{ spent: number | null; budgeted: number | null }> = [];
  for (const [category, monthlyBudget] of budgeted) {
    const spent = spend[category];
    out.push({
      spent: Number.isFinite(spent) ? spent : 0,
      budgeted: monthlyBudget * elapsed,
    });
  }
  return out;
}
