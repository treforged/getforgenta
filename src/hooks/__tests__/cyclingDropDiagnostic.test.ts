// @vitest-environment jsdom
// Diagnostic + regression test for the cycling-transition balance-drop bug
// reported 2026-06-17 ("prime visa never actually pays the full amount...
// it just drops and pays last month's purchases"). Kept intentionally (per
// explicit instruction) until the user confirms the issue is fully cleared
// — do not delete without confirmation.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCardProjection } from '../useCardProjection';
import { buildPayConfig } from '@/lib/pay-schedule';
import { generateScheduledEvents } from '@/lib/scheduling';

const PRIME_VISA = '9111bd9f-4704-4acb-97f7-cf1ab40bc764';
const DISCOVER = '34c9574b-3557-4729-a812-f0b1b508b882';
const VENTURE_X = '3cd63d6e-9d80-4a32-9bb1-5d608286eb14';
const TOTAL_CHECKING = '933cbc10-bceb-4c20-8227-4a02e6db728a';
const GENERAL_OPS = '63b8e559-5ac3-40bb-95b0-15fa04f1913a';
const SAVINGS = '36997c1c-0de7-45a5-8806-655bdcc78893';

const accounts = [
  { id: '1a6890a5-751f-462f-8794-1118475a72f2', name: 'Lockheed Martin Corporation Salaried Savings Plan', account_type: '401k', balance: 5109.18, active: true },
  { id: '5543a7d3-707a-486c-a0d7-5e31f21c91b2', name: 'Robinhood individual', account_type: 'brokerage', balance: 2558.27604074, active: true },
  { id: 'eb3f82fe-79ac-4d86-9e4a-2b626eda6ef6', name: 'Fidelity Go Automated', account_type: 'brokerage', balance: 173, active: true },
  { id: TOTAL_CHECKING, name: 'TOTAL CHECKING', account_type: 'checking', balance: 1236.07, active: true },
  { id: '61112dc5-f275-42ba-b6f4-b0150dfb941b', name: 'Checking', account_type: 'checking', balance: 50, active: true },
  { id: GENERAL_OPS, name: 'General Operations', account_type: 'checking', balance: 70.36, active: true },
  { id: DISCOVER, name: 'Discover it Card', account_type: 'credit_card', balance: 3734.71, credit_limit: 11000, apr: 19.49, min_payment: 99, payment_preference: 'full', payment_due_day: 1, active: true },
  { id: PRIME_VISA, name: 'Prime Visa', account_type: 'credit_card', balance: 4974.94, credit_limit: 12000, apr: 27.49, min_payment: 231.15, payment_preference: 'statement', payment_due_day: 1, active: true },
  { id: VENTURE_X, name: 'Venture X', account_type: 'credit_card', balance: 0, credit_limit: 15000, apr: 15, min_payment: null, payment_preference: 'statement', payment_due_day: 7, card_start_date: '2026-08-28', active: true },
  { id: '486cca01-b36a-43c7-a7b7-8ec5403dc60c', name: 'Roth IRA', account_type: 'roth_ira', balance: 877, apr: 10, active: true },
  { id: SAVINGS, name: 'Savings Account', account_type: 'savings', balance: 410.52, apr: 3.25, active: true },
];

const debts = [
  { id: '06379efa-5f74-4fed-a7e7-e352c7c58f1f', name: 'Prime Visa', balance: 4240.57, apr: 27.49, min_payment: 250, target_payment: 500, credit_limit: 12000 },
  { id: 'f675e6da-d747-4e18-a797-266520864996', name: 'Discover it Card', balance: 3734.71, apr: 19.49, min_payment: 82, target_payment: 52, credit_limit: 11000 },
];

const rules = [
  { id: '7a065204', name: 'Amazon', amount: 69, rule_type: 'expense', frequency: 'yearly', due_day: 1, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Subscriptions' },
  { id: 'f2e37b76', name: 'Amazon Prime', amount: 69, rule_type: 'expense', frequency: 'yearly', due_day: 1, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Subscriptions' },
  { id: '4dbdc1c6', name: 'Chewy', amount: 79, rule_type: 'expense', frequency: 'yearly', due_day: 10, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Subscriptions' },
  { id: '8cca9105', name: 'Claude', amount: 20, rule_type: 'expense', frequency: 'monthly', due_day: 20, payment_source: GENERAL_OPS, deposit_account: null, active: true, category: 'Subscriptions' },
  { id: '7bde465d', name: 'Costco Membership', amount: 130, rule_type: 'expense', frequency: 'yearly', due_day: 31, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Subscriptions', start_date: '2026-03-31' },
  { id: '37931750', name: 'Dog food', amount: 45, rule_type: 'expense', frequency: 'monthly', due_day: 20, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Bills', start_date: '2026-05-19' },
  { id: '3ebc83fc', name: 'Eating Out', amount: 50, rule_type: 'expense', frequency: 'biweekly', due_day: 6, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Dining' },
  { id: '5b9334d3', name: 'Electricity', amount: 100, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: TOTAL_CHECKING, deposit_account: null, active: true, category: 'Bills' },
  { id: '002f7e28', name: 'Fuel', amount: 65, rule_type: 'expense', frequency: 'biweekly', due_day: 5, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Gas' },
  { id: 'de90b4df', name: 'Google Workspace', amount: 84, rule_type: 'expense', frequency: 'yearly', due_day: 1, payment_source: GENERAL_OPS, deposit_account: null, active: true, category: 'Subscriptions' },
  { id: '0683bc28', name: 'Groceries', amount: 350, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Groceries' },
  { id: 'ffa2fcfb', name: 'Internet', amount: 85, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: TOTAL_CHECKING, deposit_account: null, active: true, category: 'Bills' },
  { id: '9a0950c1', name: 'Life Insurance', amount: 54, rule_type: 'expense', frequency: 'monthly', due_day: 3, payment_source: TOTAL_CHECKING, deposit_account: null, active: true, category: 'Bills' },
  { id: '0e0e5d4e', name: 'Pet Insurance', amount: 583, rule_type: 'expense', frequency: 'yearly', due_day: 21, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Pets' },
  { id: 'da63a5ff', name: 'Pettable', amount: 100, rule_type: 'expense', frequency: 'yearly', due_day: 21, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Subscriptions' },
  { id: '44b8f085', name: 'QUO', amount: 22, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: GENERAL_OPS, deposit_account: null, active: true, category: 'Subscriptions' },
  { id: 'c8bd61fa', name: 'Rent', amount: 1915, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: TOTAL_CHECKING, deposit_account: null, active: true, category: 'Bills', start_date: '2026-03-18' },
  { id: '43dfee9c', name: 'Smart Home', amount: 40, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: TOTAL_CHECKING, deposit_account: null, active: true, category: 'Bills' },
  { id: 'efa70498', name: 'Spotify', amount: 8, rule_type: 'expense', frequency: 'monthly', due_day: 17, payment_source: PRIME_VISA, deposit_account: null, active: true, category: 'Subscriptions', start_date: '2026-03-18' },
  { id: '5aa20b02', name: 'Water/Sewer/Trash', amount: 30, rule_type: 'expense', frequency: 'monthly', due_day: 1, payment_source: TOTAL_CHECKING, deposit_account: null, active: true, category: 'Bills' },
  { id: 'b81a2198', name: 'GF Half of Rent/Groceries', amount: 1100, rule_type: 'income', frequency: 'monthly', due_day: 28, payment_source: null, deposit_account: TOTAL_CHECKING, active: true, category: 'Other', start_date: '2026-05-29', end_date: '2027-12-31' },
  { id: '3a30b089', name: 'Weekly Paycheck', amount: 848.89, rule_type: 'income', frequency: 'weekly', due_day: 5, payment_source: null, deposit_account: TOTAL_CHECKING, active: true, category: 'Other', start_date: '2026-03-18' },
  { id: '55772802', name: 'Robinhood Contributions', amount: 50, rule_type: 'investment', frequency: 'monthly', due_day: 28, payment_source: TOTAL_CHECKING, deposit_account: '5543a7d3-707a-486c-a0d7-5e31f21c91b2', active: true, category: 'Investing', start_date: '2027-01-28' },
  { id: 'dfc63299', name: 'Roth IRA', amount: 100, rule_type: 'investment', frequency: 'monthly', due_day: 7, payment_source: TOTAL_CHECKING, deposit_account: '486cca01-b36a-43c7-a7b7-8ec5403dc60c', active: true, category: 'Investing', start_date: '2027-01-07' },
  { id: '73a5c998', name: 'HYS', amount: 400, rule_type: 'transfer', frequency: 'monthly', due_day: 28, payment_source: TOTAL_CHECKING, deposit_account: SAVINGS, active: true, category: 'Savings', start_date: '2027-01-28' },
  { id: 'e716c838', name: 'Owners Contribution', amount: 50, rule_type: 'transfer', frequency: 'monthly', due_day: 7, payment_source: TOTAL_CHECKING, deposit_account: GENERAL_OPS, active: true, category: 'Business', start_date: '2026-04-07' },
];

const transactions = [
  { date: '2026-03-06', type: 'expense', amount: 65, category: 'Gas', payment_source: `account:${PRIME_VISA}`, note: 'Fuel' },
  { date: '2026-03-17', type: 'expense', amount: 8, category: 'Subscriptions', payment_source: `account:${PRIME_VISA}`, note: 'Spotify' },
  { date: '2026-03-20', type: 'expense', amount: 50, category: 'Dining', payment_source: `account:${PRIME_VISA}`, note: 'Eating Out' },
  { date: '2026-03-20', type: 'expense', amount: 65, category: 'Gas', payment_source: `account:${PRIME_VISA}`, note: 'Fuel' },
  { date: '2026-03-27', type: 'expense', amount: 65, category: 'Gas', payment_source: `account:${PRIME_VISA}`, note: 'Fuel' },
  { date: '2026-06-01', type: 'expense', amount: 410, category: 'Travel', payment_source: `account:${PRIME_VISA}`, note: 'Cruise Payoff' },
  { date: '2026-08-01', type: 'expense', amount: 711, category: 'Other', payment_source: `account:${PRIME_VISA}`, note: 'Cruise Package' },
];

const paymentPlans = [
  { id: 'faa355fd', name: 'Car Interior Parts', provider: 'Amazon 12 Months', total_amount: 1737, payment_amount: 144, frequency: 'monthly', start_date: '2026-06-19', total_payments: 12, category: 'Car', payment_source: `account:${PRIME_VISA}`, active: true },
  { id: 'c09ac91c', name: 'Coilovers + brakes', provider: 'Amazon', total_amount: 2333, payment_amount: 194, frequency: 'monthly', start_date: '2026-09-25', total_payments: 12, category: 'Car', payment_source: `account:${VENTURE_X}`, active: true },
] as any[];

const carFunds = [
  {
    id: '0f75dec9', vehicle_name: '2004 Chevorlet C5', target_price: 21775, tax_fees: 1775,
    down_payment_goal: 7700, current_saved: 410.52, monthly_insurance: 77, expected_apr: 10.59,
    loan_term_months: 48, phase: 'saving', loan_amount: 0, linked_account: SAVINGS,
    linked_rule_id: null, planned_purchase_date: '2026-06-20', gift_contribution: 6700,
    lump_sum_payments: [
      { id: 'd72bbf83', date: '2027-07-14', amount: 500 }, { id: '46124967', date: '2027-08-14', amount: 500 },
      { id: 'a92b15ca', date: '2027-09-14', amount: 500 }, { id: '3137183b', date: '2027-10-14', amount: 500 },
      { id: 'dd857559', date: '2027-11-14', amount: 500 }, { id: 'f012397f', date: '2027-12-14', amount: 500 },
      { id: '712d2d57', date: '2028-01-15', amount: 500 }, { id: '3d7e489a', date: '2028-02-11', amount: 500 },
      { id: 'a86d01f9', date: '2028-03-11', amount: 500 }, { id: '82971a7b', date: '2028-04-11', amount: 500 },
      { id: '9d3e8cfa', date: '2028-05-11', amount: 500 },
    ],
  },
];

const goals = [
  { id: 'e0bd7507', name: '401K Roth', target_amount: 50000, current_amount: 4376.70, monthly_contribution: 236.82, goal_type: 'Retirement', linked_account: '1a6890a5-751f-462f-8794-1118475a72f2', contribution_start_date: '2026-05-01', linked_rule_id: null },
  { id: '94cb7cfd', name: 'Roth IRA', target_amount: 7000, current_amount: 0, monthly_contribution: 0, goal_type: 'Retirement', linked_account: '486cca01-b36a-43c7-a7b7-8ec5403dc60c', contribution_start_date: null, linked_rule_id: 'dfc63299' },
  { id: '0d292528', name: 'Emergency Fund', target_amount: 20000, current_amount: 208, monthly_contribution: 200, goal_type: 'Emergency Fund', linked_account: SAVINGS, contribution_start_date: '2026-12-28', linked_rule_id: '73a5c998' },
];

const profile: any = {
  cash_floor: 2500, weekly_gross_income: 1093, paycheck_frequency: 'weekly', paycheck_day: 5,
  monthly_income_default: 3678.519, gross_income: 4736.333333333333, tax_rate: 22,
  default_deposit_account: TOTAL_CHECKING,
  paycheck_deductions: [
    { id: 'medical', mode: 'flat', label: 'Medical Insurance', value: 8.72, preTax: true },
    { id: 'd1', mode: 'flat', label: 'Dental Insurance', value: 4.59, preTax: true },
    { id: 'v1', mode: 'flat', label: 'Vision Insurance', value: 0.55, preTax: true },
    { id: 'a1', mode: 'flat', label: 'Accident Insurance', value: 4, preTax: false },
    { id: 'ss1', mode: 'pct', label: 'Fed OASDI / Social Security (6.2%)', value: 6.2, preTax: false },
    { id: 'med1', mode: 'pct', label: 'Fed FICA Medicare (1.45%)', value: 1.4, preTax: false },
    { id: 'k401', mode: 'pct', label: '401(k) Roth', value: 5, goalId: 'e0bd7507', preTax: false, accountId: '1a6890a5-751f-462f-8794-1118475a72f2' },
    { id: 'fw1', mode: 'pct', label: 'Federal Withholding', value: 8.1, preTax: false },
  ],
  forecast_assumptions: {
    bonusMode: 'pct', raiseMode: 'pct', bonusMonth: 2, raiseMonth: 3, bonusAmount: 3.1,
    bonusEnabled: true, incomeGrowth: 3.1, expenseGrowth: 0, bonusRecurring: true,
    taxReturnMonth: 2, taxReturnState: 'FL', savingsInterest: 4.5, investmentGrowth: 7,
    taxReturnEnabled: true, incomeGrowthEnabled: true, taxReturnDependents: 0,
    taxReturnFilingStatus: 'single', taxReturnAmountOverride: 0, taxReturnFederalWithheld: 0,
  },
};

const DEFAULT_ASSUMPTIONS = {
  incomeGrowthEnabled: true, incomeGrowth: 3.1, raiseMonth: 3, raiseMode: 'pct' as const,
  bonusEnabled: true, bonusAmount: 3.1, bonusMode: 'pct' as const, bonusMonth: 2, bonusRecurring: true,
  taxReturnEnabled: true, taxReturnAmountOverride: 0, taxReturnMonth: 2,
};

describe('cycling transition diagnostic (real account data)', () => {
  it('dumps Prime Visa + Discover month-by-month projection vs sim ground truth', () => {
    const payConfig = buildPayConfig(profile);
    const scheduledEvents = generateScheduledEvents(rules as any[], accounts as any[], 36);
    const now = new Date();
    const syncCutoffDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const { result } = renderHook(() => useCardProjection({
      accounts, transactions, rules, debts, goals, carFunds, profile,
      debtPayoffOptions: { cashFloor: 2500 },
      payConfig,
      scheduledEvents,
      pauseSavings: false,
      forecastFundingAccountId: TOTAL_CHECKING,
      debtStrategy: 'avalanche',
      persistedDebtFundingId: null,
      assumptions: DEFAULT_ASSUMPTIONS,
      syncCutoffDate,
      paymentPlans,
    } as any));

    const r = result.current;
    if (!r) {
      console.log('HOOK RETURNED NULL');
      return;
    }

    const pv = r.perCardPayments.find(p => p.id === PRIME_VISA)!;
    const pvScaled = r.perCardPaymentsScaled.find(p => p.id === PRIME_VISA)!;
    const pvRevBal = r.monthlyRevolvingBalances.get(PRIME_VISA) ?? [];
    const pvBal = r.monthlyBalances.get(PRIME_VISA) ?? [];

    console.log('=== PRIME VISA (live balance %s) ===', 4974.94);
    console.log('m | data.row | perCardPayments(raw sim) | perCardPaymentsScaled(displayed) | activeSim.revBal | activeSim.bal');
    for (let i = 0; i < 22; i++) {
      console.log(
        i,
        '| dataRow=', r.data[i]?.['Prime Visa'],
        '| rawSimPay=', pv.payments[i],
        '| scaledPay=', pvScaled.payments[i],
        '| revBal=', Math.round(pvRevBal[i] ?? -1),
        '| bal=', Math.round(pvBal[i] ?? -1),
      );
    }

    const disc = r.perCardPayments.find(p => p.id === DISCOVER)!;
    const discScaled = r.perCardPaymentsScaled.find(p => p.id === DISCOVER)!;
    const discRevBal = r.monthlyRevolvingBalances.get(DISCOVER) ?? [];
    const discBal = r.monthlyBalances.get(DISCOVER) ?? [];

    console.log('=== DISCOVER (live balance %s) ===', 3734.71);
    for (let i = 0; i < 22; i++) {
      console.log(
        i,
        '| dataRow=', r.data[i]?.['Discover it Card'],
        '| rawSimPay=', disc.payments[i],
        '| scaledPay=', discScaled.payments[i],
        '| revBal=', Math.round(discRevBal[i] ?? -1),
        '| bal=', Math.round(discBal[i] ?? -1),
      );
    }

    console.log('totalCCBalance by month:', r.data.slice(0, 22).map((d: any) => Math.round(d.totalCCBalance)));

    // Regression assertion: at month index 3, Prime Visa's ground-truth legacy debt has
    // just cleared (revBal hit 0 at index 2) while the recommended/scaled payment series
    // is smaller than the sim's raw payments — exactly the underpaid-cycling-transition
    // scenario reported by the user. Before the projectCardVariable isCycling fix, this
    // collapsed straight to ~newPurchases ($777), silently writing off the unpaid carry.
    // After the fix it correctly carries the shortfall forward (~$1,954 against this fixture).
    expect(r.data[3]?.['Prime Visa']).toBeGreaterThan(1500);
  });
});
