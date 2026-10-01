// See the describe block for the defect this pins.

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


// A TRANSFER INTO A NON-FUNDING CHECKING ACCOUNT MUST REACH IT (Tre, 2026-10-01: "general operations
// has a negative balance ... that's not even possible"). His General Operations pays ~$60.90 a month
// of business bills and is refilled by a $65 "Owners Contribution" from CHASE CHECKING. The engine
// debited the bills from it (step 4b-iii) and took the $65 out of the cash walk, but never CREDITED
// it to General Operations, so the row fell ~$61 a month and went below zero after month 1.
//
// Would-fail check: drop the cash-sourced credit to perAcctOtherLiquid and the first case reads
// 168.54 - 60.90 * n instead of 168.54 + 4.10 * n.
describe('forecast-engine - a transfer from the funding account into another checking account', () => {
  afterEach(() => vi.useRealTimers());

  const rules = [
    { id: 'r-bills', name: 'Business bills', rule_type: 'expense', amount: 60.9, active: true,
      frequency: 'monthly', due_day: 12, payment_source: 'chk-2', deposit_account: null,
      category: 'Bills', start_date: null, end_date: null },
    { id: 'r-owner', name: 'Owners Contribution', rule_type: 'transfer', amount: 65, active: true,
      frequency: 'monthly', due_day: 4, payment_source: 'chk-1', deposit_account: 'chk-2',
      category: 'Transfer', start_date: null, end_date: null },
  ] as unknown as ForecastInputs['rules'];

  const genOps = (row: { assetBreakdown: { bucket: string; name: string; balance: number }[] }) =>
    cashRows(row).find(r => r.name === 'General Operations')!.balance;

  it('credits the destination, so the account nets +$4.10 a month and never goes negative', () => {
    anchor();
    const out = calculateForecast({ ...makeInputs([FUNDING, GENOPS]), syncCutoffDate: '2026-10-01', rules });
    // syncCutoffDate is 2026-10-01, so month 0 still counts both (due days 4 and 12): n = month index + 1.
    expect(genOps(out.data[0])).toBeCloseTo(168.54 + 4.1, 2);
    expect(genOps(out.data[11])).toBeCloseTo(168.54 + 4.1 * 12, 2);
    expect(out.data.every(r => genOps(r) >= 0)).toBe(true);
  });

  it('still takes the $65 out of the funding account cash walk', () => {
    anchor();
    const base = calculateForecast({ ...makeInputs([FUNDING, GENOPS]), syncCutoffDate: '2026-10-01', rules: [rules[0]] });
    anchor();
    const out = calculateForecast({ ...makeInputs([FUNDING, GENOPS]), syncCutoffDate: '2026-10-01', rules });
    expect(base.data[0].rawEndingCash - out.data[0].rawEndingCash).toBeCloseTo(65, 2);
  });

  it('does not double-credit a transfer from savings (it already reaches the account once)', () => {
    anchor();
    const SAV = acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 1000 });
    const fromSavings = [{ ...rules[1], payment_source: 'sav-1' }] as unknown as ForecastInputs['rules'];
    const out = calculateForecast({ ...makeInputs([FUNDING, GENOPS, SAV]), syncCutoffDate: '2026-10-01', rules: fromSavings });
    expect(genOps(out.data[2])).toBeCloseTo(168.54 + 65 * 3, 2);
  });
});
