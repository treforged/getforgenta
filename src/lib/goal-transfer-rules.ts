/**
 * A savings goal's own `monthly_contribution`, expressed as a transfer rule so the surfaces that
 * list money leaving an account can show it beside the real recurring rules.
 *
 * Two things this function does deliberately, both of which cost money if changed carelessly:
 * - **A goal already funded by a real recurring rule is skipped**, because it is already listed as
 *   that rule. Synthesising a second row would double both the total and the money on screen.
 * - **`due_day` stays null.** A goal contribution has no day of the month, and inventing one prints
 *   a date the user never set. A caller that needs a date decides that for itself, and says so.
 *
 * Lives here rather than inside `useBudgetMonthTotals` because Budget Control and Transactions both
 * read it, and a second copy of the precedence filter above is a double-count waiting to happen.
 */

export const GOAL_RULE_PREFIX = 'goal:' as const;

/** True for the synthetic ids this file mints, so a caller can tell them from real `recurring_rules`. */
export const isGoalTransferRuleId = (id: string | null | undefined): boolean =>
  typeof id === 'string' && id.startsWith(GOAL_RULE_PREFIX);

/** The structural slice of a `savings_goals` row this synthesis reads. */
export interface GoalTransferSource {
  id?: string | null;
  name?: string | null;
  monthly_contribution?: number | string | null;
  contribution_start_date?: string | null;
  linked_account?: string | null;
  linked_rule_id?: string | null;
  linked_rule_ids?: string[] | null;
}

export interface GoalTransferRule {
  id: string;
  name: string;
  amount: number;
  rule_type: 'transfer';
  frequency: 'monthly';
  due_day: null;
  due_month: null;
  category: 'Savings';
  start_date: string | null;
  end_date: null;
  payment_source: null;
  deposit_account: string | null;
  notes: 'From Savings Goals';
  active: true;
  isGoalTransfer: true;
}

export const buildGoalTransferRules = (
  savingsGoals: ReadonlyArray<GoalTransferSource>,
  rules: ReadonlyArray<{ id: string }>,
): GoalTransferRule[] =>
  savingsGoals
    .filter((g) => {
      const ruleIds: string[] = (g.linked_rule_ids ?? []).length > 0
        ? (g.linked_rule_ids ?? [])
        : g.linked_rule_id ? [g.linked_rule_id] : [];
      if (ruleIds.some((id) => rules.some((r) => r.id === id))) return false;
      return Number(g.monthly_contribution) > 0;
    })
    .map((g) => ({
      id: `${GOAL_RULE_PREFIX}${g.id ?? ''}`,
      name: `${g.name ?? ''} Contribution`,
      amount: Number(g.monthly_contribution),
      rule_type: 'transfer',
      frequency: 'monthly',
      due_day: null,
      due_month: null,
      category: 'Savings',
      start_date: g.contribution_start_date ?? null,
      end_date: null,
      payment_source: null,
      deposit_account: g.linked_account ?? null,
      notes: 'From Savings Goals',
      active: true,
      isGoalTransfer: true,
    } as const));

/**
 * The same rules, given a `due_day`, for callers that render a LEDGER ROW and therefore need a date.
 *
 * The day comes from the goal's own `contribution_start_date` — a date the user actually set — and
 * falls back to the 1st, which is what `getRuleOccurrenceDatesInMonth` would have reached on a null
 * `due_day` anyway. This is deliberately NOT folded into `buildGoalTransferRules`: Budget Control
 * shows these with no day of the month on purpose, and only the surface that needs a date invents one.
 *
 * It lives here rather than inside the page so the tests exercise the real derivation instead of a
 * copy of it — a check aimed at a copy passes while the shipped code is wrong.
 */
export const buildDatedGoalTransferRules = (
  savingsGoals: ReadonlyArray<GoalTransferSource>,
  rules: ReadonlyArray<{ id: string }>,
): Array<Omit<GoalTransferRule, 'due_day'> & { due_day: number }> =>
  buildGoalTransferRules(savingsGoals, rules).map((g) => ({
    ...g,
    due_day: g.start_date ? Number(g.start_date.slice(8, 10)) || 1 : 1,
  }));
