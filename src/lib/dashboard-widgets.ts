export type WidgetId =
  | 'monthly_snapshot'
  | 'upcoming_week'
  | 'schedule_cards'
  | 'financial_health'
  | 'wealth_overview'
  | 'car_goal'
  | 'cash_flow_chart'
  | 'transactions_spending'
  | 'goal_progress'
  | 'advanced_analytics';

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
    description: 'Budget bar showing funding balance, remaining income, and projected surplus',
  },
  {
    id: 'upcoming_week',
    label: 'Upcoming This Week',
    description: 'Bills and expenses due in the next 7 days',
  },
  {
    id: 'schedule_cards',
    label: 'Schedule Cards',
    description: 'Next paycheck date, bills this week and month, month-end cash projection',
  },
  {
    id: 'financial_health',
    label: 'Financial Health',
    description: 'Liquid cash, monthly income, expenses, and debt payments',
  },
  {
    id: 'wealth_overview',
    label: 'Wealth Overview',
    description: 'Net worth, savings rate, credit utilization, and total saved',
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
];

export const DEFAULT_LAYOUT: WidgetConfig[] = WIDGET_META.map(w => ({
  id: w.id,
  visible: true,
}));
