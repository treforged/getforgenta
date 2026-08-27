import { useCallback, useMemo } from 'react';
import { useRecurringRules, useSubscriptions, useSavingsGoals } from '@/hooks/useSupabaseData';
import { useCardProjectionContext } from '@/contexts/CardProjectionContext';
import { useMonth0DebtBreakdown } from '@/hooks/useMonth0DebtBreakdown';
import { useMatchedOccurrences, type MatchedOccurrencesResult } from '@/hooks/useMatchedOccurrences';
import { matchedRuleIdsInMonth } from '@/lib/matched-occurrence-display';
import { buildAutoExtraByTarget, autoExtraForGoalAtMonth, nextAutoExtraForGoal } from '@/lib/auto-extra-projection';
import {
  budgetMonthTotals, currentMonthAmount,
  buildIncomeRules, buildFixedRules, buildVariableRules, buildManualDebtRules, buildDebtRules, buildTransferRules,
  type BudgetRule, type BudgetBuckets, type BudgetTotals,
} from '@/lib/budget-month-totals';
import type { MonthlyDebtBreakdown } from '@/lib/credit-card-engine';

/**
 * The current month's budget, derived ONCE for every surface that shows it.
 *
 * Budget Control owned this arithmetic and the Dashboard had none of it, so moving the seven KPI
 * tiles to the Dashboard (Tre, 2026-08-27: *"i wanted these moved to dashboard"*) had two possible
 * shapes: copy the derivation, or share it. Copied, the two pages would agree on the day they were
 * written and drift on the first change to any of the five buckets — and four of those buckets are
 * merged from OTHER tables (Subscriptions, Debt Payoff, Vehicles, Savings Goals), which is exactly
 * the kind of assembly that gets fixed on one page and forgotten on the other.
 *
 * So both pages call this. The five buckets, the per-rule month amount and the totals are computed
 * here, and "the same numbers on both pages" is true by construction rather than by inspection.
 *
 * ⚠️ `useMonth0DebtBreakdown` and `useMatchedOccurrences` are RE-EXPORTED rather than left to the
 * caller. Both re-run their derivation per call site, so a page that needs the debt breakdown for
 * its own reasons (Budget Control does — the transaction stream) must take it from here instead of
 * calling the hook a second time.
 *
 * Must be used inside `CardProjectionProvider` (mounted by `DashboardLayout`), like the debt
 * breakdown it wraps.
 */
export interface BudgetMonthTotalsResult {
  /** The five buckets, each already merged with its synthetic rows. */
  buckets: BudgetBuckets;
  /** The five totals plus `charges` / `expenses` / `remaining`, over ACTIVE rules only. */
  totals: BudgetTotals;
  /** What one rule costs in the CURRENT month, matched-transaction delta included. */
  toCurrentMonthAmount: (r: BudgetRule) => number;
  /** The user's own `recurring_rules` debt rows, before the synthetic ones are merged in. */
  manualDebtRules: BudgetRule[];
  /** Rows synthesised from Subscriptions. */
  subsAsRules: BudgetRule[];
  /** Card payment rows synthesised from Debt Payoff. */
  debtPaymentRules: BudgetRule[];
  /** Loan and other-liability payment rows synthesised from Vehicles / Accounts. */
  liabilityPaymentRules: BudgetRule[];
  /** Rows synthesised from a savings goal's own `monthly_contribution`. */
  goalTransferRules: BudgetRule[];
  /** The converged month-0 debt breakdown these rows were built from. */
  debtBreakdown: MonthlyDebtBreakdown;
  /** The matched-occurrence index the month amounts already account for. */
  matched: MatchedOccurrencesResult;
  /** Rule ids a real settled transaction answered this month — the "matched" chip. */
  autoMatchedRuleIds: Set<string>;
}

/**
 * The note on a synthetic "from payoff" rule.
 *
 * A recommendation's `reason` is written for the /debt row, where it sits beside the amount it
 * describes. Standing alone as a note it has to carry itself, and two of the values cannot: an
 * unmodelled card has no reason at all (empty string, which reads as a missing note rather than
 * a card the projection could not price), and a bare "Partial statement" names a balance without
 * saying what is being done about it. Copy only, the amount and due day are untouched.
 */
const debtSyncNote = (reason: string): string => {
  if (!reason) return 'From Debt Payoff. No payment modelled for this card yet.';
  if (reason === 'Partial statement') return 'Covers part of the statement balance.';
  return reason;
};

export function useBudgetMonthTotals(): BudgetMonthTotalsResult {
  const { data: rules } = useRecurringRules();
  const { data: subs } = useSubscriptions();
  const { data: savingsGoals } = useSavingsGoals();
  const { projections } = useCardProjectionContext();

  const debtBreakdown = useMonth0DebtBreakdown();
  const {
    recommendations: debtRecommendations,
    loanRecommendations,
    otherDebtRecommendations,
  } = debtBreakdown;

  const matched = useMatchedOccurrences();
  const { index: matchedOccurrences, monthKey: currentMonthKey } = matched;

  const autoMatchedRuleIds = useMemo(
    () => matchedRuleIdsInMonth(matchedOccurrences, currentMonthKey),
    [matchedOccurrences, currentMonthKey],
  );

  // Merge subscriptions into fixed rules view
  const subsAsRules = useMemo((): BudgetRule[] => subs.filter(s => s.active).map(s => ({
    id: `sub:${s.id}`,
    name: s.name,
    amount: Number(s.cost),
    rule_type: 'expense',
    frequency: s.billing === 'yearly' ? 'yearly' : 'monthly',
    due_day: s.renewal_date ? new Date(s.renewal_date + 'T12:00:00').getDate() : 1,
    due_month: s.billing === 'yearly' && s.renewal_date ? new Date(s.renewal_date + 'T12:00:00').getMonth() + 1 : null,
    category: 'Subscriptions',
    payment_source: null,
    deposit_account: null,
    notes: 'From Subscriptions',
    active: s.active,
    isSub: true,
  })), [subs]);

  const debtPaymentRules = useMemo((): BudgetRule[] =>
    debtRecommendations.map(r => ({
      id: `debt:${r.cardId}`,
      name: `${r.cardName} Payment`,
      amount: Math.round(r.payment * 100) / 100,
      rule_type: 'debt_payment',
      frequency: 'monthly',
      due_day: r.dueDay || 1,
      due_month: null,
      category: 'Debt Payments',
      payment_source: null,
      deposit_account: null,
      notes: debtSyncNote(r.reason),
      active: true,
      isDebtSync: true,
    })),
    [debtRecommendations],
  );

  /**
   * The NON-CARD half of "Debt Payments": a vehicle loan from the Vehicles page, a student loan,
   * a mortgage, a liability account paired to a `debts` row.
   *
   * `useMonth0DebtBreakdown` has always returned these two lists and Budget Control dropped both on
   * the floor, so Tre's auto loan (~$422.89/mo) was missing from the Debt Payments tile, the tab
   * total and the allocation donut — which is why the donut read "Debt 0%" against real monthly
   * debt. Measured live 2026-08-27: he has 31 recurring rules and NOT ONE of
   * `rule_type: 'debt_payment'`, so nothing else was covering the loan either.
   *
   * `row.payment` is THIS month's scheduled payment, listed whether or not it has already left the
   * account — every other tile in that KPI row states the full month's planned cost, and a payment
   * that vanished on the day it cleared would make the month look cheaper than it is.
   *
   * ⚠️ A liability with `paidByExpenseRule` is SKIPPED. The user's own expense rule of that name is
   * already listed under Bills and already counted, so a second row would double the debt both on
   * screen and in the total. That flag exists for exactly this decision.
   *
   * ⚠️ Both builders already drop a debt whose final payment is behind us, so no "$0 payment on a
   * dead loan" row can reach this list.
   */
  const liabilityPaymentRules = useMemo((): BudgetRule[] => [
    ...(loanRecommendations ?? []).map(l => ({
      id: `loan:${l.carFundId}`,
      name: `${l.name} Payment`,
      amount: Math.round(l.payment * 100) / 100,
      rule_type: 'debt_payment',
      frequency: 'monthly',
      due_day: l.dueDay,
      due_month: null,
      category: 'Debt Payments',
      payment_source: null,
      deposit_account: null,
      notes: l.isFinalPayment ? 'From Vehicles. Final payment on this loan.' : 'From Vehicles. Auto loan payment.',
      active: true,
      isDebtSync: true,
    })),
    ...(otherDebtRecommendations ?? [])
      .filter(o => !o.paidByExpenseRule)
      .map(o => ({
        id: `liab:${o.accountId}`,
        name: `${o.name} Payment`,
        amount: Math.round(o.payment * 100) / 100,
        rule_type: 'debt_payment',
        frequency: 'monthly',
        due_day: o.dueDay,
        due_month: null,
        category: 'Debt Payments',
        payment_source: null,
        deposit_account: null,
        notes: o.isFinalPayment ? 'From Accounts. Final payment on this debt.' : 'From Accounts. Scheduled payment on this debt.',
        active: true,
        isDebtSync: true,
      })),
  ], [loanRecommendations, otherDebtRecommendations]);

  /**
   * The ranked automatic extra the forecast already diverts to each goal, month by month, keyed by
   * goal id. Free: `CardProjectionProvider` has already run the engine, so this re-keys rows the app
   * is holding anyway rather than forecasting a second time.
   */
  const autoExtraByGoal = useMemo(() => buildAutoExtraByTarget(projections.data ?? []), [projections]);

  /**
   * A savings goal's own `monthly_contribution` is a REAL standing transfer — the forecast moves
   * that cash out of checking every month and prices the plan around it.
   *
   * ⚠️ ONLY goals NOT funded by a real rule. A goal carrying `linked_rule_ids` is already listed as
   * that rule, and `SavingsGoals` reads the same precedence; synthesising a second row would double
   * both the total and the money on screen.
   *
   * `start_date` carries the goal's `contribution_start_date`, so `toCurrentMonthAmount` zeroes a
   * transfer that has not begun yet exactly as it does for a dated rule. `due_day` is deliberately
   * null — a goal contribution has no day of the month, and inventing one prints a date the user
   * never set.
   */
  const goalTransferRules = useMemo((): BudgetRule[] => savingsGoals
    .filter(g => {
      const ruleIds = (g.linked_rule_ids ?? []).length > 0
        ? (g.linked_rule_ids ?? [])
        : g.linked_rule_id ? [g.linked_rule_id] : [];
      if (ruleIds.some(id => rules.some(r => r.id === id))) return false;
      return Number(g.monthly_contribution) > 0;
    })
    .map(g => ({
      id: `goal:${g.id}`,
      name: `${g.name} Contribution`,
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
      extraThisMonth: autoExtraForGoalAtMonth(autoExtraByGoal, g.id ?? '', 0),
      // Only when THIS month has none. A month with an extra states its own figure; adding "and
      // another one in March" beside it is noise. A month without one used to say nothing at all,
      // and on his live data that silence covers a goal 40 of whose next 60 months take an extra.
      nextExtra: autoExtraForGoalAtMonth(autoExtraByGoal, g.id ?? '', 0) > 0
        ? null
        : nextAutoExtraForGoal(autoExtraByGoal, g.id ?? ''),
    })), [savingsGoals, rules, autoExtraByGoal]);

  const manualDebtRules = useMemo(() => buildManualDebtRules(rules), [rules]);

  const buckets = useMemo((): BudgetBuckets => ({
    incomeRules: buildIncomeRules(rules),
    fixedRules: buildFixedRules(rules, subsAsRules),
    variableRules: buildVariableRules(rules),
    debtRules: buildDebtRules(manualDebtRules, debtPaymentRules, liabilityPaymentRules),
    transferRules: buildTransferRules(rules, goalTransferRules),
  }), [rules, subsAsRules, manualDebtRules, debtPaymentRules, liabilityPaymentRules, goalTransferRules]);

  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();

  const toCurrentMonthAmount = useCallback(
    (r: BudgetRule) => currentMonthAmount(r, nowYear, nowMonth, matchedOccurrences),
    [nowYear, nowMonth, matchedOccurrences],
  );

  const totals = useMemo(
    () => budgetMonthTotals(buckets, toCurrentMonthAmount),
    [buckets, toCurrentMonthAmount],
  );

  return {
    buckets,
    totals,
    toCurrentMonthAmount,
    manualDebtRules,
    subsAsRules,
    debtPaymentRules,
    liabilityPaymentRules,
    goalTransferRules,
    debtBreakdown,
    matched,
    autoMatchedRuleIds,
  };
}
