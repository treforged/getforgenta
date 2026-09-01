// NON-FUNDING LIQUID ACCOUNTS ARE ASSETS — a second checking account is money the user has.
//
// Tre, 2026-09-02: *"include the general operations account balance in the forecast pop ups."* He
// has three checking accounts; only the funding one existed anywhere in the engine. Starting cash
// seeds from the funding account alone (correctly — summing every liquid account inflates opening
// cash and masks real floor breaches), and the per-account trackers covered only brokerage,
// savings/HYS and retirement. So "General Operations" reached no popup row AND no total, while
// `net-worth.ts` counts it as an asset like any other. Forecast Net Worth was understated by the
// whole of it, in every month, and NOTHING IN THE SUITE NOTICED — 3160 tests passed before and
// after the fix. That silence is why this file exists.
//
// Would-fail check: drop `otherLiquidBal` from the `totalAssets` sum and the totals assertions
// below fail; drop the `perAcctOtherLiquid` rows from `assetBreakdown` and the row assertions do.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

const acct = (over: Record<string, unknown>): AccountRow =>
  ({
    id: 'x', name: 'x', account_type: 'checking', balance: 0, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
    ...over,
  } as unknown as AccountRow);

const ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  // Zero growth everywhere: a balance difference can then only be a real movement, never interest.
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

// Named and valued after his real accounts on 2026-09-02, so a regression reads like the bug did.
const FUNDING = acct({ id: 'chk-1', name: 'CHASE CHECKING', account_type: 'checking', balance: 3123.76 });
const GENOPS = acct({ id: 'chk-2', name: 'General Operations', account_type: 'checking', balance: 168.54 });
const ALLIANT = acct({ id: 'chk-3', name: 'Alliant Checking', account_type: 'checking', balance: 5 });

function makeInputs(accounts: AccountRow[]): ForecastInputs {
  return {
    debts: [], goals: [], carFunds: [],
    accounts,
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
    oneTimeByMonth: {}, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
    transactions: [],
    currentMonthRecommendedDebt: null,
    forecastMonthEvents: [],
    forecastFundingAccountId: 'chk-1',
    cashFloor: 0,
    pauseSavings: false,
    syncCutoffDate: '2025-12-31',
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
  };
}

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

const cashRows = (row: { assetBreakdown: { bucket: string; name: string; balance: number }[] }) =>
  row.assetBreakdown.filter(a => a.bucket === 'cash');

describe('forecast-engine — non-funding liquid accounts are assets', () => {
  afterEach(() => vi.useRealTimers());

  it('gives each non-funding liquid account its own row, and never the funding account', () => {
    anchor();
    const out = calculateForecast(makeInputs([FUNDING, GENOPS, ALLIANT]));
    const rows = cashRows(out.data[0]);
    expect(rows.map(r => r.name).sort()).toEqual(['Alliant Checking', 'General Operations']);
    expect(rows.find(r => r.name === 'General Operations')!.balance).toBeCloseTo(168.54, 2);
    // The funding account is the cash walk's own subject and is already reported as ending cash.
    // A row for it here would double-count it into Total Assets.
    expect(rows.some(r => r.name === 'CHASE CHECKING')).toBe(false);
  });

  it('counts them in totalAssets — the defect was a missing $173.54, not a missing row', () => {
    anchor();
    const withThem = calculateForecast(makeInputs([FUNDING, GENOPS, ALLIANT]));
    anchor();
    const without = calculateForecast(makeInputs([FUNDING]));
    // raw*, not the rounded display twins: `totalAssets`/`netWorth` are whole-dollar fields for
    // the chart and table, and asserting cents against them measures the rounding, not the fix.
    const delta = withThem.data[0].rawTotalAssets - without.data[0].rawTotalAssets;
    expect(delta).toBeCloseTo(173.54, 2);
    // Net worth must move by the same amount: these accounts carry no liability.
    expect(withThem.data[0].rawNetWorth - without.data[0].rawNetWorth).toBeCloseTo(173.54, 2);
  });

  it('does not hand the money to the cash walk — assets are not spendable cash', () => {
    anchor();
    const withThem = calculateForecast(makeInputs([FUNDING, GENOPS, ALLIANT]));
    anchor();
    const without = calculateForecast(makeInputs([FUNDING]));
    // Ending cash is the FUNDING account's story alone. Folding these balances into it would
    // inflate opening cash and mask real floor breaches, which is the reason `liquidBal` seeds
    // from the funding account in the first place.
    expect(withThem.data[0].rawEndingCash).toBeCloseTo(without.data[0].rawEndingCash, 2);
  });

  it('the rows still sum into the total in a later month, not just month 0', () => {
    anchor();
    const out = calculateForecast(makeInputs([FUNDING, GENOPS, ALLIANT]));
    const late = out.data[12];
    const rowTotal = cashRows(late).reduce((s, r) => s + r.balance, 0);
    expect(rowTotal).toBeCloseTo(173.54, 2);
    expect(late.rawTotalAssets).toBeGreaterThanOrEqual(rowTotal);
  });
});
