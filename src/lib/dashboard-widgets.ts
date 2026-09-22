export type WidgetId =
  | 'monthly_snapshot'
  | 'budget_totals'
  | 'upcoming_week'
  | 'net_worth_trend'
  | 'car_goal'
  | 'transactions_spending'
  | 'goal_progress'
  | 'debt_recommendations';

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
}

export interface WidgetMeta {
  id: WidgetId;
  label: string;
  description: string;
  /**
   * Whether this widget is ON for a user who has never customised their dashboard. Omitted means
   * ON — a widget has to be deliberately opted OUT of the first-run stack, never accidentally.
   *
   * ⚠️ THIS ONLY EVER REACHES A USER WITH NO SAVED LAYOUT, and that is the whole population it is
   * meant for. `mergeSavedLayout` preserves the stored `visible` flag for every widget a saved
   * layout already knows, so changing this value cannot take a card away from somebody who has
   * one. Measured 2026-09-17: 33 profiles, 31 with no saved layout — and the 2 that have one are
   * `tre@treforged.com` and `reviewer@treforged.com`, so this default reaches 31 users and
   * reaches NEITHER the CEO's own screen NOR the account the walk signs in as. Do not report a
   * change here as tidying his dashboard; it will not. The honest route to his screen is an
   * explicit "reset to the new default" he chooses, never a silent rewrite of his saved row.
   */
  defaultVisible?: boolean;
}

export const WIDGET_META: WidgetMeta[] = [
  {
    id: 'monthly_snapshot',
    label: 'Monthly Snapshot',
    // Next paycheck and month-end cash were added beside the title on 2026-08-23, when Tre
    // re-anchored those two figures out of the retired stat-chip row.
    description: 'Budget donut showing funding balance, remaining income, and projected surplus, with your next paycheck and projected month-end cash',
  },
  {
    // Seated directly behind the snapshot on 2026-08-27, when Tre moved Budget Control's KPI row
    // here. Its neighbour is the donut that divides the same month up, so the figures and the
    // shares of them read as one block — and `mergeSavedLayout` anchors it there for users whose
    // layout predates it.
    id: 'budget_totals',
    label: "This Month's Budget",
    description: 'Income, fixed, variable, debt and transfers for the current month, plus planned monthly and annual spend — each one taps through to its own breakdown',
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
    id: 'transactions_spending',
    label: 'Transactions & Spending',
    description: "Recent transactions and this month's spending by category",
    // ⚠️ OFF BY DEFAULT since 2026-09-17, and it is the ONLY widget defaulted off. Tre, on the
    // dashboard: "it seems like the dashboard is getting to the point where it['s an] overload of
    // information when it's supposed to be a quick snappy what needs to be paid next". This is the
    // largest block in the stack — a two-column grid holding a category breakdown AND a
    // transaction list — it renders UNCONDITIONALLY (no empty-guard, unlike `car_goal`), it
    // answers neither "what needs to be paid next", and it is a duplicate route: /transactions
    // owns both halves in full. One tap in Customize restores it.
    //
    // ⚠️ TWO WIDGETS WERE PROPOSED ALONGSIDE IT AND BOTH WERE REFUTED. Recorded here because the
    // proposal rested on "the three he has never once mentioned", and for one of them the repo's
    // own history says the opposite:
    //   · `budget_totals` — he ASKED for it. 90b39aba, 2026-08-27, with a screenshot of Budget
    //     Control's KPI row: "i wanted these moved to dashboard". Defaulting off a card he
    //     personally placed here, on the grounds that he never asked for it, is the failure the
    //     premise check exists to catch.
    //   · `car_goal` — already self-hides. `Dashboard.tsx` case 'car_goal' opens
    //     `if (!carGoalData) return null`, so for a user with no car goal it contributes nothing
    //     to the overload, and for the 2 users who HAVE one it is a card they can use. The change
    //     would have been a no-op for everyone it was aimed at and a loss for everyone else.
    defaultVisible: false,
  },
  {
    id: 'goal_progress',
    label: 'Goal Progress',
    description: 'Savings goals with progress bars and amounts',
  },
  {
    id: 'debt_recommendations',
    label: 'Debt Recommendations',
    description: 'Recommended debt payments this month — safe to pay, minimums, and per-card breakdown',
  },
  // ⚠️ THE LEARN WIDGET WAS REMOVED FROM THIS LIST ON 2026-09-17, hours after the achievements
  // one and for the same stated reason. Tre: "we should put the learn section in the accounts tab
  // as its own section instead of having it on the home overview dashboard maybe like the most or
  // the next up learning task but not like the whole tab section because it seems like the
  // dashboard is getting to the point where it['s an] overload of information when it's supposed
  // to be a quick snappy what needs to be paid next". `LearnCard` is now the Learn SECTION of
  // /account; what remains on the dashboard is `NextLessonRow`, one line, rendered BELOW this
  // stack and deliberately not registered here - a removable "next up" line would reintroduce the
  // deep-link hole that `notification-routes.ts` closed once already.
  //
  // Saved layouts still carrying 'learn' need no migration, for the same reason: `mergeSavedLayout`
  // filters every stored id against WIDGET_META, so a stale entry is dropped on read.

  // ⚠️ THE ACHIEVEMENTS WIDGET WAS REMOVED FROM THIS LIST ON 2026-09-17, on Tre's instruction:
  // "achievements shouldn't be on the home overview tab. It should just go on its own tab in the
  // section in the account tab." The trophy case now lives as a SECTION of /account, after
  // Leaderboard - see `AccountSection` in src/pages/Account.tsx. It was added here on 2026-09-06
  // only because there was nowhere at all to see a badge; there is now, and two homes for one
  // thing is the "second place to look" problem that comment was written to avoid.
  //
  // ⚠️ SAVED LAYOUTS STILL CARRYING 'achievements' ARE HANDLED, and that is why no migration
  // is needed: `mergeSavedLayout` filters every stored id against WIDGET_META, so the stale entry
  // is dropped on read rather than throwing or rendering an empty card.
  // ⚠️ ADVANCED ANALYTICS AND THE CASH FLOW CHART WERE REMOVED FROM THIS LIST ON 2026-09-22, on
  // Tre's approval of ask 035ffb29 ("8. approved.", 2026-09-20). The dashboard measured 5,674px =
  // 6.7 screens at 390x844; Advanced Analytics alone was 1,028px (18.1%), the largest card, and
  // answered none of "what needs to be paid next". They were MOVED, not deleted:
  //   · `AdvancedAnalyticsCard` is the Analytics section of /account (after Learn), the same
  //     move he made for Learn and Achievements on 2026-09-17.
  //   · `CashFlowOverviewCard` is on /forecast, where the rest of the time series lives.
  // Both read `useMonthlyCashFlow`, the derivation the dashboard itself reads, so neither can
  // print a different month than the dashboard does. Saved layouts still carrying either id need
  // no migration: `mergeSavedLayout` filters stored ids against WIDGET_META and drops them.
];

// The user-facing name of a widget, for anything that has to talk ABOUT a
// widget rather than render it — the error fallback names the card that broke.
export function widgetLabel(id: WidgetId): string {
  return WIDGET_META.find(w => w.id === id)?.label ?? 'This section';
}

export const DEFAULT_LAYOUT: WidgetConfig[] = WIDGET_META.map(w => ({
  id: w.id,
  // Absent means ON. A widget is opted OUT of the first-run stack deliberately, at its own meta
  // entry where the reason sits beside it — never by a separate list somebody has to remember to
  // keep in step with this one.
  visible: w.defaultVisible !== false,
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
