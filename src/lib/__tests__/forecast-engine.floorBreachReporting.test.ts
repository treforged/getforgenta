// THE "CASH BELOW SAFE MINIMUM" WARNING IS JUDGED AGAINST THE MONTH'S REAL FLOOR (2026-08-21).
//
// The milestone above the forecast table used to compare ending cash against the raw `cashFloor`
// SETTING, while the table coloured each row against `monthMinSafe`, the month's actual floor. The
// two therefore disagreed about the same fact, and in AUTOMATIC mode they disagreed always:
// `cash_floor_is_manual` defaults FALSE and automatic passes a setting of 0, so no positive balance
// could ever be "below" it. Tre's live forecast painted nine rows red while the summary above them
// reported nothing wrong.
//
// Would-fail check, run 2026-08-21: revert the comparison in forecast-engine.ts to
// `endingCash < cashFloor` and four of the five cases below go red, every one of them because the
// milestone list comes back empty. Only "stays silent for a month that ends above its floor"
// survives, which is the shape of the defect exactly: a warning that never fires passes every test
// that asks it not to.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

const ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

const CHK_ID = 'chk-1';
/** The floor a month is judged against is NEXT month's bills that fall due before NEXT month's
 *  first paycheck (`getPrePaycheckNextMonthBills`). With the paycheck on the 20th and this bill on
 *  the 5th, every month reserves exactly one of these, so the yardstick is a flat $2,000 and the
 *  arithmetic below stays readable. The matching income rule on the 25th replaces it exactly, so
 *  the balance holds flat and whether a month is under the floor is decided purely by where the
 *  opening balance sits. */
const BILL = 2000;

const checking = (balance: number): AccountRow =>
  ({
    id: CHK_ID, name: 'Checking', account_type: 'checking', balance, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
  } as unknown as AccountRow);

const rules = (): RuleRow[] => ([
  {
    id: 'income-1', name: 'Paycheck', amount: 2000, rule_type: 'income', frequency: 'monthly',
    due_day: 25, payment_source: null, deposit_account: CHK_ID, active: true, category: 'Other',
  },
  {
    id: 'bill-1', name: 'Rent', amount: BILL, rule_type: 'expense', frequency: 'monthly',
    due_day: 5, payment_source: CHK_ID, deposit_account: null, active: true, category: 'Bills',
  },
] as unknown as RuleRow[]);

/** `cashFloor` defaults to 0, which is exactly what AUTOMATIC mode passes. Every case here runs
 *  automatic unless it says otherwise, because automatic is the default for every user. */
function makeInputs(balance: number, cashFloor = 0): ForecastInputs {
  return {
    debts: [], goals: [], carFunds: [],
    accounts: [checking(balance)],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: rules(),
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 20, frequency: 'monthly' },
    oneTimeByMonth: {}, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
    transactions: [],
    currentMonthRecommendedDebt: null,
    forecastMonthEvents: [],
    forecastFundingAccountId: CHK_ID,
    cashFloor,
    pauseSavings: false,
    syncCutoffDate: '2026-09-30',
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
  } as unknown as ForecastInputs;
}

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T12:00:00'));
};

const breachMonths = (r: ReturnType<typeof calculateForecast>) =>
  r.milestones.filter(m => m.event.includes('below safe minimum')).map(m => m.month);

describe('forecast-engine — the below-safe-minimum warning', () => {
  afterEach(() => vi.useRealTimers());

  it('fires in automatic mode, where the setting is 0 and could never be breached', () => {
    anchor();
    // $1,000 on hand. The bill and the matching income cancel, so the month ends on the $1,000 it
    // opened with, against a floor of $2,000. Comfortably positive, and comfortably under the line
    // the table itself colours against. The setting is 0, so the old comparison saw nothing at all.
    const out = calculateForecast(makeInputs(1000));

    expect(out.data[0].rawMonthMinSafe).toBeCloseTo(BILL, 2);
    expect(out.data[0].endingCash).toBeGreaterThan(0);
    expect(out.data[0].endingCash).toBeLessThan(out.data[0].monthMinSafe);
    expect(out.data[0].belowSafeMinimum).toBe(true);
    expect(breachMonths(out)).toEqual([out.data[0].month]);
  });

  it('fires once on ENTRY, not every month of a long stretch below the floor', () => {
    anchor();
    const out = calculateForecast(makeInputs(1000));

    // The income exactly replaces the bill, so the balance never recovers: month after month sits
    // under the floor. One warning, on the month it went under.
    expect(out.data[1].belowSafeMinimum).toBe(true);
    expect(out.data[2].belowSafeMinimum).toBe(true);
    expect(breachMonths(out)).toHaveLength(1);
  });

  it('stays silent for a month that ends above its floor', () => {
    anchor();
    // $6,000 on hand, three times the floor, and the month is cash-neutral.
    const out = calculateForecast(makeInputs(6000));

    expect(out.data[0].endingCash).toBeGreaterThan(out.data[0].monthMinSafe);
    expect(out.data[0].belowSafeMinimum).toBe(false);
    expect(breachMonths(out)).toEqual([]);
  });

  it('carries the same verdict on the row that the milestone was raised from', () => {
    // The defect this replaces was two places computing one predicate differently, so the
    // invariant worth pinning is that they agree, not the value either of them happens to hold.
    // MonthlyBreakdownTable reads `belowSafeMinimum` for the red row; this walks the same rule the
    // milestone loop applies and checks the two land on the same months.
    for (const balance of [800, 1000, 2500, 6000, 20000]) {
      anchor();
      const out = calculateForecast(makeInputs(balance));
      const expected = out.data
        .filter((row, i) => row.belowSafeMinimum && row.endingCash >= 0 && !row.floorBreachedByOneTime
          && (i === 0 || !out.data[i - 1].belowSafeMinimum))
        .map(row => row.month);
      expect(breachMonths(out), `balance ${balance}`).toEqual(expected);
    }
  });

  it('a manual floor below the month obligations does not lower the yardstick', () => {
    anchor();
    // A manual $500 floor is a floor UNDER the calculation, never a replacement for it: the month
    // still owes $2,000 of bills before its next paycheck, so it is still short.
    const out = calculateForecast(makeInputs(1000, 500));

    expect(out.data[0].rawMonthMinSafe).toBeCloseTo(BILL, 2);
    expect(out.data[0].belowSafeMinimum).toBe(true);
    expect(breachMonths(out)).toEqual([out.data[0].month]);
  });
});
