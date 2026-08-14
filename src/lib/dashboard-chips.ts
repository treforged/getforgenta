// The Dashboard's demoted stat chips.
//
// DIRECTION.md rule 2 demotes the three 4-cell MetricCard grids to one row of chips. This
// file is the mapping from already-computed Dashboard values to that row, kept out of
// Dashboard.tsx so the page stays a page. It computes nothing: every value arrives already
// derived by the memo that owned it before, and every chip keeps the same destination —
// the same drawer opener or the same route — the MetricCard it replaces had.
//
// Rule 3 lives here too: a chip with no reading shows '—', never a formatted zero.

import { formatCurrency } from './calculations';

export interface StatChip {
  /** Stable key — also the chip's a11y label prefix. */
  id: string;
  label: string;
  /** Already formatted. '—' when there is no reading; never a fabricated zero. */
  value: string;
  /** The context line the MetricCard carried in its `sub` slot. */
  sub?: string;
  /** Route to navigate to on tap. Ignored when `onClick` is set. */
  to?: string;
  /** Drawer opener. Takes precedence over `to`, matching the old ClickableMetric. */
  onClick?: () => void;
}

/** The three widget ids whose grids collapsed into the chip row. */
export const CHIP_WIDGET_IDS = ['schedule_cards', 'financial_health', 'wealth_overview'] as const;

export type ChipWidgetId = typeof CHIP_WIDGET_IDS[number];

export interface DashboardChipInput {
  rulesLoading: boolean;
  goalsLoading: boolean;
  paycheckNet: number;
  nextPayday: Date;
  billsThisWeek: { total: number; count: number };
  billsThisMonth: { total: number; count: number };
  monthEndCash: number;
  liquidCash: number;
  income: number;
  expenses: number;
  debtService: number;
  netWorth: number;
  totalAssets: number;
  savingsRate: number;
  cashFlow: number;
  utilization: number;
  ccDebt: number;
  ccLimit: number;
  totalSaved: number;
  goalCount: number;
  openMonthEndCalc: () => void;
  openLiquidCashCalc: () => void;
  openIncomeCalc: () => void;
  openExpenseCalc: () => void;
  openNetWorthCalc: () => void;
}

const money = (v: number) => formatCurrency(v, false);

export function buildDashboardChips(i: DashboardChipInput): Record<ChipWidgetId, StatChip[]> {
  return {
    schedule_cards: [
      {
        id: 'next_paycheck', label: 'Next Paycheck', value: money(i.paycheckNet),
        sub: i.nextPayday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        to: '/budget',
      },
      {
        id: 'bills_week', label: 'Bills This Week',
        // Rules still loading ⇒ the bill totals have no reading yet, and an empty schedule
        // and an unread one would otherwise both print $0.
        value: i.rulesLoading ? '—' : money(i.billsThisWeek.total),
        sub: i.rulesLoading ? 'loading…' : `${i.billsThisWeek.count} upcoming`,
        to: '/transactions',
      },
      {
        id: 'bills_month', label: 'Bills This Month',
        value: i.rulesLoading ? '—' : money(i.billsThisMonth.total),
        sub: i.rulesLoading ? 'loading…' : `${i.billsThisMonth.count} scheduled`,
        to: '/transactions',
      },
      {
        id: 'month_end_cash', label: 'Month-End Cash', value: money(i.monthEndCash),
        sub: 'after all scheduled items', onClick: i.openMonthEndCalc,
      },
    ],
    financial_health: [
      { id: 'liquid_cash', label: 'Liquid Cash', value: money(i.liquidCash), onClick: i.openLiquidCashCalc },
      {
        id: 'income', label: 'Monthly Income',
        value: i.income > 0 ? money(i.income) : '—', onClick: i.openIncomeCalc,
      },
      {
        id: 'expenses', label: 'Monthly Expenses',
        value: i.expenses > 0 ? money(i.expenses) : '—',
        sub: 'spending only', onClick: i.openExpenseCalc,
      },
      {
        id: 'debt_service', label: 'Debt Service',
        value: i.debtService > 0 ? money(i.debtService) : '—',
        sub: 'principal repaid', onClick: i.openExpenseCalc,
      },
    ],
    wealth_overview: [
      {
        id: 'net_worth', label: 'Net Worth', value: money(i.netWorth),
        sub: `${money(i.totalAssets)} assets`, onClick: i.openNetWorthCalc,
      },
      {
        id: 'savings_rate', label: 'Savings Rate',
        value: i.income > 0 ? `${i.savingsRate.toFixed(1)}%` : '—',
        sub: i.income > 0 ? `${money(i.cashFlow)} net / mo` : undefined,
        to: '/budget',
      },
      {
        id: 'utilization', label: 'Credit Utilization',
        // No known limits ⇒ no ratio. The grid printed 0.0% here, which reads as "you use
        // none of your credit" when the truth is that nothing was measured.
        value: i.ccLimit > 0 ? `${i.utilization.toFixed(1)}%` : '—',
        sub: i.ccLimit > 0 ? `${money(i.ccDebt)} / ${money(i.ccLimit)}` : 'no credit limits on file',
        to: '/debt',
      },
      {
        id: 'total_saved', label: 'Total Saved',
        value: i.goalsLoading ? '—' : money(i.totalSaved),
        sub: i.goalsLoading ? 'loading…' : `${i.goalCount} goals`,
        to: '/goals',
      },
    ],
  };
}
