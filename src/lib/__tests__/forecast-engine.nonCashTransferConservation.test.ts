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

const FUNDING = acct({ id: 'chk-1', name: 'Funding', account_type: 'checking', balance: 3000 });

function makeInputs(accounts: AccountRow[], rules: ForecastInputs['rules']): ForecastInputs {
  return {
    debts: [], goals: [], carFunds: [],
    accounts,
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules,
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
    // Due day 4 is after this, so month 0 counts every transfer once: month i has run i + 1 of them.
    syncCutoffDate: '2026-10-01',
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
  };
}

const run = (accounts: AccountRow[], rules: ForecastInputs['rules']) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
  return calculateForecast(makeInputs(accounts, rules));
};

const transfer = (id: string, from: string, to: string, amount: number) => ({
  id, name: id, rule_type: 'transfer', amount, active: true, frequency: 'monthly', due_day: 4,
  payment_source: from, deposit_account: to, category: 'Transfer', start_date: null, end_date: null,
});

type Row = { assetBreakdown: { id: string; balance: number }[] };
const bal = (row: Row, id: string) => row.assetBreakdown.find(a => a.id === id)!.balance;

// A TRANSFER CANNOT DELIVER MORE THAN ITS SOURCE GAVE (ask 202b320d). Step 4b-ii clamps a non-cash
// transfer's SOURCE at zero when the account runs short, but the DESTINATION was credited the full
// requested amount regardless - in step 4b for a savings / investment / retirement destination and in
// step 4b-iii for a second checking account. So once the source ran dry the forecast created the
// difference out of nothing every month, and Net Worth drifted up by it for the rest of the horizon.
//
// Would-fail check: credit the destination `item.amount` instead of what the source gave, and every
// case below reads the requested amount landing in a month where the source had nothing left.
describe('forecast-engine - a non-cash transfer conserves money when its source runs short', () => {
  afterEach(() => vi.useRealTimers());

  it('savings into a second checking account: the destination gets only what savings had', () => {
    const SAV = acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 100 });
    const OPS = acct({ id: 'chk-2', name: 'Operations', account_type: 'checking', balance: 50 });
    const out = run([FUNDING, SAV, OPS], [transfer('t1', 'sav-1', 'chk-2', 65)] as unknown as ForecastInputs['rules']);
    // Month 0: savings 100 -> 35, Operations 50 -> 115. Month 1: savings gives its last 35, not 65.
    expect(bal(out.data[0], 'sav-1')).toBeCloseTo(35, 2);
    expect(bal(out.data[0], 'chk-2')).toBeCloseTo(115, 2);
    expect(bal(out.data[1], 'sav-1')).toBeCloseTo(0, 2);
    expect(bal(out.data[1], 'chk-2')).toBeCloseTo(150, 2);
    expect(bal(out.data[11], 'chk-2')).toBeCloseTo(150, 2);
    for (const row of out.data) expect(bal(row, 'sav-1') + bal(row, 'chk-2')).toBeCloseTo(150, 2);
  });

  it('savings into brokerage: the destination gets only what savings had', () => {
    const SAV = acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 100 });
    const BRK = acct({ id: 'brk-1', name: 'Brokerage', account_type: 'brokerage', balance: 0 });
    const out = run([FUNDING, SAV, BRK], [transfer('t1', 'sav-1', 'brk-1', 65)] as unknown as ForecastInputs['rules']);
    expect(bal(out.data[0], 'brk-1')).toBeCloseTo(65, 2);
    expect(bal(out.data[1], 'brk-1')).toBeCloseTo(100, 2);
    expect(bal(out.data[11], 'brk-1')).toBeCloseTo(100, 2);
    for (const row of out.data) expect(bal(row, 'sav-1') + bal(row, 'brk-1')).toBeCloseTo(100, 2);
  });

  it('a chain (A -> B -> brokerage) settles whatever order the rules are listed in', () => {
    const A = acct({ id: 'sav-a', name: 'A', account_type: 'savings', balance: 100 });
    const B = acct({ id: 'sav-b', name: 'B', account_type: 'high_yield_savings', balance: 0 });
    const BRK = acct({ id: 'brk-1', name: 'Brokerage', account_type: 'brokerage', balance: 0 });
    // B -> brokerage listed FIRST, so B is asked to give before A has paid it.
    const rules = [transfer('t-b', 'sav-b', 'brk-1', 100), transfer('t-a', 'sav-a', 'sav-b', 100)] as unknown as ForecastInputs['rules'];
    const out = run([FUNDING, A, B, BRK], rules);
    // Month 0: A's 100 reaches B and passes straight through to brokerage, same as before the fix.
    expect(bal(out.data[0], 'sav-a')).toBeCloseTo(0, 2);
    expect(bal(out.data[0], 'sav-b')).toBeCloseTo(0, 2);
    expect(bal(out.data[0], 'brk-1')).toBeCloseTo(100, 2);
    // Month 1 on: nothing is left anywhere upstream, so nothing more arrives.
    expect(bal(out.data[11], 'brk-1')).toBeCloseTo(100, 2);
    for (const row of out.data) {
      expect(bal(row, 'sav-a') + bal(row, 'sav-b') + bal(row, 'brk-1')).toBeCloseTo(100, 2);
    }
  });

  it('a funded transfer is unchanged: the full amount moves every month', () => {
    const SAV = acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 10000 });
    const BRK = acct({ id: 'brk-1', name: 'Brokerage', account_type: 'brokerage', balance: 0 });
    const out = run([FUNDING, SAV, BRK], [transfer('t1', 'sav-1', 'brk-1', 65)] as unknown as ForecastInputs['rules']);
    expect(bal(out.data[11], 'brk-1')).toBeCloseTo(65 * 12, 2);
    expect(bal(out.data[11], 'sav-1')).toBeCloseTo(10000 - 65 * 12, 2);
  });
});
