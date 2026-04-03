import { Transaction, Debt, SavingsGoal, CarFund, Asset, Liability } from './types';

const now = new Date();
const y = now.getFullYear();
const m = now.getMonth();

function d(day: number, monthOffset = 0) {
  return new Date(y, m + monthOffset, day).toISOString().split('T')[0];
}

// ── Net Worth Snapshots — 14 weekly Fridays (Jan 3 – Apr 3, 2026) ─────────
// Starts negative (~-$7,800 in Jan), crosses zero around Mar 7, ends at
// +$3,900 (matches live account totals: assets $24,600 - liabilities $20,700).
// Dip at Jan 10 from a car repair that spiked CC balance.
export const demoNetWorthSnapshots = [
  { snapshot_date: '2026-01-03', total_assets: 19200, total_liabilities: 27000, net_worth:  -7800 },
  { snapshot_date: '2026-01-10', total_assets: 18500, total_liabilities: 27500, net_worth:  -9000 }, // car repair spike
  { snapshot_date: '2026-01-17', total_assets: 19100, total_liabilities: 27600, net_worth:  -8500 },
  { snapshot_date: '2026-01-24', total_assets: 19800, total_liabilities: 27300, net_worth:  -7500 },
  { snapshot_date: '2026-01-31', total_assets: 20700, total_liabilities: 26900, net_worth:  -6200 },
  { snapshot_date: '2026-02-07', total_assets: 21600, total_liabilities: 26500, net_worth:  -4900 },
  { snapshot_date: '2026-02-14', total_assets: 22500, total_liabilities: 26000, net_worth:  -3500 },
  { snapshot_date: '2026-02-21', total_assets: 23300, total_liabilities: 25500, net_worth:  -2200 },
  { snapshot_date: '2026-02-28', total_assets: 24000, total_liabilities: 25000, net_worth:  -1000 },
  { snapshot_date: '2026-03-07', total_assets: 24600, total_liabilities: 24500, net_worth:    100 }, // turns positive
  { snapshot_date: '2026-03-14', total_assets: 25200, total_liabilities: 24100, net_worth:   1100 },
  { snapshot_date: '2026-03-21', total_assets: 25900, total_liabilities: 23700, net_worth:   2200 },
  { snapshot_date: '2026-03-28', total_assets: 26500, total_liabilities: 23300, net_worth:   3200 },
  { snapshot_date: '2026-04-03', total_assets: 24600, total_liabilities: 20700, net_worth:   3900 }, // rent paid Apr 1
];

// ── Demo Transactions — 90 days of realistic activity (Jan 1 – Apr 3, 2026) ──
// Income deposits to Chase Checking (d1).
// Rent $1,600 and utilities $200 reflect the updated recurring rules.
// Gas paid from checking (d1). Groceries + dining on Sapphire (d7). Subs on Discover (d8).
export const demoTransactions: Omit<Transaction, 'id' | 'user_id' | 'created_at'>[] = [

  // ══════════════════════════════════════════════════════════
  // JANUARY 2026
  // ══════════════════════════════════════════════════════════

  // Income
  { date: d(1,  -3), type: 'income',  amount:  900.00, category: 'Other',         account: 'Checking',    note: 'Roommate – January',              payment_source: 'account:d1' },
  { date: d(2,  -3), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(9,  -3), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(16, -3), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(23, -3), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(30, -3), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },

  // Fixed expenses
  { date: d(1,  -3), type: 'expense', amount: 1600.00, category: 'Bills',         account: 'Checking',    note: 'Rent',                            payment_source: 'account:d1' },
  { date: d(4,  -3), type: 'expense', amount:   85.00, category: 'Subscriptions', account: 'Credit Card', note: 'Streaming + Gym',                 payment_source: 'account:d8' },
  { date: d(14, -3), type: 'expense', amount:  280.00, category: 'Car',           account: 'Checking',    note: 'Car Insurance – Jan',             payment_source: 'account:d1' },
  { date: d(15, -3), type: 'expense', amount:  200.00, category: 'Bills',         account: 'Checking',    note: 'Electric, Water & Internet',       payment_source: 'account:d1' },

  // Groceries (Sapphire)
  { date: d(3,  -3), type: 'expense', amount:   94.00, category: 'Groceries',     account: 'Credit Card', note: 'Trader Joe\'s',                   payment_source: 'account:d7' },
  { date: d(10, -3), type: 'expense', amount:   87.50, category: 'Groceries',     account: 'Credit Card', note: 'Whole Foods',                     payment_source: 'account:d7' },
  { date: d(17, -3), type: 'expense', amount:   91.00, category: 'Groceries',     account: 'Credit Card', note: 'Trader Joe\'s',                   payment_source: 'account:d7' },
  { date: d(24, -3), type: 'expense', amount:   88.00, category: 'Groceries',     account: 'Credit Card', note: 'Whole Foods',                     payment_source: 'account:d7' },

  // Gas (Checking)
  { date: d(4,  -3), type: 'expense', amount:   58.00, category: 'Gas',           account: 'Checking',    note: 'Shell – fill-up',                 payment_source: 'account:d1' },
  { date: d(11, -3), type: 'expense', amount:   61.50, category: 'Gas',           account: 'Checking',    note: 'BP – fill-up',                    payment_source: 'account:d1' },
  { date: d(18, -3), type: 'expense', amount:   54.00, category: 'Gas',           account: 'Checking',    note: 'Shell – fill-up',                 payment_source: 'account:d1' },
  { date: d(25, -3), type: 'expense', amount:   63.00, category: 'Gas',           account: 'Checking',    note: 'Sunoco – fill-up',                payment_source: 'account:d1' },

  // Dining (Sapphire)
  { date: d(7,  -3), type: 'expense', amount:   48.00, category: 'Dining',        account: 'Credit Card', note: 'Chipotle + Panera',               payment_source: 'account:d7' },
  { date: d(20, -3), type: 'expense', amount:   72.00, category: 'Dining',        account: 'Credit Card', note: 'Olive Garden – dinner',           payment_source: 'account:d7' },

  // One-time: car repair — causes Jan 10 net worth dip
  { date: d(17, -3), type: 'expense', amount:  380.00, category: 'Car',           account: 'Checking',    note: 'Meineke – brake pads & rotors',   payment_source: 'account:d1' },

  // Monthly CC batch (dr-cc1)
  { date: d(5,  -3), type: 'expense', amount:  450.00, category: 'Groceries',     account: 'Credit Card', note: 'Monthly CC expenses – Sapphire',  payment_source: 'account:d7' },

  // ══════════════════════════════════════════════════════════
  // FEBRUARY 2026
  // ══════════════════════════════════════════════════════════

  // Income
  { date: d(1,  -2), type: 'income',  amount:  900.00, category: 'Other',         account: 'Checking',    note: 'Roommate – February',             payment_source: 'account:d1' },
  { date: d(6,  -2), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(13, -2), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(20, -2), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(27, -2), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },

  // Fixed expenses
  { date: d(1,  -2), type: 'expense', amount: 1600.00, category: 'Bills',         account: 'Checking',    note: 'Rent',                            payment_source: 'account:d1' },
  { date: d(4,  -2), type: 'expense', amount:   85.00, category: 'Subscriptions', account: 'Credit Card', note: 'Streaming + Gym',                 payment_source: 'account:d8' },
  { date: d(14, -2), type: 'expense', amount:  280.00, category: 'Car',           account: 'Checking',    note: 'Car Insurance – Feb',             payment_source: 'account:d1' },
  { date: d(15, -2), type: 'expense', amount:  200.00, category: 'Bills',         account: 'Checking',    note: 'Electric, Water & Internet',       payment_source: 'account:d1' },

  // Groceries
  { date: d(7,  -2), type: 'expense', amount:   96.00, category: 'Groceries',     account: 'Credit Card', note: 'Whole Foods',                     payment_source: 'account:d7' },
  { date: d(14, -2), type: 'expense', amount:   83.50, category: 'Groceries',     account: 'Credit Card', note: 'Trader Joe\'s',                   payment_source: 'account:d7' },
  { date: d(21, -2), type: 'expense', amount:   92.00, category: 'Groceries',     account: 'Credit Card', note: 'Whole Foods',                     payment_source: 'account:d7' },
  { date: d(28, -2), type: 'expense', amount:   85.00, category: 'Groceries',     account: 'Credit Card', note: 'Aldi + Sprouts',                  payment_source: 'account:d7' },

  // Gas
  { date: d(7,  -2), type: 'expense', amount:   57.00, category: 'Gas',           account: 'Checking',    note: 'BP – fill-up',                    payment_source: 'account:d1' },
  { date: d(14, -2), type: 'expense', amount:   60.00, category: 'Gas',           account: 'Checking',    note: 'Shell – fill-up',                 payment_source: 'account:d1' },
  { date: d(21, -2), type: 'expense', amount:   52.50, category: 'Gas',           account: 'Checking',    note: 'Sunoco – fill-up',                payment_source: 'account:d1' },
  { date: d(28, -2), type: 'expense', amount:   65.00, category: 'Gas',           account: 'Checking',    note: 'Shell – fill-up',                 payment_source: 'account:d1' },

  // Dining
  { date: d(11, -2), type: 'expense', amount:   34.00, category: 'Dining',        account: 'Credit Card', note: 'Chipotle + Starbucks',            payment_source: 'account:d7' },
  { date: d(14, -2), type: 'expense', amount:   88.00, category: 'Dining',        account: 'Credit Card', note: 'Valentine\'s dinner',             payment_source: 'account:d7' },
  { date: d(22, -2), type: 'expense', amount:   42.00, category: 'Dining',        account: 'Credit Card', note: 'Local sushi',                     payment_source: 'account:d7' },

  // One-time: online gadget
  { date: d(28, -2), type: 'expense', amount:   89.00, category: 'Entertainment', account: 'Credit Card', note: 'Amazon – Bluetooth speaker',      payment_source: 'account:d7' },

  // Monthly CC batch
  { date: d(5,  -2), type: 'expense', amount:  450.00, category: 'Groceries',     account: 'Credit Card', note: 'Monthly CC expenses – Sapphire',  payment_source: 'account:d7' },

  // ══════════════════════════════════════════════════════════
  // MARCH 2026
  // ══════════════════════════════════════════════════════════

  // Income
  { date: d(1,  -1), type: 'income',  amount:  900.00, category: 'Other',         account: 'Checking',    note: 'Roommate – March',                payment_source: 'account:d1' },
  { date: d(6,  -1), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(13, -1), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(20, -1), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },
  { date: d(27, -1), type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },

  // Fixed expenses
  { date: d(1,  -1), type: 'expense', amount: 1600.00, category: 'Bills',         account: 'Checking',    note: 'Rent',                            payment_source: 'account:d1' },
  { date: d(4,  -1), type: 'expense', amount:   85.00, category: 'Subscriptions', account: 'Credit Card', note: 'Streaming + Gym',                 payment_source: 'account:d8' },
  { date: d(14, -1), type: 'expense', amount:  280.00, category: 'Car',           account: 'Checking',    note: 'Car Insurance – Mar',             payment_source: 'account:d1' },
  { date: d(15, -1), type: 'expense', amount:  200.00, category: 'Bills',         account: 'Checking',    note: 'Electric, Water & Internet',       payment_source: 'account:d1' },
  { date: d(15, -1), type: 'expense', amount:  139.00, category: 'Subscriptions', account: 'Credit Card', note: 'Amazon Prime – annual renewal',   payment_source: 'account:d7' },

  // Groceries
  { date: d(7,  -1), type: 'expense', amount:   98.00, category: 'Groceries',     account: 'Credit Card', note: 'Whole Foods',                     payment_source: 'account:d7' },
  { date: d(14, -1), type: 'expense', amount:   86.00, category: 'Groceries',     account: 'Credit Card', note: 'Trader Joe\'s',                   payment_source: 'account:d7' },
  { date: d(21, -1), type: 'expense', amount:   93.50, category: 'Groceries',     account: 'Credit Card', note: 'Whole Foods',                     payment_source: 'account:d7' },
  { date: d(28, -1), type: 'expense', amount:   90.00, category: 'Groceries',     account: 'Credit Card', note: 'Costco run',                      payment_source: 'account:d7' },

  // Gas
  { date: d(7,  -1), type: 'expense', amount:   59.00, category: 'Gas',           account: 'Checking',    note: 'Shell – fill-up',                 payment_source: 'account:d1' },
  { date: d(14, -1), type: 'expense', amount:   62.50, category: 'Gas',           account: 'Checking',    note: 'BP – fill-up',                    payment_source: 'account:d1' },
  { date: d(21, -1), type: 'expense', amount:   55.00, category: 'Gas',           account: 'Checking',    note: 'Sunoco – fill-up',                payment_source: 'account:d1' },
  { date: d(28, -1), type: 'expense', amount:   60.00, category: 'Gas',           account: 'Checking',    note: 'Shell – fill-up',                 payment_source: 'account:d1' },

  // Dining
  { date: d(8,  -1), type: 'expense', amount:   39.00, category: 'Dining',        account: 'Credit Card', note: 'Shake Shack + coffee',            payment_source: 'account:d7' },
  { date: d(20, -1), type: 'expense', amount:   65.00, category: 'Dining',        account: 'Credit Card', note: 'Italian place – dinner',          payment_source: 'account:d7' },
  { date: d(29, -1), type: 'expense', amount:   28.00, category: 'Dining',        account: 'Credit Card', note: 'Chipotle',                        payment_source: 'account:d7' },

  // Monthly CC batch
  { date: d(5,  -1), type: 'expense', amount:  450.00, category: 'Groceries',     account: 'Credit Card', note: 'Monthly CC expenses – Sapphire',  payment_source: 'account:d7' },

  // ══════════════════════════════════════════════════════════
  // APRIL 2026 — current month
  // ══════════════════════════════════════════════════════════

  // Income so far
  { date: d(1,  0),  type: 'income',  amount:  900.00, category: 'Other',         account: 'Checking',    note: 'Roommate – April',                payment_source: 'account:d1' },
  { date: d(3,  0),  type: 'income',  amount: 1462.50, category: 'Other',         account: 'Checking',    note: 'Weekly Paycheck',                 payment_source: 'account:d1' },

  // Fixed — already due
  { date: d(1,  0),  type: 'expense', amount: 1600.00, category: 'Bills',         account: 'Checking',    note: 'Rent',                            payment_source: 'account:d1' },
  { date: d(4,  0),  type: 'expense', amount:   85.00, category: 'Subscriptions', account: 'Credit Card', note: 'Streaming + Gym',                 payment_source: 'account:d8' },

  // Monthly CC batch
  { date: d(5,  0),  type: 'expense', amount:  450.00, category: 'Groceries',     account: 'Credit Card', note: 'Monthly CC expenses – Sapphire',  payment_source: 'account:d7' },

  // Upcoming (future) — car down payment
  { date: d(15, 4),  type: 'expense', amount: 5000.00, category: 'Car',           account: 'Checking',    note: 'Car down payment (planned)',      payment_source: 'account:d1' },
];

// ── Demo Debts ─────────────────────────────────────────────
// Larger balances: Sapphire ~3 months to pay off (avalanche), Discover ~2-3 after.
export const demoDebts: (Omit<Debt, 'id' | 'user_id' | 'created_at'> & { credit_limit?: number })[] = [
  { name: 'Chase Sapphire', balance: 8500, apr: 22.99, min_payment: 212, target_payment: 600, credit_limit: 12000 },
  { name: 'Discover It',    balance: 4200, apr: 18.99, min_payment: 105, target_payment: 300, credit_limit:  7500 },
];

// ── Demo Savings Goals ─────────────────────────────────────
// Emergency Fund linked to Marcus HYS (d3) so balance auto-pulls from the account.
export const demoSavingsGoals: (Omit<SavingsGoal, 'id' | 'user_id' | 'created_at'> & { linked_account?: string; goal_type?: string })[] = [
  { name: 'Emergency Fund', target_amount: 15000, current_amount: 5800, monthly_contribution: 300, target_date: d(1, 18), linked_account: 'd3', goal_type: 'Emergency Fund' },
  { name: 'Vacation Fund',  target_amount:  3000, current_amount:  850, monthly_contribution: 150, target_date: d(1, 15), goal_type: 'Custom' },
];

// ── Demo Car Funds ─────────────────────────────────────────
// Linked to Chase Checking (d1) so "available after outflows" shows cash
// remaining after rent, utilities, subscriptions, and debt payments.
export const demoCarFunds: (Omit<CarFund, 'id' | 'user_id' | 'created_at'> & { linked_account?: string })[] = [
  {
    vehicle_name: '2024 Honda Civic',
    target_price: 28000,
    tax_fees: 2000,
    down_payment_goal: 5600,
    current_saved: 3200,
    monthly_insurance: 180,
    expected_apr: 5.9,
    loan_term_months: 60,
    linked_account: 'd1',
  },
];

// ── Demo Assets ────────────────────────────────────────────
// No manual assets — all assets come from live accounts.
// Keeping it simple for the "paying off debt" starter story.
export const demoAssets: Omit<Asset, 'id' | 'user_id' | 'created_at'>[] = [];

// ── Demo Liabilities ───────────────────────────────────────
// Modest student loan that contributes to early negative net worth.
export const demoLiabilities: Omit<Liability, 'id' | 'user_id' | 'created_at'>[] = [
  { name: 'Student Loan', type: 'student_loan', balance: 8000, apr: 5.5, notes: 'Federal direct' },
];
