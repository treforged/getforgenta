// The /forecast surfaces and the ranked automatic extra payments, wired to the engine's own
// per-month reserve.
//
// The chart was already honest: the reserve is subtracted from `cashPreDebt` and credited to the
// target's balance, so every series it draws (ending cash, liabilities, assets, net worth) moves.
// The RECEIPTS were not. `ForecastMonthRow.autoExtraByTarget` is keyed by target id and named
// nowhere, so the month drawer (and the PDF/CSV export that mirrors it field-for-field) itemised
// every other outflow and simply omitted this one — measured 2026-08-26 on the fixture below, the
// drawer's own walk printed Ending Cash $22,600 for a month the engine ended at $10,780, with the
// $11,820 extra payment on screen nowhere. `autoExtraItems` is that same list, named, and
// `totalExpenses` (the table's "−Out" column) now carries the same dollars the cash chain did.
//
// Would-fail check: drop `autoExtraOutThisMonth` from `totalMonthlyOut`, or stop emitting
// `autoExtraItems`, and the walk assertions below fail by exactly the month's reserve — which is
// the amount a reader would otherwise be unable to account for.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs, type ForecastMonthRow } from '@/lib/forecast-engine';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { buildForecastMonthDetail } from '@/lib/forecast-export';
import type { AccountRow, DebtRow, RuleRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { CardProjectionResult } from '@/lib/debt-model-types';
import type { CarFund } from '@/lib/types';

const acct = (over: Record<string, unknown>): AccountRow =>
  ({
    id: 'x', name: 'x', account_type: 'checking', balance: 0, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
    surplus_sort_order: null, surplus_share: null,
    ...over,
  } as unknown as AccountRow);

const ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

/** The `forecast-engine.extrasPayoffReadout.test.ts` harness, unchanged. */
function makeInputs(
  accounts: AccountRow[], debts: DebtRow[], monthlyRuleExpenses: number,
  over: Partial<ForecastInputs> = {},
): ForecastInputs {
  return {
    debts, goals: [], carFunds: [],
    accounts,
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [] as RuleRow[],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: 1200, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
    oneTimeByMonth: {}, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
    transactions: [],
    currentMonthRecommendedDebt: null,
    forecastMonthEvents: Array.from({ length: PROJECTION_MONTHS }, () => ({
      income: 0, nonPaycheckIncome: 0, expenses: monthlyRuleExpenses,
    })),
    forecastFundingAccountId: 'chk-1',
    cashFloor: 0,
    pauseSavings: false,
    syncCutoffDate: '2025-12-31',
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
    ...over,
  };
}

const CHK = acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 20000 });
const STUDENT_DEBT = { id: 'd1', name: 'Student Loan', balance: 12000, apr: 12, target_payment: 300 } as unknown as DebtRow;
const loanAcct = (over: Record<string, unknown> = {}) => acct({
  id: 'sl-1', name: 'Student Loan', account_type: 'student_loan', balance: 12000, ...over,
});

const c5 = (over: Partial<CarFund> = {}): CarFund => ({
  id: 'c5', user_id: 'u', vehicle_name: '2004 Chevrolet C5',
  target_price: 0, tax_fees: 0, down_payment_goal: 7_700, current_saved: 0,
  saved_source: 'fixed', saved_percent: 0, monthly_insurance: 0,
  expected_apr: 10.18, loan_term_months: 48, phase: 'loan',
  loan_amount: 16_530, loan_start_date: '2026-08-07', payment_start_date: '2026-08-07',
  interest_start_date: '2026-08-07', insurance_start_date: null,
  actual_monthly_payment: 422.89, linked_account: null, linked_rule_id: null,
  loan_payment_account: null, linked_loan_account_id: null, planned_purchase_date: null,
  gift_contribution: 0, lump_sum_payments: [], sort_order: 0, auto_extra: false,
  created_at: '', ...over,
} as unknown as CarFund);

const CARD_PROJECTION = {
  data: [], simCards: [], allPaymentTotals: [], debtPaymentTotals: [],
  perCardPayments: [], perCardPaymentsScaled: [], paymentLedger: [],
  monthlyRevolvingBalances: new Map(), monthlyBalances: new Map(),
  perCardMinPayments: new Map(), monthlyCyclingOwed: new Map(),
  monthlyCyclingInterest: new Map(), monthlyInterest: new Map(),
  monthlyCyclingBacklog: new Map(),
  month0: { autoExtraPerTarget: [], chain: { autoExtraReserve: 0 } },
} as unknown as CardProjectionResult;

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

const run = (accounts: AccountRow[], expenses = 1000) =>
  calculateForecast(makeInputs(accounts, [STUDENT_DEBT], expenses));

/** The drawer's own arithmetic: the terms it prints, in the order it prints them, ending at the
 *  Ending Cash it prints under them. `buildForecastMonthDetail` IS the drawer's line list — the
 *  export mirrors it field-for-field, which is why pinning it pins both surfaces at once. */
const walkToEndingCash = (row: ForecastMonthRow, i: number) => {
  const detail = buildForecastMonthDetail(row as never, i, null);
  const income = detail.income.reduce((s, x) => s + x.amount, 0);
  const expenses = detail.expenses.reduce((s, x) => s + x.amount, 0);
  return row.startingCash + income - expenses;
};

describe('forecast month drawer - ranked automatic extra payments', () => {
  afterEach(() => vi.useRealTimers());

  it('itemises the ranked extra by name, so the drawer walk reaches its own Ending Cash', () => {
    anchor();
    const ranked = run([CHK, loanAcct({ surplus_sort_order: 0 })]);
    anchor();
    const control = run([CHK, loanAcct()]);

    const row = ranked.data[1];
    const reserve = row.autoExtraByTarget['sl-1'];
    expect(reserve).toBeGreaterThan(0);

    // The named twin of `autoExtraByTarget` — same target, same dollars, one name. Named off the
    // liability's own projected row, so the line can never carry a different debt's name.
    expect(row.autoExtraItems).toEqual([{ id: 'sl-1', name: 'Student Loan', kind: 'liability', amount: reserve }]);
    // No reserve, no line: a month that diverted nothing must not grow a $0 row.
    expect(control.data[1].autoExtraItems).toEqual([]);

    // THE WALK. No saving-phase car fund here, so nothing is added back into Ending Cash and the
    // printed terms are the whole story — this identity is exactly what a reader does by eye.
    expect(row.carReserveHeld).toBe(0);
    expect(walkToEndingCash(row, 1)).toBeCloseTo(row.rawEndingCash, 2);
    expect(walkToEndingCash(control.data[1], 1)).toBeCloseTo(control.data[1].rawEndingCash, 2);

    // And the line the reader actually sees, on the drawer and in the export alike.
    const labels = buildForecastMonthDetail(row as never, 1, null).expenses;
    const extraLine = labels.find(x => x.label === 'Student Loan — Extra Payment');
    expect(extraLine?.amount).toBeCloseTo(reserve, 6);
  });

  it('counts the reserve in the "−Out" column, which the cash chain had already spent', () => {
    anchor();
    const ranked = run([CHK, loanAcct({ surplus_sort_order: 0 })]);
    anchor();
    const control = run([CHK, loanAcct()]);

    const reserve = ranked.data[1].autoExtraByTarget['sl-1'];
    // Same month, same bills, same scheduled $300 of debt service — the ONLY difference between
    // the two runs is the extra, so the column has to differ by exactly it. Before this it did
    // not differ at all, while the End Cash cell in the same row fell by the whole reserve.
    expect(ranked.data[1].totalExpenses).toBeCloseTo(control.data[1].totalExpenses + reserve, 6);
    expect(control.data[1].totalExpenses).toBeCloseTo(1000 + 300, 6);
  });

  it('names a vehicle-loan extra after the vehicle, and keeps the chart series extra-aware', () => {
    const loanInputs = (fund: CarFund) => makeInputs(
      [acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 30_000 })], [], 0,
      {
        carFunds: [fund], cardProjectionData: CARD_PROJECTION,
        payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
        forecastMonthEvents: [],
      },
    );
    anchor();
    const off = calculateForecast(loanInputs(c5({ auto_extra: false })));
    anchor();
    const on = calculateForecast(loanInputs(c5({ auto_extra: true })));

    const row = on.data[1];
    const items = row.autoExtraItems;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'c5', name: '2004 Chevrolet C5', kind: 'loan' });
    expect(items[0].amount).toBeGreaterThan(0);
    // The itemised lines and the record are one list: the drawer can never show a different total
    // than the chart-facing field does.
    expect(items.reduce((s, x) => s + x.amount, 0))
      .toBeCloseTo(Object.values(row.autoExtraByTarget).reduce((s, v) => s + v, 0), 6);
    expect(off.data[1].autoExtraItems).toEqual([]);

    // The CHART was already right and must stay right: the extra leaves cash and retires
    // liabilities, so both series move on the opted-in run. (If this ever stops being true the
    // drawer above would be itemising a diversion the picture beside it does not show.)
    //
    // Cash moves the SAME month; the liability total moves the NEXT one. That lag is the engine's
    // documented, deliberate behaviour for vehicle loans (forecast-engine.ts, the 4c-ii-c note:
    // `carLoanBalanceByMonth[i]` is read by step 4 before the month's credit reduces it, left
    // alone because moving it would change existing users' projected numbers) — so the aggregate
    // is asserted at month 2, where month 1's credit is first visible.
    expect(row.endingCash).toBeLessThan(off.data[1].endingCash);
    expect(on.data[2].totalLiabilities).toBeLessThan(off.data[2].totalLiabilities);
  });
});
