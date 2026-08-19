import { Transaction, Debt, SavingsGoal, CarFund, Asset, Liability, CarBuild, CarBuildPhase, CarBuildItem, CarMaintenanceLog } from './types';

const now = new Date();
const y = now.getFullYear();
const m = now.getMonth();

function d(day: number, monthOffset = 0) {
  return new Date(y, m + monthOffset, day).toISOString().split('T')[0];
}

// ── Net Worth Snapshots — 26 weekly points ending today ───────────────────
//
// ⚠️ THESE USED TO BE FOURTEEN HAND-WRITTEN DATES IN Jan–Apr 2026. By August the chart on the demo
// dashboard ran Jan 2 → Mar 27 and ended at +$3,900 while the tile directly above it read
// −$22,600. A history that stops five months short of the number printed over it is worse than no
// history: the two readings cannot both be right and nothing on screen says which one is stale.
// Every point is therefore DERIVED, relative to today, and the series ends exactly on the totals
// the rest of this file declares.
//
// The step nine weeks ago is the RAV4 purchase — a $27,500 loan appearing against a $29,000
// vehicle asset, which is what financing a car does to a net worth chart. It is here because a
// straight line demonstrates nothing, and because the Garage's Active Loans panel and
// `demoLiabilities` are telling the same event from their own ends. Change one, change all three.
const DEMO_SNAPSHOT_WEEKS = 26;
/** Matches `demoCarFunds`' RAV4 loan_start_date, which is two months back. */
const DEMO_AUTO_LOAN_WEEKS_AGO = 9;
const DEMO_VEHICLE_ASSET_VALUE = 29_000;
const DEMO_AUTO_LOAN_AT_ORIGINATION = 27_500;
const DEMO_AUTO_LOAN_TODAY = 26_500;
/** Account balances today, i.e. `demoAccounts` less the two cards. */
const DEMO_ACCOUNT_ASSETS_TODAY = 24_600;
/** Cards + student loan today: 8,500 + 4,200 + 8,000. */
const DEMO_NON_AUTO_LIABILITIES_TODAY = 20_700;
/** Where those two lines stood 26 weeks ago — less saved, more owed on the cards. */
const DEMO_ACCOUNT_ASSETS_START = 19_800;
const DEMO_NON_AUTO_LIABILITIES_START = 24_900;

function demoSnapshotDate(weeksAgo: number) {
  return new Date(y, m, now.getDate() - weeksAgo * 7).toISOString().split('T')[0];
}

function demoNetWorthSeries() {
  const last = DEMO_SNAPSHOT_WEEKS - 1;

  return Array.from({ length: DEMO_SNAPSHOT_WEEKS }, (_, i) => {
    const t = i / last;
    const ownsCar = i >= last - DEMO_AUTO_LOAN_WEEKS_AGO;

    const total_assets =
      Math.round(DEMO_ACCOUNT_ASSETS_START + t * (DEMO_ACCOUNT_ASSETS_TODAY - DEMO_ACCOUNT_ASSETS_START))
      + (ownsCar ? DEMO_VEHICLE_ASSET_VALUE : 0);

    const paidWeeks = i - (last - DEMO_AUTO_LOAN_WEEKS_AGO);
    const total_liabilities =
      Math.round(DEMO_NON_AUTO_LIABILITIES_START + t * (DEMO_NON_AUTO_LIABILITIES_TODAY - DEMO_NON_AUTO_LIABILITIES_START))
      + (ownsCar
        ? Math.round(DEMO_AUTO_LOAN_AT_ORIGINATION
            + (paidWeeks / DEMO_AUTO_LOAN_WEEKS_AGO) * (DEMO_AUTO_LOAN_TODAY - DEMO_AUTO_LOAN_AT_ORIGINATION))
        : 0);

    return {
      snapshot_date: demoSnapshotDate(last - i),
      total_assets,
      total_liabilities,
      net_worth: total_assets - total_liabilities,
    };
  });
}

export const demoNetWorthSnapshots = demoNetWorthSeries();

// ── Demo Transactions — five recorded months, then today's month from the rules ──
//
// ⚠️ THIS WAS 130 HAND-WRITTEN ROWS ACROSS FOUR MONTHS, and it had three faults that were only
// visible with the app open:
//   1. The notes carried literal month names ("Roommate – April") while the dates were relative, so
//      by August the demo ledger read "Roommate – April" against 2026-08-01.
//   2. Four months of rows is two months short of the Dashboard's six-month cash flow chart, which
//      therefore opened on two empty bars.
//   3. Every recurring row restated a row `demoRecurringRules` already generates, so
//      `scanForDuplicateTransactions` was right to raise "Possible duplicate payment — 4 months"
//      across the top of the demo ledger. The warning was working; the fixture was wrong.
//
// ⚠️ THE RECORDED MONTHS CARRY `origin: 'synced'`, AND THAT IS THE FIX FOR (3) — not a trick to
// quiet the detector. It is what these rows are: history that reached the ledger from the bank
// feed, which is how a real account fills in, and `isManualCandidate` exempts exactly that. Only a
// row a person typed can duplicate a rule, so the one-offs below stay 'manual' and would still be
// caught if one of them ever matched a rule.
//
// ⚠️ THE CURRENT MONTH IS DELIBERATELY ABSENT. `mergeWithGeneratedTransactions` expands the
// recurring rules over it, so writing it out here would duplicate every one of them. Past months
// are recorded, this month is projected — which is also the behaviour being demonstrated.

/** The recorded months, oldest first. The Dashboard's cash flow chart draws five past months. */
const DEMO_LEDGER_MONTHS = [-5, -4, -3, -2, -1] as const;

/** Paycheck and fill-up days. The SAME days as `demoSyncedTransactions` — one story, two surfaces. */
const DEMO_LEDGER_WEEKLY_DAYS = [3, 10, 17, 24] as const;

/** Per-month grocery and fuel spend, so no two bars on the chart are identical. Index = month age. */
const DEMO_GROCERY_RUNS = [
  [94.00, 87.50, 91.00, 88.00],
  [96.00, 83.50, 92.00, 85.00],
  [98.00, 86.00, 93.50, 90.00],
  [89.50, 95.00, 84.00, 97.00],
  [92.50, 88.50, 96.50, 86.50],
] as const;

const DEMO_FUEL_RUNS = [
  [58.00, 61.50, 54.00, 63.00],
  [57.00, 60.00, 52.50, 65.00],
  [59.00, 62.50, 55.00, 60.00],
  [56.50, 58.50, 63.50, 57.50],
  [61.00, 54.50, 59.50, 62.00],
] as const;

/** Two dinners a month, varied the same way. `[day, amount, note]`. */
const DEMO_DINING_RUNS: readonly (readonly [number, number, string])[][] = [
  [[7, 48.00, 'Chipotle + Panera'], [20, 72.00, 'Olive Garden — dinner']],
  [[11, 34.00, 'Chipotle + Starbucks'], [22, 42.00, 'Local sushi']],
  [[8, 39.00, 'Shake Shack + coffee'], [20, 65.00, 'Italian place — dinner']],
  [[9, 31.50, 'Taco night'], [23, 58.00, 'Steakhouse — birthday']],
  [[6, 44.00, 'Ramen + drinks'], [21, 36.50, 'Chipotle + coffee']],
];

type DemoTransaction = Omit<Transaction, 'id' | 'user_id' | 'created_at'>;

/** A row that reached the ledger from the bank feed. Never a duplicate-warning candidate. */
function syncedTxn(
  monthOffset: number, day: number, type: 'income' | 'expense',
  amount: number, category: string, account: string, note: string, source: string,
): DemoTransaction {
  return { date: d(day, monthOffset), type, amount, category, account, note, payment_source: source, origin: 'synced' };
}

function demoLedger(): DemoTransaction[] {
  const rows: DemoTransaction[] = [];

  DEMO_LEDGER_MONTHS.forEach((M, ageIndex) => {
    // Income — the roommate's half of the rent, then four weekly deposits.
    rows.push(syncedTxn(M, 1, 'income', 900.00, 'Other', 'Checking', 'Roommate — rent split', 'account:d1'));
    for (const day of DEMO_LEDGER_WEEKLY_DAYS) {
      rows.push(syncedTxn(M, day, 'income', 1462.50, 'Other', 'Checking', 'Weekly Paycheck', 'account:d1'));
    }

    // Fixed expenses.
    rows.push(syncedTxn(M, 1, 'expense', 1600.00, 'Bills', 'Checking', 'Rent', 'account:d1'));
    rows.push(syncedTxn(M, 4, 'expense', 85.00, 'Subscriptions', 'Credit Card', 'Streaming + Gym', 'account:d8'));
    rows.push(syncedTxn(M, 14, 'expense', 280.00, 'Car', 'Checking', 'Car Insurance', 'account:d1'));
    rows.push(syncedTxn(M, 15, 'expense', 200.00, 'Bills', 'Checking', 'Electric, Water & Internet', 'account:d1'));
    rows.push(syncedTxn(M, 5, 'expense', 450.00, 'Groceries', 'Credit Card', 'Monthly card spend — Sapphire', 'account:d7'));

    // Weekly variable spend.
    DEMO_LEDGER_WEEKLY_DAYS.forEach((day, week) => {
      rows.push(syncedTxn(M, day + 3, 'expense', DEMO_GROCERY_RUNS[ageIndex][week], 'Groceries', 'Credit Card', 'Groceries', 'account:d7'));
      rows.push(syncedTxn(M, day, 'expense', DEMO_FUEL_RUNS[ageIndex][week], 'Gas', 'Checking', 'Fill-up', 'account:d1'));
    });

    for (const [day, amount, note] of DEMO_DINING_RUNS[ageIndex]) {
      rows.push(syncedTxn(M, day, 'expense', amount, 'Dining', 'Credit Card', note, 'account:d7'));
    }
  });

  return rows;
}

export const demoTransactions: DemoTransaction[] = [
  ...demoLedger(),

  // ── One-offs: typed by hand, which is why they stay 'manual' ─────────────
  // Nothing recurring generates these, so they are what a duplicate warning SHOULD stay quiet about.
  { date: d(17, -5), type: 'expense', amount: 380.00, category: 'Car',           account: 'Checking',    note: 'Meineke — brake pads & rotors', payment_source: 'account:d1' },
  { date: d(28, -4), type: 'expense', amount:  89.00, category: 'Entertainment', account: 'Credit Card', note: 'Amazon — Bluetooth speaker',    payment_source: 'account:d7' },
  { date: d(21, -2), type: 'expense', amount: 642.00, category: 'Car',           account: 'Credit Card', note: 'Tire Rack — wheels & tires',    payment_source: 'account:d7' },
  { date: d( 9, -1), type: 'expense', amount: 218.44, category: 'Car',           account: 'Credit Card', note: 'Summit Racing — exhaust parts', payment_source: 'account:d7' },

  // Planned, not yet spent — the Forecast draws the outflow in the month it lands.
  { date: d(15, 4), type: 'expense', amount: 5000.00, category: 'Car', account: 'Checking', note: 'Car down payment (planned)', payment_source: 'account:d1' },
];

// ── Demo Debts ─────────────────────────────────────────────
// ⚠️ THE LAST THREE ENTRIES EXIST TO FILL THE DEBT PAGE'S OTHER PANELS. `/debt` has five, and with
// only the two cards here three of them rendered an empty state on the sales surface — Other Debts
// showing "$0 / $0 / $0", three confident zeros for a person who owes money on two of them.
// `DebtPayoff.tsx` sorts a debt into a panel by matching its NAME against an account of that type,
// so a student loan needs BOTH the row here and the `student_loan` account in `demoAccounts`; the
// dental plan matches no account type and therefore lands in Other Debts, which is the rule the
// page uses, not a special case.
// Mortgage is left empty ON PURPOSE. Jordan rents — $1,600 a month, rule r2 — and inventing a
// mortgage to light up a tab would be the one demo number a visitor could catch out.
export const demoDebts: (Omit<Debt, 'id' | 'user_id' | 'created_at'> & { credit_limit?: number })[] = [
  { name: 'Chase Sapphire', balance: 8500, apr: 22.99, min_payment: 212, target_payment: 600, credit_limit: 12000 },
  { name: 'Discover It',    balance: 4200, apr: 18.99, min_payment: 105, target_payment: 300, credit_limit:  7500 },
  { name: 'Student Loan',   balance: 8000, apr:  5.50, min_payment:  95, target_payment:  95 },
  { name: 'Dental Financing', balance: 640, apr: 0,    min_payment:  80, target_payment:  80 },
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
    // Finding §2.9 (Tre, 2026-08-08): this was $3,200 earmarked against `linked_account: 'd1'` —
    // Chase Checking, which holds $2,800 — so the demo rendered "Balance on hand $0" with no
    // explanation. $1,200 of the $2,800 checking balance being car money is coherent AND still
    // exercises the earmark path, so the demo shows the feature working rather than a clamped zero.
    // If d1's balance ever changes, keep this below it.
    current_saved: 1200,
    // §2.10: deliberately left on 'fixed'. The only percent that reproduces §2.9's live-verified
    // $1,200 against d1's $2,800 is 42.857…%, which would put float noise into a money figure on
    // the demo dashboard. Percent mode is exercised by its unit tests instead.
    saved_source: 'fixed',
    saved_percent: 0,
    monthly_insurance: 180,
    expected_apr: 5.9,
    loan_term_months: 60,
    linked_account: 'd1',
    linked_rule_id: null,
    loan_payment_account: null,
    linked_loan_account_id: null,
    planned_purchase_date: d(1, 8),
    phase: 'saving',
    loan_amount: 0,
    loan_start_date: null,
    payment_start_date: null,
    interest_start_date: null,
    actual_monthly_payment: 0,
    gift_contribution: 0,
    lump_sum_payments: [],
    insurance_start_date: null,
  },
  {
    vehicle_name: 'Toyota RAV4 (Owned)',
    target_price: 34000,
    tax_fees: 2500,
    down_payment_goal: 6800,
    current_saved: 6800,
    saved_source: 'fixed',
    saved_percent: 0,
    monthly_insurance: 210,
    expected_apr: 6.4,
    loan_term_months: 60,
    linked_account: null,
    linked_rule_id: null,
    loan_payment_account: null,
    linked_loan_account_id: null,
    planned_purchase_date: null,
    phase: 'loan',
    loan_amount: 27500,
    loan_start_date: d(1, -2),
    payment_start_date: d(1, -1),
    interest_start_date: d(1, -1),
    actual_monthly_payment: 0,
    gift_contribution: 0,
    lump_sum_payments: [],
    insurance_start_date: null,
  },
];

// ── Demo Assets ────────────────────────────────────────────
// ⚠️ THIS WAS AN EMPTY ARRAY, on the reasoning that live accounts carry every asset. The RAV4
// broke that: `demoLiabilities` books a $26,500 loan against a car that appeared nowhere on the
// other side of the ledger, so the net worth tile read −$22,600 for someone who owns the car.
// A financed asset has to be booked as an asset or the number is simply wrong — and it is also
// what makes the Accounts page's "Assets" filter show something a live account cannot.
export const demoAssets: Omit<Asset, 'id' | 'user_id' | 'created_at'>[] = [
  { name: '2022 Toyota RAV4', type: 'Vehicle', value: 29000, notes: 'Financed — see the loan under Liabilities' },
];

// ── Demo Liabilities ───────────────────────────────────────
// ⚠️ THE STUDENT LOAN MOVED TO `demoAccounts` as a `student_loan` account and must NOT be repeated
// here: `buildNetWorthBreakdown` drops a manual liability whose name matches a live liability
// account, so a copy would be silently ignored on the net worth tile while still confusing anyone
// reading this file. The auto loan stays manual on purpose — `net-worth.ts` documents the demo
// RAV4 as the case its vehicle-loan dedup is written against.
export const demoLiabilities: Omit<Liability, 'id' | 'user_id' | 'created_at'>[] = [
  { name: 'Auto Loan — RAV4', type: 'auto_loan', balance: 26500, apr: 6.4, notes: '2022 Toyota RAV4 — 60-month term' },
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
    maintenance_public: false,
    pricing_public: true,
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

// ── Maintenance log ───────────────────────────────────────────────────────
// Dates are relative to today so the demo always shows one of each due state:
// an overdue oil change, an air filter coming up, and a rotation still a while off.
function dPlusDays(days: number) {
  const dt = new Date(y, m, now.getDate() + days);
  return dt.toISOString().split('T')[0];
}

export const demoCarMaintenanceLogs: CarMaintenanceLog[] = [
  {
    id: 'demo-maint-1', build_id: DEMO_BUILD_ID, user_id: 'demo',
    service: 'Oil Change', service_date: d(10, -7), odometer: 87400, cost: 89.99,
    vendor: 'Valvoline', notes: '5W-30 full synthetic, Mobil 1 filter',
    interval_months: 6, interval_miles: 5000,
    next_due_date: d(10, -1), next_due_odometer: 92400, created_at: '',
  },
  {
    id: 'demo-maint-2', build_id: DEMO_BUILD_ID, user_id: 'demo',
    service: 'Engine Air Filter', service_date: d(5, -11), odometer: 84000, cost: 32,
    vendor: 'DIY', notes: null,
    interval_months: 12, interval_miles: 15000,
    next_due_date: dPlusDays(14), next_due_odometer: 99000, created_at: '',
  },
  {
    id: 'demo-maint-3', build_id: DEMO_BUILD_ID, user_id: 'demo',
    service: 'Tire Rotation', service_date: d(2, -3), odometer: 90100, cost: 45,
    vendor: 'Discount Tire', notes: null,
    interval_months: 6, interval_miles: 6000,
    next_due_date: d(2, 3), next_due_odometer: 96100, created_at: '',
  },
  {
    id: 'demo-maint-4', build_id: DEMO_BUILD_ID, user_id: 'demo',
    service: 'Brake Fluid', service_date: d(18, -1), odometer: 91900, cost: 140,
    vendor: 'Independent shop', notes: 'Flushed after coilover install',
    interval_months: 24, interval_miles: null,
    next_due_date: d(18, 23), next_due_odometer: null, created_at: '',
  },
];

// ── Demo Bank Activity — the synced feed behind the Decision Deck ──────────
//
// ⚠️ WHY THIS EXISTS AT ALL. `useAllSyncedTransactions` used to return `[]` in demo, on the reasoning
// that inventing bank rows would put fabricated "your bank says" claims in front of someone. That
// reasoning holds for a REAL user's account and does not hold here: demo is a self-declared fixture
// behind a permanent banner, its accounts, debts and ledger are already fabricated, and returning
// nothing did not avoid a false claim — it rendered the Decision Deck and the patterns card
// structurally empty, which told a prospective user the features do not work. Per `design/
// DIRECTION.md`, demo is the sales surface, so the honest fix is a feed that is obviously a demo,
// not an absence.
//
// ⚠️ EVERY ROW HERE IS DERIVED FROM THE SAME NARRATIVE AS `demoRecurringRules` AND
// `demoTransactions`. Three things have to be true at once for the demo to hold together:
//   1. Some charges MATCH a demo rule (account + day + amount) — those are what fill the deck, since
//      the queue holds SUGGESTIONS, never merely unreviewed rows.
//   2. Some recurring merchants match NO rule — those are what the rules-from-history patterns card
//      proposes, and they need `MIN_PROPOSAL_MONTHS` consecutive months inside the amount band.
//   3. Some are one-offs, which produce no suggestion by design and exist so "All activity" and
//      merchant memory are not a list of nothing but bills.
// Changing an amount or a day here can silently empty a surface. `demo-bank-activity.test.ts` pins
// all three properties against the app's own queue and proposal code rather than against a count
// written down by hand.
//
// SIGN CONVENTION: outflow positive, inflow negative — the provider convention the whole §1B stack
// reads (`rule-proposal.ts`), NOT the ledger's `type: 'income' | 'expense'`.
//
// Dates ride the same `d(day, monthOffset)` helper as the rest of this file, so the feed is always
// the last four months relative to today and never ages into a stale-looking demo.

/** Structurally `BankActivityRow`. Declared here so this fixture does not import the hooks module. */
export interface DemoSyncedTransaction {
  id: string;
  account_id: string;
  amount: number;
  date: string;
  pending: boolean;
  name: string;
  merchant_name: string | null;
  category: string | null;
}

/** The four months the feed covers, oldest first. */
const DEMO_FEED_MONTHS = [-3, -2, -1, 0] as const;

/** The weekly cadences repeat on these days of the month — near enough to weekly to read as a feed. */
const DEMO_WEEKLY_DAYS = [3, 10, 17, 24] as const;

function demoCharge(
  key: string, monthOffset: number, day: number,
  account_id: string, amount: number, name: string, merchant_name: string, category: string,
): DemoSyncedTransaction {
  return {
    id: `demo-sync-${key}-${monthOffset}-${day}`,
    account_id,
    amount,
    date: d(day, monthOffset),
    pending: false,
    name,
    merchant_name,
    category,
  };
}

function demoFeed(): DemoSyncedTransaction[] {
  const rows: DemoSyncedTransaction[] = [];

  for (const M of DEMO_FEED_MONTHS) {
    // ── Matches a demo rule: these are the deck's cards ──────────────────────
    // r2 Rent — $1,600 on the 1st from Chase Checking.
    rows.push(demoCharge('rent', M, 1, 'd1', 1600.00, 'RIDGEVIEW APARTMENTS RENT', 'Ridgeview Apartments', 'Bills'));
    // r4 Car Insurance — $280 on the 14th from Chase Checking.
    rows.push(demoCharge('insurance', M, 14, 'd1', 280.00, 'PROGRESSIVE INS PMT', 'Progressive Insurance', 'Car'));
    // r3 Utilities — $200 on the 15th from Chase Checking.
    rows.push(demoCharge('utilities', M, 15, 'd1', 200.00, 'DUKE ENERGY BILLPAY', 'Duke Energy', 'Bills'));
    // r13 Streaming + Gym — $85 on the 4th on Discover.
    rows.push(demoCharge('gym', M, 4, 'd8', 85.00, 'IRON HOUSE GYM MEMBER', 'Iron House Gym', 'Subscriptions'));

    // r1 Weekly Paycheck — inflow, so NEGATIVE. Deposited to Chase Checking.
    // r11 Gas and r10 Groceries — the two weekly expense rules.
    for (const day of DEMO_WEEKLY_DAYS) {
      rows.push(demoCharge('payroll', M, day, 'd1', -1462.50, 'RIDGELINE FAB PAYROLL DIR DEP', 'Ridgeline Fabrication', 'Income'));
      rows.push(demoCharge('gas', M, day, 'd1', 55.00, 'CHEVRON 0421', 'Chevron', 'Gas'));
      rows.push(demoCharge('groceries', M, day + 3, 'd7', 80.00, 'PUBLIX #1184', 'Publix', 'Groceries'));
    }

    // ── Matches NO rule: what the patterns card proposes ─────────────────────
    // A monthly cadence the demo profile never wrote a rule for. Days and amounts are deliberately
    // far from every rule above so the matcher cannot claim them and leave the card empty.
    rows.push(demoCharge('detailing', M, 12, 'd7', 39.99, 'APEX AUTO DETAILING CLUB', 'Apex Auto Detailing', 'Car'));
    rows.push(demoCharge('phone', M, 18, 'd1', 92.15, 'VERIZON WIRELESS PMT', 'Verizon Wireless', 'Bills'));
    rows.push(demoCharge('storage', M, 7, 'd1', 145.00, 'IRON PEAK STORAGE UNIT', 'Iron Peak Storage', 'Bills'));
  }

  // ── One-offs: no cadence, no rule, no suggestion — the build-thread spending ─
  rows.push(demoCharge('summit', -1, 9, 'd7', 218.44, 'SUMMIT RACING EQUIP', 'Summit Racing', 'Car'));
  rows.push(demoCharge('tirerack', -2, 21, 'd7', 642.00, 'TIRE RACK INC', 'Tire Rack', 'Car'));
  rows.push(demoCharge('oreilly', 0, 16, 'd7', 87.31, 'OREILLY AUTO 2214', "O'Reilly Auto Parts", 'Car'));
  rows.push(demoCharge('coffee', 0, 6, 'd7', 12.00, 'CARS AND COFFEE DTWN', 'Cars & Coffee', 'Entertainment'));
  rows.push(demoCharge('dyno', -2, 27, 'd7', 175.00, 'APEX DYNO SESSION', 'Apex Dyno', 'Car'));

  // ⚠️ NOTHING IN THE CURRENT MONTH MAY BE DATED AFTER TODAY. Every row here is `pending: false`,
  // i.e. a SETTLED charge the bank has already reported, and the cadences above run to the 27th —
  // so on any day before the 27th the feed was handing the Decision Deck settled charges dated in
  // the future. A bank cannot have reported tomorrow's coffee.
  const today = d(now.getDate());
  const settled = rows.filter(r => r.date <= today);

  // Newest first, the order `useAllSyncedTransactions` returns from the database.
  return settled.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
}

export const demoSyncedTransactions: DemoSyncedTransaction[] = demoFeed();


// ── Demo accounts and recurring rules ─────────────────────────────────────
// MOVED HERE from `useSupabaseData.ts` unchanged, so every demo fixture lives in one file and
// the pure §1B tests can read them without importing the hooks module (and with it React and a
// Supabase client). Exported for that reason only — the hooks file is still the only consumer
// in the app.

// ─── Accounts (Centralized) ──────────────────────────────
// FIX #13: Demo accounts now have realistic balances that produce
// meaningful forecast projections. Checking balance supports the
// cash floor while showing debt payoff in action.
export const demoAccounts = [
  { id: 'd1', user_id: 'demo', name: 'Chase Checking', account_type: 'checking', institution: 'Chase', balance: 2800, credit_limit: null, apr: null, active: true, notes: 'Primary checking', created_at: '', updated_at: '' },
  { id: 'd2', user_id: 'demo', name: 'Alliant Checking', account_type: 'checking', institution: 'Alliant', balance: 1000, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'd3', user_id: 'demo', name: 'Marcus HYS', account_type: 'high_yield_savings', institution: 'Marcus', balance: 5800, credit_limit: null, apr: 4.5, active: true, notes: 'Emergency fund', created_at: '', updated_at: '' },
  { id: 'd4', user_id: 'demo', name: 'Fidelity 401k', account_type: '401k', institution: 'Fidelity', balance: 8500, credit_limit: null, apr: null, active: true, notes: 'Employer match 4%', created_at: '', updated_at: '' },
  { id: 'd5', user_id: 'demo', name: 'Roth IRA', account_type: 'roth_ira', institution: 'Fidelity', balance: 4200, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'd6', user_id: 'demo', name: 'Robinhood', account_type: 'brokerage', institution: 'Robinhood', balance: 2000, credit_limit: null, apr: null, active: true, notes: 'Index funds', created_at: '', updated_at: '' },
  { id: 'd7', user_id: 'demo', name: 'Chase Sapphire', account_type: 'credit_card', institution: 'Chase', balance: 8500, credit_limit: 12000, apr: 22.99, active: true, notes: '', created_at: '', updated_at: '', payment_due_day: 15, payment_preference: 'statement' },
  { id: 'd8', user_id: 'demo', name: 'Discover It', account_type: 'credit_card', institution: 'Discover', balance: 4200, credit_limit: 7500, apr: 18.99, active: true, notes: '', created_at: '', updated_at: '', payment_due_day: 22, payment_preference: 'full' },
  // Named to match the `Student Loan` row in `demoDebts` — `DebtPayoff.tsx` pairs the two by name,
  // and `net-worth.ts` counts a `student_loan` account as a liability, which is why the manual
  // liability row for it was removed rather than kept alongside.
  { id: 'd10', user_id: 'demo', name: 'Student Loan', account_type: 'student_loan', institution: 'Nelnet', balance: 8000, credit_limit: null, apr: 5.5, active: true, notes: 'Federal direct', created_at: '', updated_at: '' },
  { id: 'd9', user_id: 'demo', name: 'Cash', account_type: 'cash', institution: '', balance: 300, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '' },
];

// ─── Recurring Rules ─────────────────────────────────────
// FIX #14: Demo recurring rules now cover a full realistic budget with
// all rule types (income, expense, transfer, investment) so the forecast
// shows meaningful projections. Amounts are consistent with the demo
// profile's weekly_gross_income of $1875 @ 22% tax.
export const demoRecurringRules = [
  // Income — $1875/week gross @ 22% tax = $1462.50 net per paycheck
  { id: 'r1', user_id: 'demo', name: 'Weekly Paycheck', amount: 1462.50, rule_type: 'income', frequency: 'weekly', due_day: 5, due_month: null, start_date: '2026-01-03', end_date: null, category: 'Other', payment_source: null, deposit_account: 'd1', active: true, notes: 'Friday deposits', created_at: '', updated_at: '' },
  // Fixed expenses
  { id: 'r2', user_id: 'demo', name: 'Rent', amount: 1600, rule_type: 'expense', frequency: 'monthly', due_day: 1, due_month: null, start_date: '2026-01-01', end_date: null, category: 'Bills', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r3', user_id: 'demo', name: 'Utilities', amount: 200, rule_type: 'expense', frequency: 'monthly', due_day: 15, due_month: null, start_date: '2026-01-15', end_date: null, category: 'Bills', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r4', user_id: 'demo', name: 'Car Insurance', amount: 280, rule_type: 'expense', frequency: 'monthly', due_day: 14, due_month: null, start_date: '2026-01-14', end_date: null, category: 'Car', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  // Variable expenses
  { id: 'r10', user_id: 'demo', name: 'Groceries', amount: 80, rule_type: 'expense', frequency: 'weekly', due_day: 6, due_month: null, start_date: '2026-01-06', end_date: null, category: 'Groceries', payment_source: 'd7', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r11', user_id: 'demo', name: 'Gas', amount: 55, rule_type: 'expense', frequency: 'weekly', due_day: 3, due_month: null, start_date: '2026-01-03', end_date: null, category: 'Gas', payment_source: 'd1', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r12', user_id: 'demo', name: 'Dining Out', amount: 120, rule_type: 'expense', frequency: 'monthly', due_day: 20, due_month: null, start_date: '2026-01-20', end_date: null, category: 'Dining', payment_source: 'd7', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  // Subscriptions
  { id: 'r5', user_id: 'demo', name: 'Amazon Prime', amount: 139, rule_type: 'expense', frequency: 'yearly', due_day: 15, due_month: 3, start_date: '2026-03-15', end_date: null, category: 'Subscriptions', payment_source: 'd7', deposit_account: null, active: true, notes: 'Annual renewal', created_at: '', updated_at: '' },
  { id: 'r13', user_id: 'demo', name: 'Streaming + Gym', amount: 85, rule_type: 'expense', frequency: 'monthly', due_day: 4, due_month: null, start_date: '2026-01-04', end_date: null, category: 'Subscriptions', payment_source: 'd7', deposit_account: null, active: true, notes: '', created_at: '', updated_at: '' },
  // Transfers — savings and investments
  { id: 'r6', user_id: 'demo', name: 'Emergency Fund', amount: 300, rule_type: 'transfer', frequency: 'monthly', due_day: 5, due_month: null, start_date: '2026-01-05', end_date: null, category: 'Savings', payment_source: 'd1', deposit_account: 'd3', active: true, notes: 'HYS contribution', created_at: '', updated_at: '' },
  { id: 'r7', user_id: 'demo', name: '401k Contribution', amount: 375, rule_type: 'investment', frequency: 'monthly', due_day: 5, due_month: null, start_date: '2026-01-05', end_date: null, category: 'Investing', payment_source: 'd1', deposit_account: 'd4', active: true, notes: 'Pre-tax', created_at: '', updated_at: '' },
  { id: 'r8', user_id: 'demo', name: 'Roth IRA', amount: 250, rule_type: 'investment', frequency: 'monthly', due_day: 10, due_month: null, start_date: '2026-01-10', end_date: null, category: 'Investing', payment_source: 'd1', deposit_account: 'd5', active: true, notes: '', created_at: '', updated_at: '' },
  { id: 'r9', user_id: 'demo', name: 'Brokerage', amount: 200, rule_type: 'investment', frequency: 'monthly', due_day: 10, due_month: null, start_date: '2026-01-10', end_date: null, category: 'Investing', payment_source: 'd1', deposit_account: 'd6', active: true, notes: 'Index funds', created_at: '', updated_at: '' },
  // Non-paycheck income — demonstrates Bug 2 fix (non-paycheck income included in simulation)
  { id: 'dr-roommate', user_id: 'demo', name: 'Roommate Contribution', amount: 900, rule_type: 'income', frequency: 'monthly', due_day: 1, due_month: null, start_date: '2026-01-01', end_date: null, category: 'Other', payment_source: null, deposit_account: 'd1', active: true, notes: 'Monthly rent split', created_at: '', updated_at: '' },
  // Explicit CC purchase rules — ensures monthlyNewPurchases is realistic for each card
  { id: 'dr-cc1', user_id: 'demo', name: 'Monthly Expenses', amount: 450, rule_type: 'expense', frequency: 'monthly', due_day: 5, due_month: null, start_date: '2026-01-05', end_date: null, category: 'Groceries', payment_source: 'account:d7', deposit_account: null, active: true, notes: 'Groceries & dining on Sapphire', created_at: '', updated_at: '' },
  { id: 'dr-cc2', user_id: 'demo', name: 'Subscriptions', amount: 85, rule_type: 'expense', frequency: 'monthly', due_day: 4, due_month: null, start_date: '2026-01-04', end_date: null, category: 'Subscriptions', payment_source: 'account:d8', deposit_account: null, active: true, notes: 'Streaming & services on Discover', created_at: '', updated_at: '' },
];
