import { useMemo } from 'react';
import {
  useTransactions, useDebts, useSavingsGoals, useCarFunds, useAccounts, useProfile,
  useRecurringRules, useAssets, useLiabilities, usePaymentPlans, type AccountRow,
} from '@/hooks/useSupabaseData';
import { useMonth0DebtBreakdown } from '@/hooks/useMonth0DebtBreakdown';
import {
  mergeWithGeneratedTransactions, createDebtPaymentTransactions, mergeDebtPaymentsIntoStream,
} from '@/lib/pay-schedule';
import { categorizeExpenses, getDebtPaymentsByCard } from '@/lib/expense-filtering';
import { buildMonthlyExpenseModel } from '@/lib/monthly-expense-model';
import { getActiveCarLoanPayments } from '@/lib/vehicle-loan-engine';
import { buildNetWorthBreakdown, sumBalanceByAccountType, LIQUID_ACCOUNT_TYPES } from '@/lib/net-worth';
import { debtToIncomeRatio } from '@/lib/debt-to-income';
import { resolveCashFloor } from '@/lib/cash-floor';

export interface CashFlowMonth {
  month: string;
  income: number;
  expenses: number;
  net: number;
}

/**
 * THE MONTH'S CASH-FLOW MODEL, ONE DEFINITION FOR EVERY PAGE THAT SHOWS IT.
 *
 * Tre approved moving two Overview cards off the dashboard on 2026-09-20 (ask 035ffb29 / fe8839c2):
 * Advanced Analytics to its own /account section, Cash Flow Overview to /forecast. Both cards read
 * figures that were derived INSIDE Dashboard.tsx, so "moving" them meant one of two things - copy
 * the derivation into two more pages, or lift it out once. Copying would have left three
 * definitions of "this month's income and expenses" free to drift, which is the defect class this
 * repo keeps paying for (the §2.4 expense gap was exactly that). So the chain moved HERE,
 * VERBATIM, and Dashboard, Forecast and Account all read it.
 *
 * ⚠️ NOTHING IN HERE IS NEW MONEY LOGIC. Every memo below is the body that stood in Dashboard.tsx
 * until this commit, with its comment carried along. If a figure here disagrees with what the
 * dashboard showed yesterday, that is a regression in this file, not a policy change.
 *
 * ⚠️ MUST BE USED INSIDE `CardProjectionProvider` (mounted by DashboardLayout), because
 * `useMonth0DebtBreakdown` reads it. Every data hook here is react-query backed, so three pages
 * calling it cost cache reads, not three round trips.
 */
export function useMonthlyCashFlow() {
  const { data: transactions, loading: txnLoading } = useTransactions();
  const { data: accounts, loading: acctLoading } = useAccounts();
  const { data: profile, loading: profileLoading } = useProfile();
  const { data: debts } = useDebts();
  const { data: goals } = useSavingsGoals();
  const { data: carFunds } = useCarFunds();
  const { data: rules } = useRecurringRules();
  const { data: manualAssets } = useAssets();
  const { data: manualLiabilities } = useLiabilities();
  const { data: paymentPlans } = usePaymentPlans();

  const accountMap = useMemo(() => {
    const map: Record<string, AccountRow> = {};
    accounts.forEach(a => {
      map[a.id] = a;
      map[`account:${a.id}`] = a;
    });
    return map;
  }, [accounts]);

  const baseTxns = useMemo(
    () => mergeWithGeneratedTransactions(transactions, rules, accounts),
    [transactions, rules, accounts],
  );

  const fundingAccountId = useMemo(() => {
    const defaultId = profile?.default_deposit_account;
    if (defaultId) return defaultId;
    const checking = accounts.find(a => a.account_type === 'checking' && a.active);
    return checking?.id || null;
  }, [accounts, profile]);

  // Card payments due this month, from the converged month-0 projection that Debt Payoff and
  // Forecast read. Replaces the legacy getMonthlyDebtBreakdown pass, which ran its own floor,
  // save-up and income-timing logic and so put a different payment on this page than on /debt.
  const debtBreakdown = useMonth0DebtBreakdown();

  const debtPaymentTxns = useMemo(
    () => createDebtPaymentTransactions(debtBreakdown.recommendations, fundingAccountId),
    [debtBreakdown.recommendations, fundingAccountId],
  );

  const allMonthTransactions = useMemo(
    () => mergeDebtPaymentsIntoStream(baseTxns, debtPaymentTxns),
    [baseTxns, debtPaymentTxns],
  );

  // One rollup drives both the NET WORTH tile and the breakdown lists below it,
  // so the itemised rows always sum to the headline number. See lib/net-worth.ts.
  // Financed vehicles live in car_funds, not accounts, and carry no stored
  // balance — amortized here so they count as liabilities. Same call the
  // Vehicles page uses, so the two can't disagree.
  const vehicleLoans = useMemo(() => getActiveCarLoanPayments(carFunds ?? []), [carFunds]);

  const netWorthBreakdown = useMemo(
    () => buildNetWorthBreakdown(accounts, manualAssets, manualLiabilities, vehicleLoans),
    [accounts, manualAssets, manualLiabilities, vehicleLoans],
  );

  // Same expression as the dashboard's `accountSummary.liquidCash`, which is what the runway
  // divided by. Computed here rather than passed in so the runway card needs no page context.
  const liquidCash = useMemo(
    () => sumBalanceByAccountType(accounts.filter(a => a.active), LIQUID_ACCOUNT_TYPES),
    [accounts],
  );

  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const currentMonthTransactions = useMemo(
    () => allMonthTransactions.filter(t => t.date?.startsWith(currentMonthStr)),
    [allMonthTransactions, currentMonthStr],
  );

  // §2.4. The transaction stream expands recurring rules ONLY, so every aggregate built straight
  // off it silently omitted payment plans, the auto loan and vehicle insurance — $1,226/mo of real
  // obligations on real data, which is why this page read $3,196 of expenses while /transactions
  // read $6,243 for the same month. `buildMonthlyExpenseModel` re-derives the month from the
  // filtered sources (never the raw generators, which over-emit) and every consumer below now
  // reads it. Engine-derived numbers — MONTH-END CASH, Safe to Pay, the floor — were always
  // correct and are deliberately untouched.
  const creditCardSourceIds = useMemo(
    () => new Set<string>(
      accounts.filter(a => a.active && a.account_type === 'credit_card').flatMap(a => [a.id, `account:${a.id}`]),
    ),
    [accounts],
  );

  const expenseModel = useMemo(
    () => buildMonthlyExpenseModel({
      monthTxns: currentMonthTransactions,
      paymentPlans: paymentPlans ?? [],
      carFunds: carFunds ?? [],
      creditCardSourceIds,
      asOf: new Date(),
    }),
    [currentMonthTransactions, paymentPlans, carFunds, creditCardSourceIds],
  );

  const debtPaymentBreakdown = useMemo(
    () => getDebtPaymentsByCard(currentMonthTransactions),
    [currentMonthTransactions],
  );

  const totalDebtPayments = useMemo(
    () => debtPaymentBreakdown.reduce((s, d) => s + d.amount, 0),
    [debtPaymentBreakdown],
  );

  const summary = useMemo(() => {
    const income = currentMonthTransactions
      .filter(t => t.type === 'income' && t.category !== 'Balance Adjustment')
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    // §2.4 Phase 2 — Option B (Tre's decision, 2026-08-06): debt PRINCIPAL is not an expense,
    // interest is. Repaying principal moves money between two of your own columns; it is not
    // spending, and counting it as such made "Monthly Expenses" a number you could shrink by
    // paying off less debt. So the tile is now living + interest, and the principal is reported
    // beside it as DEBT SERVICE rather than hidden inside a total.
    //
    // Phase 1 was a RELABEL, not a revaluation: `expenses + debtService` equalled the old
    // `expensesAllIn + totalDebtPayments` exactly.
    //
    // ⚠️ §2.4 PHASE 2 (2026-08-19) BREAKS THAT IDENTITY ON PURPOSE, and it is now
    // `expenses + debtService + transfers`. Contributions to your own savings and investment
    // accounts left `expenses`, because they are not spending — and while they sat inside it the
    // "Annual Savings" tile went DOWN the more the user saved. On the demo account, $1,375/mo of
    // 401k, Roth, brokerage and emergency-fund transfers were being counted as money gone, which
    // is what put that tile at −$3,185 a year for someone saving $16,500 of it.
    // `expensesAllIn` is unchanged to the cent, so every cash-that-left surface is untouched.
    const expenses = expenseModel.expenses;
    const debtService = expenseModel.principal + totalDebtPayments;
    const totalDebt = debts.reduce((s, d) => s + Number(d.balance || 0), 0);

    const totalSaved = goals.reduce((s: number, g) => {
      if (g.linked_account && accountMap[g.linked_account]) {
        return s + Number(accountMap[g.linked_account].balance);
      }
      return s + Number(g.current_amount || 0);
    }, 0);

    const cashFlow = income - expenses - debtService;
    const savingsRate = income > 0 ? (cashFlow / income) * 100 : 0;

    return { income, expenses, debtService, cashFlow, totalDebt, totalSaved, savingsRate };
  }, [currentMonthTransactions, expenseModel, totalDebtPayments, debts, goals, accountMap]);

  const cashFlowData = useMemo((): CashFlowMonth[] => {
    const months: CashFlowMonth[] = [];
    const nowDate = new Date();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
      const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthName = d.toLocaleString('en', { month: 'short' });

      if (i === 0) {
        // ALL-IN: months 1-5 are recorded actuals from `categorizeExpenses`, which knows nothing
        // of Option B. Plotting an Option B month 0 against five all-in months would make the bar
        // drop for a reason that is purely a change of label.
        months.push({ month: monthName, income: summary.income, expenses: expenseModel.expensesAllIn, net: summary.cashFlow });
      } else {
        const monthTxns = baseTxns.filter(t => t.date?.startsWith(monthStr));
        const inc = monthTxns.filter(t => t.type === 'income' && t.category !== 'Balance Adjustment').reduce((s, t) => s + Number(t.amount), 0);
        const expBreakdown = categorizeExpenses(monthTxns, true);
        const exp = Object.values(expBreakdown).reduce((s: number, v: number) => s + v, 0);
        months.push({ month: monthName, income: Math.round(inc), expenses: Math.round(exp), net: Math.round(inc - exp) });
      }
    }

    return months;
  }, [summary, expenseModel.expensesAllIn, baseTxns]);

  const avgMonthlySpend = useMemo(() => {
    const past = cashFlowData.slice(0, 5);
    const total = past.reduce((s, m) => s + m.expenses, 0);
    return past.length > 0 ? total / past.length : 0;
  }, [cashFlowData]);

  const cashFloor = resolveCashFloor(profile);

  const emergencyRunwayMonths = useMemo(() => {
    // ALL-IN: runway asks how long the cash lasts, and every dollar of principal still has to be
    // paid when the income stops. An Option B burn rate would flatter the runway by the principal.
    const burn = expenseModel.cashOut + totalDebtPayments;
    if (burn <= 0) return null;
    const available = Math.max(0, liquidCash - cashFloor);
    return available / burn;
  }, [liquidCash, cashFloor, expenseModel.cashOut, totalDebtPayments]);

  // ⚠️ NOT `debtBreakdown.totalMinimumsDue`, which is what is still UNPAID on the cards this month.
  // Dividing that by income gave a ratio that fell to 0% as the month's minimums cleared, ignored
  // every loan, and ignored autopay-in-full cards — 0.5% and "healthy" for an account carrying
  // $47,200. `debt-to-income.ts` carries the reasoning and the contractual-not-chosen rule.
  const dti = useMemo(
    () => debtToIncomeRatio({ debts, accounts, carFunds, income: summary.income }),
    [debts, accounts, carFunds, summary.income],
  );

  return {
    loading: txnLoading || acctLoading || profileLoading,
    accountMap,
    baseTxns,
    fundingAccountId,
    debtBreakdown,
    debtPaymentTxns,
    allMonthTransactions,
    vehicleLoans,
    netWorthBreakdown,
    currentMonthTransactions,
    creditCardSourceIds,
    expenseModel,
    debtPaymentBreakdown,
    totalDebtPayments,
    summary,
    cashFlowData,
    avgMonthlySpend,
    cashFloor,
    emergencyRunwayMonths,
    dti,
  };
}
