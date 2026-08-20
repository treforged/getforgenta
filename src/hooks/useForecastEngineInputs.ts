import { useMemo } from 'react';
import {
  useDebts, useSavingsGoals, useCarFunds, useAccounts, useBudgetItems,
  useProfile, useRecurringRules, useTransactions, usePaymentPlans, useSyncedTransactionReviews,
} from '@/hooks/useSupabaseData';
import { buildConfirmedOccurrences, isRuleOccurrenceConfirmed } from '@/lib/confirmed-capture';
import { aggregateByMonth, type ScheduledEvent } from '@/lib/scheduling';
import { buildCardData, getMonthlyDebtBreakdown, CC_DEFAULT_CATEGORIES, PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { buildRankedTargets } from '@/lib/ranked-extra-payment-targets';
import { payoffOrderAsOf } from '@/lib/debt-payoff-order';
import { getMonthlyPlanCashExpenses } from '@/lib/payment-plan-generator';
import { getDebtPaymentsByMonth, getDebtBalancesByMonth } from '@/lib/debt-transaction-generator';
import { getPrePaycheckNextMonthBills, mergeWithGeneratedTransactions, type EnrichedTransaction, type PayScheduleConfig } from '@/lib/pay-schedule';
import { getTotalCarLoanMonthly } from '@/lib/vehicle-loan-engine';
import type { ForecastInputs } from '@/lib/forecast-engine';
import type { MatchableTransaction } from '@/lib/transaction-matching';
import { computeAnnualFederalWithheld } from '@/lib/income-model';
import { buildGoalOwnCompletionCutoffs } from '@/lib/goal-linkage';

/**
 * Assembles the full ForecastInputs for the pure calculateForecast engine. Extracted VERBATIM
 * from useForecastProjections (Phase 2 Option C, step 4) and parameterized on cardProjectionData
 * plus the context-sourced settings, so CardProjectionProvider can run engine passes itself for
 * the convergence loop (it sits ABOVE the context and cannot call useCardProjectionContext).
 *
 * The Supabase data hooks stay inside — they are react-query cached, so calling them here and
 * in the provider costs nothing and keeps the extraction diff mechanical.
 */

export interface ForecastEngineInputsParams {
  cardProjectionData: ForecastInputs['cardProjectionData'];
  assumptions: ForecastInputs['assumptions'];
  pauseSavings: boolean;
  payConfig: PayScheduleConfig;
  cashFloor: number;
  forecastFundingAccountId: string | null;
  syncCutoffDate: string;
  /** §1A Stage C — passed straight through to ForecastInputs. See CardProjectionContext: the SAME
   * array must reach `useCardProjection`, or the two surfaces can gate a car payment differently. */
  syncedTransactions?: readonly MatchableTransaction[];
  scheduledEvents: ScheduledEvent[];
  debtPayoffOptions: {
    strategy: 'avalanche' | 'snowball';
    paymentMode: 'variable';
    cashFloor: number;
    overrides: Record<string, Record<number, number>>;
  };
}

export function useForecastEngineInputs({
  cardProjectionData,
  assumptions,
  pauseSavings,
  payConfig,
  cashFloor,
  forecastFundingAccountId,
  syncCutoffDate,
  syncedTransactions,
  scheduledEvents,
  debtPayoffOptions,
}: ForecastEngineInputsParams) {
  const { data: debts } = useDebts();
  const { data: goals } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: accounts } = useAccounts();
  const { data: budgetItems } = useBudgetItems();
  const { data: profile } = useProfile();
  const { data: rules } = useRecurringRules();
  const { data: transactions } = useTransactions();
  const { data: paymentPlans } = usePaymentPlans();
  // §1B Stage 4A — rule occurrences the user confirmed a bank transaction already paid.
  const { data: syncedReviews } = useSyncedTransactionReviews();
  const confirmedOccurrences = useMemo(() => buildConfirmedOccurrences(syncedReviews), [syncedReviews]);

  // Annualize the "Federal Withholding" deduction from Budget Control, if the user has set one.
  // Shared with the credit-card sim (useCardProjection) via computeAnnualFederalWithheld so both
  // feed the tax estimator the same withholding figure.
  const annualFederalWithheldFromBudget = useMemo(() => {
    if (!profile) return 0;
    const jsonDeds = profile?.paycheck_deductions as { value: number; mode: string; label?: string }[] | null;
    return computeAnnualFederalWithheld(payConfig, jsonDeds);
  }, [payConfig, profile]);

  const prePaycheckBillsInfo = useMemo(() => getPrePaycheckNextMonthBills(rules, payConfig, forecastFundingAccountId), [rules, payConfig, forecastFundingAccountId]);
  const monthlyAggregates = useMemo(() => aggregateByMonth(scheduledEvents), [scheduledEvents]);

  const planExpensesByMonth = useMemo(() => {
    const now = new Date();
    const ccIds = new Set<string>(
      accounts.filter(a => a.active && a.account_type === 'credit_card')
        .flatMap(a => [a.id, `account:${a.id}`]),
    );
    return Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return getMonthlyPlanCashExpenses(
        paymentPlans ?? [], d.getFullYear(), d.getMonth(), ccIds,
        i === 0 ? syncCutoffDate : undefined,
      );
    });
  }, [accounts, paymentPlans, syncCutoffDate]);

  const debtPaymentsByMonth = useMemo(() =>
    getDebtPaymentsByMonth(accounts, transactions, rules, debts, profile, debtPayoffOptions, PROJECTION_MONTHS, planExpensesByMonth),
    [accounts, transactions, rules, debts, profile, debtPayoffOptions, planExpensesByMonth],
  );

  const debtBalancesByMonth = useMemo(() =>
    getDebtBalancesByMonth(accounts, transactions, rules, debts, profile, debtPayoffOptions, PROJECTION_MONTHS, planExpensesByMonth),
    [accounts, transactions, rules, debts, profile, debtPayoffOptions, planExpensesByMonth],
  );

  // Current-month debt breakdown — pins forecast month 0 to the same calc as Debt Payoff + Dashboard.
  const currentMonthRecommendedDebt = useMemo(() => {
    try {
      const allTxns = mergeWithGeneratedTransactions(transactions, rules, accounts);
      const retireIds = new Set<string>(
        accounts.filter((a) => a.active && ['401k', 'roth_ira', 'ira', 'hsa'].includes(a.account_type)).map((a) => a.id),
      );
      const now0 = new Date();
      const monthEnd0 = new Date(now0.getFullYear(), now0.getMonth() + 1, 0);
      const activeTransferDests0 = new Set<string>(
        rules.filter((r) =>
          r.active && (r.rule_type === 'transfer' || r.rule_type === 'investment') && r.deposit_account &&
          !(r.start_date && new Date(r.start_date + 'T00:00:00') > monthEnd0) &&
          !(r.end_date && new Date(r.end_date + 'T00:00:00') < now0),
        ).map((r) => r.deposit_account as string),
      );
      // Handoff item 4b — mirrors Dashboard.tsx's monthlySavingsAndCar exactly (this memo is its
      // byte-for-byte clone). Only the goal-keyed cutoff belongs here: `activeTransferDests0`
      // above is a double-count GUARD, not a dollar sum, so gating it would drop a completed
      // linked goal out of the guard and add its raw contribution back. Leave that set alone.
      const goalOwnCutoffs = buildGoalOwnCompletionCutoffs(goals, rules, accounts, now0);
      const savingsTotal = goals.reduce((s, g) => {
        if (g.contribution_start_date && new Date(g.contribution_start_date + 'T00:00:00') > now0) return s;
        if (g.linked_account && retireIds.has(g.linked_account)) return s;
        if (g.linked_account && activeTransferDests0.has(g.linked_account)) return s;
        const ownCutoff = g.id ? goalOwnCutoffs.get(g.id) : undefined;
        if (ownCutoff != null && ownCutoff <= 0) return s;
        return s + Number(g.monthly_contribution);
      }, 0);
      const carTotal = carFunds.reduce((s, c) => {
        if (c.phase === 'loan') return s;
        const giftAdjDownPmt = Math.max(0, Number(c.down_payment_goal) - Number(c.gift_contribution || 0));
        const rem = Math.max(0, giftAdjDownPmt - Number(c.current_saved));
        if (rem <= 0) return s;
        let monthsToGoal = 12;
        if (c.planned_purchase_date) {
          const parts = (c.planned_purchase_date as string).split('-').map(Number);
          const pd = new Date(parts[0], parts[1] - 1, parts[2]);
          monthsToGoal = Math.max(1, (pd.getFullYear() - now0.getFullYear()) * 12 + (pd.getMonth() - now0.getMonth()));
        }
        return s + Math.min(rem / monthsToGoal, rem);
      }, 0);
      const carLoanTotal = getTotalCarLoanMonthly(carFunds);
      const ccIds = new Set<string>(
        accounts.filter(a => a.active && a.account_type === 'credit_card')
          .flatMap(a => [a.id, `account:${a.id}`]),
      );
      const planExpenses = getMonthlyPlanCashExpenses(paymentPlans ?? [], now0.getFullYear(), now0.getMonth(), ccIds);
      // Ranked automatic extra payments. The targets are built HERE, not inside the engine:
      // `buildRankedTargets` reaches `getStrategyPayoffOrder`, which imports credit-card-engine, so
      // building them there would close a runtime import cycle. Every target arrives opted OUT
      // (`auto_extra` defaults false), so until a user opts one in this reserve is 0 and the
      // breakdown is byte-identical to before the feature existed.
      // ⚠️ `cardsSortOrder` is deliberately left at its default of 0 — cards first — until the
      // drag-to-rank UI has somewhere to persist the card block's position. Passing anything else
      // today would be inventing a rank the user never chose.
      const autoExtraTargets = buildRankedTargets({
        cards: buildCardData(accounts, allTxns, rules, debts),
        carFunds,
        goals,
        strategy: 'avalanche',
        asOf: payoffOrderAsOf(now0),
        fundingAccountId: forecastFundingAccountId,
        accountBalances: Object.fromEntries(accounts.map(a => [a.id, Number(a.balance)])),
      });
      const breakdown = getMonthlyDebtBreakdown(accounts, allTxns, rules, debts, profile, pauseSavings ? 0 : savingsTotal + carTotal + carLoanTotal, undefined, syncCutoffDate, planExpenses, confirmedOccurrences, { targets: autoExtraTargets });
      const safeToPayTotal = breakdown.totalRecommended;
      const autopayTotal = 0;
      return { safeToPayTotal, autopayTotal, recommendations: breakdown.recommendations };
    } catch { return null; }
  }, [accounts, transactions, rules, debts, profile, goals, carFunds, pauseSavings, syncCutoffDate, paymentPlans, confirmedOccurrences, forecastFundingAccountId]);

  // ── Shared CC-filtered month events ─────────────────────────────────────────
  const forecastMonthEvents = useMemo((): { income: number; nonPaycheckIncome: number; expenses: number }[] => {
    const now = new Date();
    const todayStr = syncCutoffDate;

    const liquidAccountIds = new Set<string>(
      accounts
        .filter((a) => a.active && ['checking', 'business_checking', 'cash'].includes(a.account_type))
        .map((a) => a.id),
    );

    const incomeToLiquidRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'income' &&
        (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
      ).map((r) => r.id),
    );

    const explicitPaycheckRuleId = profile?.paycheck_rule_id ?? undefined;
    const paycheckRuleIds = new Set<string>();
    if (explicitPaycheckRuleId) {
      paycheckRuleIds.add(explicitPaycheckRuleId);
    } else {
      rules.filter((r) =>
        r.active && r.rule_type === 'income' &&
        ['weekly', 'biweekly', 'semi_monthly'].includes(r.frequency) &&
        (!r.deposit_account || liquidAccountIds.has(r.deposit_account)),
      ).forEach((r) => paycheckRuleIds.add(r.id));
    }

    const ccPaymentSources = new Set<string>(
      accounts
        .filter((a) => a.active && a.account_type === 'credit_card')
        .flatMap((a) => [a.id, `account:${a.id}`]),
    );

    const ccExplicitRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'expense' &&
        r.payment_source && ccPaymentSources.has(r.payment_source),
      ).map((r) => r.id),
    );

    const ccDefaultRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'expense' &&
        !r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category),
      ).map((r) => r.id),
    );

    const allCcRuleIds = new Set<string>([...ccExplicitRuleIds, ...ccDefaultRuleIds]);

    const otherAccountRuleIds = new Set<string>(
      rules.filter((r) => {
        if (!r.active || r.rule_type !== 'expense' || !r.payment_source) return false;
        if (ccPaymentSources.has(r.payment_source)) return false;
        if (!forecastFundingAccountId) return false;
        const srcId = (r.payment_source as string).replace(/^account:/, '');
        return srcId !== forecastFundingAccountId;
      }).map((r) => r.id),
    );

    const savingsRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'expense' &&
        (r.category === 'Savings' || r.category === 'Investing'),
      ).map((r) => r.id),
    );

    return Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const eventsInMonth = scheduledEvents.filter(e =>
        e.date.startsWith(monthKey) && (i > 0 || e.date > todayStr),
      );

      const income = eventsInMonth
        .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId))
        .reduce((s, e) => s + e.amount, 0);

      const ruleTaxRateMap = new Map<string, number>(
        rules.filter((r) => r.rule_type === 'income' && r.tax_rate != null)
          .map((r) => [r.id, Number(r.tax_rate)]),
      );
      const nonPaycheckIncome = eventsInMonth
        .filter(e => e.type === 'income' && e.ruleId && incomeToLiquidRuleIds.has(e.ruleId) && !paycheckRuleIds.has(e.ruleId))
        .reduce((s, e) => {
          const tr = e.ruleId ? (ruleTaxRateMap.get(e.ruleId) ?? 0) : 0;
          return s + e.amount * (1 - tr / 100);
        }, 0);

      const expenses = eventsInMonth
        .filter(e =>
          e.type === 'expense' &&
          // §1B Stage 4A. Rule-generated events reach month 0 on a bare `e.date > todayStr` test
          // (above), so a bill due later this month that the user already paid still counts. A
          // confirmed link is the evidence that retires it. Applied in every month, not just
          // month 0, because `occurrence_month` already scopes a confirmation to one month.
          !isRuleOccurrenceConfirmed(e.ruleId, e.date, confirmedOccurrences) &&
          !(e.ruleId && allCcRuleIds.has(e.ruleId)) &&
          !(e.ruleId && otherAccountRuleIds.has(e.ruleId)) &&
          !(pauseSavings && e.ruleId && savingsRuleIds.has(e.ruleId)),
        )
        .reduce((s, e) => s + e.amount, 0);

      return { income, nonPaycheckIncome, expenses };
    });
  }, [accounts, rules, scheduledEvents, pauseSavings, profile, syncCutoffDate, forecastFundingAccountId, confirmedOccurrences]);

  // One-time manual transactions for forecast.
  const oneTimeByMonth = useMemo(() => {
    const result: Record<string, { income: number; expense: number }> = {};
    const ccSources = new Set(
      accounts
        .filter((a) => a.account_type === 'credit_card' && a.active)
        .flatMap((a) => [a.id, `account:${a.id}`]),
    );
    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    for (const t of transactions) {
      if ((t as EnrichedTransaction).isGenerated) continue;
      const monthKey = t.date?.substring(0, 7);
      if (!monthKey) continue;
      if (monthKey === currentMonthKey && t.date && t.date <= syncCutoffDate) continue;
      if (!result[monthKey]) result[monthKey] = { income: 0, expense: 0 };
      if (t.type === 'income') result[monthKey].income += Number(t.amount);
      else if (!t.payment_source || !ccSources.has(t.payment_source)) result[monthKey].expense += Number(t.amount);
    }
    return result;
  }, [transactions, accounts, syncCutoffDate]);

  // CC-only one-time purchases per month — display-only.
  const ccOneTimeByMonth = useMemo(() => {
    const result: Record<string, number> = {};
    const ccSources = new Set(
      accounts
        .filter((a) => a.account_type === 'credit_card' && a.active)
        .flatMap((a) => [a.id, `account:${a.id}`]),
    );
    const today = new Date();
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    for (const t of transactions) {
      if ((t as EnrichedTransaction).isGenerated) continue;
      if (t.type !== 'expense') continue;
      if (!t.payment_source || !ccSources.has(t.payment_source)) continue;
      const monthKey = t.date?.substring(0, 7);
      if (!monthKey) continue;
      if (monthKey === currentMonthKey && t.date && t.date <= syncCutoffDate) continue;
      result[monthKey] = (result[monthKey] || 0) + Number(t.amount);
    }
    return result;
  }, [transactions, accounts, syncCutoffDate]);

  // Scheduled CC rule purchases per month.
  const ccScheduledByMonth = useMemo(() => {
    const ccPaymentSources = new Set<string>(
      accounts
        .filter((a) => a.active && a.account_type === 'credit_card')
        .flatMap((a) => [a.id, `account:${a.id}`]),
    );
    const ccRuleIds = new Set<string>(
      rules.filter((r) =>
        r.active && r.rule_type === 'expense' &&
        (
          (r.payment_source && ccPaymentSources.has(r.payment_source)) ||
          (!r.payment_source && CC_DEFAULT_CATEGORIES.has(r.category))
        )
      ).map((r) => r.id),
    );
    const now = new Date();
    const todayStr = syncCutoffDate;
    return Array.from({ length: PROJECTION_MONTHS }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return scheduledEvents
        .filter(e =>
          e.type === 'expense' &&
          e.date.startsWith(monthKey) &&
          (i > 0 || e.date > todayStr) &&
          e.ruleId && ccRuleIds.has(e.ruleId),
        )
        .reduce((s, e) => s + e.amount, 0);
    });
  }, [accounts, rules, scheduledEvents, syncCutoffDate]);

  const engineInputs = useMemo<ForecastInputs>(() => ({
    debts, goals, carFunds, accounts, budgetItems, profile, assumptions, rules,
    monthlyAggregates, debtPaymentsByMonth, debtBalancesByMonth, cardProjectionData,
    payConfig, oneTimeByMonth, ccOneTimeByMonth, ccScheduledByMonth, transactions,
    currentMonthRecommendedDebt, forecastMonthEvents, forecastFundingAccountId, cashFloor,
    pauseSavings, syncCutoffDate, planExpensesByMonth, annualFederalWithheldFromBudget,
    paymentPlans: paymentPlans ?? [],
    syncedTransactions,
  }), [debts, goals, carFunds, accounts, budgetItems, profile, assumptions, rules, monthlyAggregates, debtPaymentsByMonth, debtBalancesByMonth, cardProjectionData, payConfig, oneTimeByMonth, ccOneTimeByMonth, ccScheduledByMonth, transactions, currentMonthRecommendedDebt, forecastMonthEvents, forecastFundingAccountId, cashFloor, pauseSavings, syncCutoffDate, planExpensesByMonth, annualFederalWithheldFromBudget, paymentPlans, syncedTransactions]);

  return {
    engineInputs,
    monthlyAggregates,
    debtPaymentsByMonth,
    debtBalancesByMonth,
    oneTimeByMonth,
    ccOneTimeByMonth,
    ccScheduledByMonth,
    currentMonthRecommendedDebt,
    forecastMonthEvents,
    planExpensesByMonth,
    annualFederalWithheldFromBudget,
    prePaycheckBillsInfo,
  };
}

export type ForecastEngineInputsBundle = ReturnType<typeof useForecastEngineInputs>;
