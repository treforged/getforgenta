/**
 * The current month's budget, as the RULES describe it: five buckets and the totals over them.
 *
 * Extracted from `BudgetControl.tsx` on 2026-08-27 so the Dashboard can show the same seven figures
 * (Tre: *"i wanted these moved to dashboard"*). It is an extraction to ONE definition, not a move —
 * Budget Control still renders its Budget Allocation donut from these very numbers, and the two
 * pages must be provably the same arithmetic rather than two derivations that agree today.
 *
 * ⚠️ EVERYTHING HERE IS PLANNED, NEVER ACTUAL. These are the sums of the user's budget rules for the
 * current month. The Dashboard's AVG MONTHLY SPEND is a five-month actual and answers a different
 * question; that is why the Monthly Spend tile carries its "planned (from rules)" sub-label.
 */
import { countRuleOccurrencesInMonth } from '@/lib/scheduling';
import { matchedMonthAmountDelta } from '@/lib/matched-occurrence-display';
import type { MatchedOccurrenceIndex } from '@/lib/auto-matched-occurrences';

/**
 * Common shape across real `recurring_rules` rows and the synthetic subscription / debt-sync /
 * goal-transfer "rule" entries merged alongside them.
 */
export type BudgetRule = {
  id: string; name: string; amount: number; rule_type: string; frequency: string; active: boolean;
  category: string; due_day?: number | null; due_month?: number | null; start_date?: string | null;
  end_date?: string | null; cost_type?: string | null; isSub?: boolean; isDebtSync?: boolean;
  payment_source?: string | null; deposit_account?: string | null; notes?: string | null;
  tax_rate?: number | null; created_at?: string | null;
  /** Synthesised from a `savings_goals` row's own `monthly_contribution` — see `goalTransferRules`. */
  isGoalTransfer?: boolean;
  /** The ranked automatic extra the forecast diverts to this target in the CURRENT month. Shown
   *  beside the standing amount, never added to it — see `openTransferCalc`. */
  extraThisMonth?: number;
  /** The next month that DOES take one, when this month does not. Same rule: shown, never summed.
   *  Carried as an OFFSET from the current month — the render site dates it, so this module and the
   *  memo that builds these rows stay free of the calendar. */
  nextExtra?: { amount: number; monthIndex: number } | null;
};

/**
 * A row SYNTHESISED from another table rather than one of the user's own `recurring_rules`. The
 * record is owned by the surface it came from — Subscriptions, Debt Payoff, Savings Goals — so
 * every mutation refuses one and the row renders without action buttons.
 */
export const isSyntheticRule = (r: BudgetRule): boolean =>
  Boolean(r.isSub || r.isDebtSync || r.isGoalTransfer);

/**
 * Fixed or variable. A `cost_type` override takes priority over the category default:
 * 'fixed' → fixed bucket, 'variable' → variable bucket, null → category default.
 */
export const isFixedRule = (r: BudgetRule): boolean => {
  if (r.cost_type === 'fixed') return true;
  if (r.cost_type === 'variable') return false;
  return ['Bills', 'Subscriptions', 'Debt Payments'].includes(r.category);
};

/**
 * What this rule costs in the given month.
 *
 * ⚠️ THE MATCHED DELTA IS ADDED ON TOP OF THE FREQUENCY ARITHMETIC, NEVER IN PLACE OF IT. Tre,
 * 2026-08-24: "the real transaction date and costs should auto override the transaction for that
 * month". An occurrence a real payment answered contributes what actually left the account, so
 * `matchedMonthAmountDelta` supplies `real − projected` for exactly those occurrences and zero for
 * every other rule. Rewriting the whole total from occurrence dates would have quietly moved the
 * figures of rules nothing matched, which is not what was asked for and is not verifiable.
 */
export function currentMonthAmount(
  r: BudgetRule,
  year: number,
  month: number, // 0-indexed
  matchedOccurrences: MatchedOccurrenceIndex,
): number {
  const amt = Number(r.amount);
  const matched = matchedMonthAmountDelta(r, year, month, matchedOccurrences);
  if (r.start_date) {
    const startDate = new Date(r.start_date + 'T12:00:00');
    if (startDate > new Date(year, month + 1, 0)) return 0;
  }
  if (r.frequency === 'weekly') {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    let count = 0;
    const d = new Date(monthStart);
    const dayOfWeek = r.due_day ?? 5;
    while (d.getDay() !== dayOfWeek) d.setDate(d.getDate() + 1);
    while (d <= monthEnd) { count++; d.setDate(d.getDate() + 7); }
    return amt * count + matched;
  }
  if (r.frequency === 'biweekly') {
    return amt * countRuleOccurrencesInMonth(r, year, month) + matched;
  }
  if (r.frequency === 'yearly') {
    const dueMonth = (r.due_month ?? 1) - 1;
    return dueMonth === month ? amt + matched : 0;
  }
  return amt + matched;
}

/**
 * "Aug 2027" — the month a ranked extra lands in, from its offset.
 *
 * `nextAutoExtraForGoal` returns an OFFSET from the projection's month 0, deliberately: that module
 * has no calendar. Month 0 is the current month, so the offset is added to it here, at render time,
 * in the one place that knows what today is.
 */
export const nextExtraMonthLabel = (monthIndex: number, now: Date): string =>
  new Date(now.getFullYear(), now.getMonth() + monthIndex, 1)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/** The five buckets every total on this page is a sum over. */
export interface BudgetBuckets {
  incomeRules: BudgetRule[];
  fixedRules: BudgetRule[];
  variableRules: BudgetRule[];
  debtRules: BudgetRule[];
  transferRules: BudgetRule[];
}

export interface BudgetTotals {
  income: number;
  fixed: number;
  variable: number;
  debt: number;
  transfers: number;
  /** Fixed + variable. The shortfall test's "charges" — NOT a month's full cost. */
  charges: number;
  /** All four spending buckets. This is the Monthly Spend tile and the donut's denominator. */
  expenses: number;
  remaining: number;
}

export const buildIncomeRules = (rules: BudgetRule[]): BudgetRule[] =>
  rules.filter(r => r.rule_type === 'income');

/**
 * Fixed expenses, with the Subscriptions page's rows merged in. A subscription whose name already
 * matches one of the user's own rules is dropped — otherwise the same bill is counted twice.
 */
export const buildFixedRules = (rules: BudgetRule[], subsAsRules: BudgetRule[]): BudgetRule[] => {
  const fixed = rules.filter(r => r.rule_type === 'expense' && isFixedRule(r));
  const ruleNames = new Set(fixed.map(r => r.name.toLowerCase()));
  const uniqueSubs = subsAsRules.filter(s => !ruleNames.has(s.name.toLowerCase()));
  return [...fixed, ...uniqueSubs];
};

export const buildVariableRules = (rules: BudgetRule[]): BudgetRule[] =>
  rules.filter(r => r.rule_type === 'expense' && !isFixedRule(r));

export const buildManualDebtRules = (rules: BudgetRule[]): BudgetRule[] =>
  rules.filter(r => r.rule_type === 'debt_payment' || (r.rule_type === 'expense' && r.category === 'Debt Payments'));

/**
 * The user's own debt rules plus the synthetic rows from Debt Payoff and Vehicles.
 *
 * The loan and liability rows go through the SAME name filter as the card rows, and for them it is
 * the only guard there is: a card row can be matched to an account, but `LoanRecRow` has no
 * `paidByExpenseRule` equivalent, so a user who typed their own "C5 Payment" rule would otherwise
 * see the loan twice and pay it twice in the total.
 */
export const buildDebtRules = (
  manualDebtRules: BudgetRule[],
  debtPaymentRules: BudgetRule[],
  liabilityPaymentRules: BudgetRule[],
): BudgetRule[] => {
  const manualNames = new Set(manualDebtRules.map(r => r.name.toLowerCase()));
  const uniqueDebtSync = [...debtPaymentRules, ...liabilityPaymentRules]
    .filter(d => !manualNames.has(d.name.toLowerCase()));
  return [...manualDebtRules, ...uniqueDebtSync];
};

export const buildTransferRules = (rules: BudgetRule[], goalTransferRules: BudgetRule[]): BudgetRule[] => [
  ...rules.filter(r => r.rule_type === 'transfer' || r.rule_type === 'investment'),
  ...goalTransferRules,
];

/**
 * The five bucket totals and the three figures derived from them, over ACTIVE rules only.
 *
 * `amountOf` is passed in rather than recomputed so a caller that already memoised the per-rule
 * arithmetic (both pages do) keeps one evaluation per rule.
 */
export function budgetMonthTotals(
  buckets: BudgetBuckets,
  amountOf: (r: BudgetRule) => number,
): BudgetTotals {
  const sum = (rows: BudgetRule[]) => rows.filter(r => r.active).reduce((s, r) => s + amountOf(r), 0);

  const income = sum(buckets.incomeRules);
  const fixed = sum(buckets.fixedRules);
  const variable = sum(buckets.variableRules);
  const debt = sum(buckets.debtRules);
  const transfers = sum(buckets.transferRules);

  const charges = fixed + variable;
  const expenses = charges + debt + transfers;

  return { income, fixed, variable, debt, transfers, charges, expenses, remaining: income - expenses };
}
