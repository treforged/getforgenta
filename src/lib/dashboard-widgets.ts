export type WidgetId =
  | 'monthly_snapshot'
  | 'upcoming_week'
  | 'net_worth_trend'
  | 'car_goal'
  | 'cash_flow_chart'
  | 'transactions_spending'
  | 'goal_progress'
  | 'advanced_analytics'
  | 'debt_recommendations';

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
}

export interface WidgetMeta {
  id: WidgetId;
  label: string;
  description: string;
}

export const WIDGET_META: WidgetMeta[] = [
  {
    id: 'monthly_snapshot',
    label: 'Monthly Snapshot',
    // Next paycheck and month-end cash were added beside the title on 2026-08-23, when Tre
    // re-anchored those two figures out of the retired stat-chip row.
    description: 'Budget bar showing funding balance, remaining income, and projected surplus, with your next paycheck and projected month-end cash',
  },
  {
    id: 'upcoming_week',
    label: 'Upcoming This Week',
    description: 'Bills and expenses due in the next 7 days',
  },
  {
    id: 'net_worth_trend',
    label: 'Net Worth Trend',
    // The current totals it used to lead with (net worth, assets, liabilities) moved to the
    // fixed overview strip above the panel switcher on 2026-08-22, where they are on screen
    // for every panel. What this widget owns is the direction of travel.
    description: 'Net worth over time, and the change over the last month',
  },
  {
    id: 'car_goal',
    label: 'Car Goal',
    description: 'Down payment progress and estimated monthly loan payment',
  },
  {
    id: 'cash_flow_chart',
    label: 'Cash Flow Chart',
    description: '6-month income vs. expenses chart with net cash flow trend',
  },
  {
    id: 'transactions_spending',
    label: 'Transactions & Spending',
    description: "Recent transactions and this month's spending by category",
  },
  {
    id: 'goal_progress',
    label: 'Goal Progress',
    description: 'Savings goals with progress bars and amounts',
  },
  {
    id: 'advanced_analytics',
    label: 'Advanced Analytics',
    description: 'Debt-to-income, annual savings projection, emergency runway, avg monthly spend',
  },
  {
    id: 'debt_recommendations',
    label: 'Debt Recommendations',
    description: 'Recommended debt payments this month — safe to pay, minimums, and per-card breakdown',
  },
];

// The user-facing name of a widget, for anything that has to talk ABOUT a
// widget rather than render it — the error fallback names the card that broke.
export function widgetLabel(id: WidgetId): string {
  return WIDGET_META.find(w => w.id === id)?.label ?? 'This section';
}

export const DEFAULT_LAYOUT: WidgetConfig[] = WIDGET_META.map(w => ({
  id: w.id,
  visible: true,
}));

/**
 * The saved layout from a user's profile, reconciled against the current widget set.
 *
 * Unknown or malformed entries are dropped (a widget id that no longer exists must not survive as
 * a hole in the stack), and every widget the saved layout has never seen is inserted at its
 * DEFAULT position rather than appended.
 *
 * Dropping unknown ids is what retires a widget: `schedule_cards`, `financial_health` and
 * `wealth_overview` were removed from the registry on 2026-08-22 and are still sitting in every
 * saved `profiles.dashboard_layout` written before that date. They are filtered out here rather
 * than migrated in the database.
 *
 * That last part used to be a plain `push`, and it quietly gave existing users a different page
 * from new ones: the Net Worth Trend card was placed high in {@link DEFAULT_LAYOUT} on 2026-08-20
 * precisely because Tre asked for the chart to stop being "spread out", and on an account with a
 * saved layout it arrived dead last under everything else.
 *
 * A new widget anchors to the nearest EARLIER default neighbour the user actually has, so a
 * deliberate reorder still wins — the card follows the widget it was designed to sit behind,
 * wherever that has been moved to. With no earlier neighbour present it goes to the front, which
 * is where the default would have put it.
 *
 * Lives here, next to `DEFAULT_LAYOUT`, so the ordering rule and the order it reconciles against
 * cannot drift apart.
 */
export function mergeSavedLayout(raw: unknown): WidgetConfig[] {
  if (!Array.isArray(raw)) return DEFAULT_LAYOUT.map(w => ({ ...w }));

  const validIds = new Set<WidgetId>(WIDGET_META.map(w => w.id));
  const merged: WidgetConfig[] = raw
    .filter((w): w is { id: WidgetId; visible: boolean } =>
      typeof w === 'object' && w !== null &&
      typeof (w as Record<string, unknown>).id === 'string' &&
      validIds.has((w as Record<string, unknown>).id as WidgetId),
    )
    .map(w => ({ id: w.id, visible: Boolean(w.visible) }));

  const present = new Set(merged.map(w => w.id));
  DEFAULT_LAYOUT.forEach((def, defIndex) => {
    if (present.has(def.id)) return;

    const earlierDefaults = DEFAULT_LAYOUT.slice(0, defIndex).map(w => w.id).reverse();
    const anchorId = earlierDefaults.find(id => present.has(id));
    const at = anchorId ? merged.findIndex(w => w.id === anchorId) + 1 : 0;

    merged.splice(at, 0, { ...def });
    present.add(def.id);
  });

  return merged;
}
