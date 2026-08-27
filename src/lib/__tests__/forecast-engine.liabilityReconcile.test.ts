// The forecast's "Total Liabilities" line must equal the rows the same drawer prints above it.
//
// It did not, for two shapes that both exist in real data: a connected liability ACCOUNT with no
// `debts` row (a Plaid auto_loan has no min_payment, so nothing matches it) was itemised but
// counted as $0; and a `debts` row with no account was counted but never shown. The total came
// from `debts`, the rows came from `accounts`, and nothing checked that they agreed.
//
// Would-fail check: restore the two-source computation in forecast-engine.ts and case 1 reports a
// total of 4000 under a drawer showing 20000, while case 2 shows no row at all.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow, DebtRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

const acct = (over: Record<string, unknown>): AccountRow =>
  ({
    id: 'x', name: 'x', account_type: 'checking', balance: 0, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
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

function makeInputs(accounts: AccountRow[], debts: DebtRow[]): ForecastInputs {
  return {
    debts, goals: [], carFunds: [],
    accounts,
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: 1200, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
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

const CHK = acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 20000 });

const shownRows = (row: ReturnType<typeof calculateForecast>['data'][number]) => [
  ...row.nonCCLiabBreakdown.map(r => ({ name: r.name, balance: r.balance })),
  ...row.carLoanBreakdown.map(r => ({ name: r.name, balance: r.balance })),
];
const shownTotal = (row: ReturnType<typeof calculateForecast>['data'][number]) =>
  shownRows(row).reduce((s, r) => s + r.balance, 0);

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

describe('forecast-engine — Total Liabilities equals the rows the drawer prints', () => {
  afterEach(() => vi.useRealTimers());

  it('counts a connected liability account that has no debts row', () => {
    anchor();
    const { data } = calculateForecast(makeInputs(
      [CHK, acct({ id: 'ln-1', name: 'FIXED RATE LOAN', account_type: 'auto_loan', balance: 20000 })],
      [],
    ));
    expect(shownRows(data[0])).toEqual([{ name: 'FIXED RATE LOAN', balance: 20000 }]);
    expect(data[0].rawTotalLiabilities).toBeCloseTo(20000, 6);
    expect(data[0].rawTotalLiabilities).toBeCloseTo(shownTotal(data[0]), 6);
  });

  it('itemises a debts row that has no account', () => {
    anchor();
    const { data } = calculateForecast(makeInputs(
      [CHK],
      [{ id: 'd1', name: 'Medical bill', balance: 4000, apr: 0, target_payment: 500 } as unknown as DebtRow],
    ));
    // END-of-month, like every other line in the drawer section these rows sit in (2026-08-27):
    // 0% and $500 a month, so month 0 closes at 3500 and month 2 at 2500.
    expect(shownRows(data[0])).toEqual([{ name: 'Medical bill', balance: 3500 }]);
    expect(data[0].rawTotalLiabilities).toBeCloseTo(3500, 6);
    expect(shownRows(data[2])).toEqual([{ name: 'Medical bill', balance: 2500 }]);
  });

  it('reconciles month after month for a matched pair carrying real interest', () => {
    anchor();
    const { data } = calculateForecast(makeInputs(
      [CHK, acct({ id: 'sl-1', name: 'Student Loan', account_type: 'student_loan', balance: 12000 })],
      [{ id: 'd2', name: 'Student Loan', balance: 9999, apr: 12, target_payment: 300 } as unknown as DebtRow],
    ));
    // The connected account's balance wins over the stale manual 9999 (Tre, 2026-08-18) — and the
    // row is what the month CLOSES at, so 1%/mo on 12000 less the 300 payment: 11820.
    expect(shownRows(data[0])).toEqual([{ name: 'Student Loan', balance: 11820 }]);
    for (const i of [0, 1, 6, 12, 24]) {
      expect(data[i].rawTotalLiabilities).toBeCloseTo(shownTotal(data[i]), 6);
    }
    // Month 1 closes one payment further on: 11820 * 1.01 − 300 = 11638.20, and the row charges
    // the interest the total does.
    expect(shownRows(data[1])[0].balance).toBeCloseTo(11638.2, 6);
  });
});
