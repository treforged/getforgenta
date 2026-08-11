// N10 Finding 1 — percentage-mode paycheck deductions must scale with income growth.
//
// The engine compounds annual raises (and promotion snaps) into `incomeMultiplier`, and the
// take-home side reads deductions off the adjusted config — so net income scales. But the
// retirement-asset side used to credit a per-check contribution computed ONCE from the month-0
// gross, so after the first raise the forecast understated retirement contributions forever.
//
// These tests use a fully SYNTHETIC input (this repo is public; the real fixture is gitignored
// and every other engine test self-skips without it). Monthly pay frequency keeps the paycheck
// count at exactly 1/month so the per-check amount is directly observable per row.
//
// Would-fail check: pre-fix, "pct deduction steps up at the raise month" fails (contribution
// stays at the month-0 value), and the per-account split test fails the same way.

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
  // 10% raise every March, pct mode — the multiplier under test.
  incomeGrowthEnabled: true, incomeGrowth: 10, raiseMonth: 3, raiseMode: 'pct',
  // Zero growth everywhere else so contributions are the ONLY thing moving balances.
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

// Monthly gross = weeklyGross * 52 / 12 = 5200 exactly.
const WEEKLY_GROSS = 1200;
const MONTHLY_GROSS = WEEKLY_GROSS * 52 / 12;

function makeInputs(deductions: { value: number; mode: 'flat' | 'pct'; accountId?: string }[]): ForecastInputs {
  return {
    debts: [], goals: [], carFunds: [],
    accounts: [
      acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 10000 }),
      acct({ id: 'ret-a', name: 'Trad 401k', account_type: '401k', balance: 0, apy_rate: 0 }),
      acct({ id: 'ret-b', name: 'Roth 401k', account_type: 'roth_ira', balance: 0, apy_rate: 0 }),
    ],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: deductions as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: WEEKLY_GROSS, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
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

// Anchor the clock: month 0 = Jan 2026, so the March raise lands at data index 2.
const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-15T12:00:00'));
};

const RAISE_IDX = 2;

describe('forecast-engine — pct paycheck deductions scale with income growth (N10)', () => {
  afterEach(() => vi.useRealTimers());

  it('pct deduction steps up at the raise month; flat deduction stays flat', () => {
    anchor();
    const { data } = calculateForecast(makeInputs([
      { value: 5, mode: 'pct', accountId: 'ret-a' },   // 5% of gross → 260/check at month 0
      { value: 300, mode: 'flat', accountId: 'ret-b' }, // flat → never scales
    ]));

    const base = MONTHLY_GROSS * 0.05 + 300; // 560
    // Before the raise: month-0 value.
    expect(data[0].fullMonth401kContrib).toBeCloseTo(base, 0);
    expect(data[RAISE_IDX - 1].fullMonth401kContrib).toBeCloseTo(base, 0);
    // At and after the raise: only the pct portion scales by 1.10.
    const raised = MONTHLY_GROSS * 0.05 * 1.10 + 300; // 586
    expect(data[RAISE_IDX].fullMonth401kContrib).toBeCloseTo(raised, 0);
    expect(data[RAISE_IDX + 5].fullMonth401kContrib).toBeCloseTo(raised, 0);
    // Second annual raise compounds: 5% of gross * 1.21.
    const raisedTwice = MONTHLY_GROSS * 0.05 * 1.21 + 300;
    expect(data[RAISE_IDX + 12].fullMonth401kContrib).toBeCloseTo(raisedTwice, 0);
  });

  it('per-account attribution: the pct account absorbs the raise, the flat account does not', () => {
    anchor();
    const { data } = calculateForecast(makeInputs([
      { value: 5, mode: 'pct', accountId: 'ret-a' },
      { value: 300, mode: 'flat', accountId: 'ret-b' },
    ]));

    const retBal = (i: number, id: string) =>
      data[i].assetBreakdown.find((a) => a.bucket === 'retirement' && a.id === id)!.balance;

    // Month-over-month delta = that month's contribution (growth rates are 0).
    const preDeltaA = retBal(RAISE_IDX - 1, 'ret-a') - retBal(RAISE_IDX - 2, 'ret-a');
    const postDeltaA = retBal(RAISE_IDX + 1, 'ret-a') - retBal(RAISE_IDX, 'ret-a');
    expect(preDeltaA).toBeCloseTo(MONTHLY_GROSS * 0.05, 0);
    expect(postDeltaA).toBeCloseTo(MONTHLY_GROSS * 0.05 * 1.10, 0);

    const preDeltaB = retBal(RAISE_IDX - 1, 'ret-b') - retBal(RAISE_IDX - 2, 'ret-b');
    const postDeltaB = retBal(RAISE_IDX + 1, 'ret-b') - retBal(RAISE_IDX, 'ret-b');
    expect(preDeltaB).toBeCloseTo(300, 0);
    expect(postDeltaB).toBeCloseTo(300, 0);
  });

  it('a promotion snap scales pct deductions from its effective month', () => {
    anchor();
    const inputs = makeInputs([{ value: 5, mode: 'pct', accountId: 'ret-a' }]);
    inputs.assumptions = {
      ...ASSUMPTIONS,
      incomeGrowthEnabled: false,
      // Annual base = 1200 * 52 = 62400; promote to 2x in Apr 2026 (index 3).
      promotions: [{ id: 'p1', effectiveDate: '2026-04-01', newAnnualSalary: 124800 }],
    };
    const { data } = calculateForecast(inputs);

    expect(data[2].fullMonth401kContrib).toBeCloseTo(MONTHLY_GROSS * 0.05, 0);
    expect(data[3].fullMonth401kContrib).toBeCloseTo(MONTHLY_GROSS * 0.05 * 2, 0);
  });
});
