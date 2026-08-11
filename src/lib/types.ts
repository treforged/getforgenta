export type Transaction = {
  id: string;
  user_id: string;
  date: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  account: string;
  note: string;
  payment_source?: string;
  car_build_item_id?: string | null;
  car_maintenance_log_id?: string | null;
  created_at: string;
};

export type Debt = {
  id: string;
  user_id: string;
  name: string;
  balance: number;
  apr: number;
  min_payment: number;
  target_payment: number;
  credit_limit?: number;
  created_at: string;
};

export type SavingsGoal = {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  monthly_contribution: number;
  target_date: string;
  lump_sum_payments: { id: string; date: string; amount: number }[];
  created_at: string;
};

export type CarFundPhase = 'saving' | 'loan';

/** Finding §2.10. There is deliberately no `'account_balance'` mode: where a car fund links to a
 * SEPARATE account the app already derives the saved figure from that balance live, and where it
 * links to the funding account itself, claiming the whole balance would double-count the same
 * dollars that are already offered as available cash. */
export type CarFundSavedSource = 'fixed' | 'account_percent';

export type CarFund = {
  id: string;
  user_id: string;
  vehicle_name: string;
  target_price: number;
  tax_fees: number;
  down_payment_goal: number;
  current_saved: number;
  /** How the "already saved" figure is determined — finding §2.10. `'fixed'` (the default, and
   * every pre-§2.10 row) means the typed `current_saved`; `'account_percent'` means
   * `saved_percent`% of `linked_account`'s live balance, which can never exceed that balance and
   * so cannot produce §2.9's shortfall. Read it through `getCarFundSaved`, never directly. */
  saved_source: CarFundSavedSource;
  /** Percent (0-100) of `linked_account`'s balance treated as car savings under
   * `saved_source === 'account_percent'`. Ignored in `'fixed'` mode. */
  saved_percent: number;
  monthly_insurance: number;
  expected_apr: number;
  loan_term_months: number;
  phase: CarFundPhase;
  loan_amount: number;
  loan_start_date: string | null;
  payment_start_date: string | null;
  interest_start_date: string | null;
  insurance_start_date: string | null;
  actual_monthly_payment: number;
  linked_account: string | null;
  linked_rule_id: string | null;
  /** Account the ongoing monthly loan payment is paid from, once phase === 'loan'. Independent of
   * linked_account, which is only ever the down-payment savings account. Null means the payment
   * comes from the generic liquid-cash pool (today's default behavior, unchanged). */
  loan_payment_account: string | null;
  planned_purchase_date: string | null;
  gift_contribution: number;
  lump_sum_payments: { id: string; date: string; amount: number; label?: string }[];
  created_at: string;
};

export type LumpSumTransfer = {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  label: string | null;
  destination_type: 'savings' | 'brokerage' | 'roth_ira';
  created_at: string;
};

export type Profile = {
  id: string;
  display_name: string;
  currency: string;
  monthly_income_default: number;
  budget_start_day: number;
  show_cents: boolean;
  compact_mode: boolean;
  is_premium: boolean;
  created_at: string;
};

export type Asset = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  value: number;
  notes: string;
  created_at: string;
};

export type Liability = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  balance: number;
  apr: number;
  notes: string;
  created_at: string;
};

export const CATEGORIES = [
  'Bills', 'Rent', 'Mortgage', 'Utilities', 'Insurance',
  'Groceries', 'Gas', 'Dining', 'Shopping', 'Entertainment',
  'Subscriptions', 'Health', 'Personal', 'Travel', 'Car',
  'Education', 'Pets', 'Clothing', 'Gifts',
  'Savings', 'Investing', 'Business', 'Business Contributions', 'Debt Payments',
  'Income', 'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const PAYMENT_SOURCES = ['credit_card', 'bank_account', 'cash'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  credit_card: 'Credit Card',
  bank_account: 'Bank Account',
  cash: 'Cash',
};

export const ASSET_TYPES = [
  'Checking', 'Savings', 'Brokerage', 'Retirement', 'Cash', 'Vehicle', 'Other',
] as const;

export const LIABILITY_TYPES = [
  'Credit Card', 'Student Loan', 'Auto Loan', 'Personal Loan', 'Other',
] as const;

export const CATEGORY_EMOJI: Record<string, string> = {
  Bills: '📄', Rent: '🏠', Mortgage: '🏡', Utilities: '💡', Insurance: '🛡️',
  Groceries: '🛒', Gas: '⛽', Dining: '🍽️', Shopping: '🛍️', Entertainment: '🎮',
  Subscriptions: '📺', Health: '💊', Personal: '🧴', Travel: '✈️', Car: '🚗',
  Education: '📚', Pets: '🐾', Clothing: '👕', Gifts: '🎁',
  Savings: '🐷', Investing: '📈', Business: '💼', 'Debt Payments': '💳',
  Income: '💰', Other: '📦',
};

export type CarBuild = {
  id: string;
  user_id: string;
  name: string;
  year: number | null;
  make: string | null;
  model: string | null;
  notes: string | null;
  sort_order: number;
  share_token: string | null;
  photos: string[] | null;
  created_at: string;
};

export type CarBuildPhase = {
  id: string;
  build_id: string;
  user_id: string;
  title: string;
  sort_order: number;
  hidden: boolean;
  created_at: string;
};

export type CarBuildItem = {
  id: string;
  phase_id: string;
  build_id: string;
  user_id: string;
  name: string;
  brand: string | null;
  price: number | null;
  link: string | null;
  completed: boolean;
  sort_order: number;
  payment_plan_id?: string | null;
  created_at: string;
};

export type CarMaintenanceLog = {
  id: string;
  build_id: string;
  user_id: string;
  service: string;
  service_date: string;
  odometer: number | null;
  cost: number | null;
  vendor: string | null;
  notes: string | null;
  interval_months: number | null;
  interval_miles: number | null;
  next_due_date: string | null;
  next_due_odometer: number | null;
  created_at: string;
};

export const CATEGORY_ICONS: Record<string, string> = {
  Bills: 'Receipt',
  Groceries: 'ShoppingCart',
  Gas: 'Fuel',
  Dining: 'UtensilsCrossed',
  Entertainment: 'Gamepad2',
  Subscriptions: 'Repeat',
  'Debt Payments': 'Landmark',
  Savings: 'PiggyBank',
  Investing: 'TrendingUp',
  Car: 'Car',
  Travel: 'Plane',
  Other: 'MoreHorizontal',
};
