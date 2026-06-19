import { Transaction, Debt, SavingsGoal, CarFund, Asset, Liability, CarBuild, CarBuildPhase, CarBuildItem } from './types';

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
  { name: 'Emergency Fund', target_amount: 15000, current_amount: 5800, monthly_contribution: 300, target_date: d(1, 18), linked_account: 'd3', goal_type: 'Emergency Fund', lump_sum_payments: [] },
  { name: 'Vacation Fund',  target_amount:  3000, current_amount:  850, monthly_contribution: 150, target_date: d(1, 15), goal_type: 'Custom', lump_sum_payments: [] },
];

// ── Demo Car Funds ─────────────────────────────────────────
export const demoCarFunds: (Omit<CarFund, 'id' | 'user_id' | 'created_at'>)[] = [
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
    linked_rule_id: null,
    loan_payment_account: null,
    planned_purchase_date: d(1, 8),
    phase: 'saving',
    loan_amount: 0,
    loan_start_date: null,
    payment_start_date: null,
    interest_start_date: null,
    actual_monthly_payment: 0,
    gift_contribution: 0,
    lump_sum_payments: [],
  },
  {
    vehicle_name: 'Toyota RAV4 (Owned)',
    target_price: 34000,
    tax_fees: 2500,
    down_payment_goal: 6800,
    current_saved: 6800,
    monthly_insurance: 210,
    expected_apr: 6.4,
    loan_term_months: 60,
    linked_account: null,
    linked_rule_id: null,
    loan_payment_account: null,
    planned_purchase_date: null,
    phase: 'loan',
    loan_amount: 27500,
    loan_start_date: d(1, -2),
    payment_start_date: d(1, -1),
    interest_start_date: d(1, -1),
    actual_monthly_payment: 0,
    gift_contribution: 0,
    lump_sum_payments: [],
  },
];

// ── Demo Assets ────────────────────────────────────────────
// No manual assets — all assets come from live accounts.
// Keeping it simple for the "paying off debt" starter story.
export const demoAssets: Omit<Asset, 'id' | 'user_id' | 'created_at'>[] = [];

// ── Demo Liabilities ───────────────────────────────────────
// Student loan + auto loan on the RAV4 contribute to the negative early net worth.
export const demoLiabilities: Omit<Liability, 'id' | 'user_id' | 'created_at'>[] = [
  { name: 'Student Loan',      type: 'student_loan', balance:  8000, apr: 5.5, notes: 'Federal direct' },
  { name: 'Auto Loan — RAV4', type: 'auto_loan',     balance: 26500, apr: 6.4, notes: '2022 Toyota RAV4 — 60-month term, started Feb 2026' },
];

// ── Demo Car Builds ────────────────────────────────────────
const DEMO_BUILD_ID = 'demo-build-1';
const DEMO_PHASE_INT = 'demo-phase-int';
const DEMO_PHASE_SUS = 'demo-phase-sus';
const DEMO_PHASE_EXH = 'demo-phase-exh';
const DEMO_PHASE_WRAP = 'demo-phase-wrap';
const DEMO_PHASE_BLWR = 'demo-phase-blwr';

export const demoCarBuilds: CarBuild[] = [
  {
    id: DEMO_BUILD_ID,
    user_id: 'demo',
    name: 'C5 Corvette Build',
    year: 2003,
    make: 'Chevrolet',
    model: 'Corvette',
    notes: 'Daily → weekend warrior. Midnight purple wrap, supercharger end-game.',
    sort_order: 0,
    share_token: null,
    photos: null,
    created_at: '',
  },
];

export const demoCarBuildPhases: CarBuildPhase[] = [
  { id: DEMO_PHASE_INT,  build_id: DEMO_BUILD_ID, user_id: 'demo', title: 'Interior & Electronics', sort_order: 0, hidden: false, created_at: '' },
  { id: DEMO_PHASE_SUS,  build_id: DEMO_BUILD_ID, user_id: 'demo', title: 'Suspension',              sort_order: 1, hidden: false, created_at: '' },
  { id: DEMO_PHASE_EXH,  build_id: DEMO_BUILD_ID, user_id: 'demo', title: 'Exhaust & Cooling',       sort_order: 2, hidden: false, created_at: '' },
  { id: DEMO_PHASE_WRAP, build_id: DEMO_BUILD_ID, user_id: 'demo', title: 'Wrap',                    sort_order: 3, hidden: false, created_at: '' },
  { id: DEMO_PHASE_BLWR, build_id: DEMO_BUILD_ID, user_id: 'demo', title: 'Supercharger',            sort_order: 4, hidden: false, created_at: '' },
];

export const demoCarBuildItems: CarBuildItem[] = [
  // Interior & Electronics — mostly done
  { id: 'demo-item-01', phase_id: DEMO_PHASE_INT, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Steering Wheel',          brand: 'Lowered Empire — Black Reaper Carbon Fiber', price:  220, link: null, completed: true,  sort_order: 0, created_at: '' },
  { id: 'demo-item-02', phase_id: DEMO_PHASE_INT, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Wheel Hub',               brand: 'NRG SRK-170H',                               price:  103, link: null, completed: true,  sort_order: 1, created_at: '' },
  { id: 'demo-item-03', phase_id: DEMO_PHASE_INT, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Wheel Quick Release',      brand: 'NRG SRK-200BK',                              price:  103, link: null, completed: true,  sort_order: 2, created_at: '' },
  { id: 'demo-item-04', phase_id: DEMO_PHASE_INT, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Digital Media Receiver',   brand: 'Pioneer DMH-W3050NEX',                       price:  430, link: null, completed: true,  sort_order: 3, created_at: '' },
  { id: 'demo-item-05', phase_id: DEMO_PHASE_INT, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Floor Mats',              brand: 'Lloyd Mats All-Weather Rubber',               price:  260, link: null, completed: true,  sort_order: 4, created_at: '' },
  // Suspension — in progress
  { id: 'demo-item-06', phase_id: DEMO_PHASE_SUS, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Coilovers',               brand: 'BC Racing BR Series',                         price: 1200, link: null, completed: true,  sort_order: 0, created_at: '' },
  { id: 'demo-item-07', phase_id: DEMO_PHASE_SUS, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Adjustable Control Arms',  brand: null,                                          price: null, link: null, completed: false, sort_order: 1, created_at: '' },
  { id: 'demo-item-08', phase_id: DEMO_PHASE_SUS, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Sway Bars + Poly Bushings', brand: null,                                         price: null, link: null, completed: false, sort_order: 2, created_at: '' },
  // Exhaust & Cooling — pending
  { id: 'demo-item-09', phase_id: DEMO_PHASE_EXH, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Axle-Back Exhaust',        brand: 'Corsa Sport Tigershark Black PVD',            price: 2214, link: null, completed: false, sort_order: 0, created_at: '' },
  { id: 'demo-item-10', phase_id: DEMO_PHASE_EXH, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Radiator w/ Trans Cooler', brand: 'DeWitts',                                    price:  891, link: null, completed: false, sort_order: 1, created_at: '' },
  // Wrap — planned
  { id: 'demo-item-11', phase_id: DEMO_PHASE_WRAP, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'Midnight Purple Full Wrap', brand: 'Professional Install',                      price: 2500, link: null, completed: false, sort_order: 0, created_at: '' },
  // Supercharger — end-game
  { id: 'demo-item-12', phase_id: DEMO_PHASE_BLWR, build_id: DEMO_BUILD_ID, user_id: 'demo', name: 'TVS2300 Supercharger Kit', brand: 'Magnuson',                                   price: 4300, link: null, completed: false, sort_order: 0, created_at: '' },
];
