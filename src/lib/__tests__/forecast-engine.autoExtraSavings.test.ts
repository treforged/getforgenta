// RANKED AUTOMATIC EXTRA PAYMENTS — the savings side of the month-0 reserve.
//
// `useCardProjection`'s month 0 already moves cash OUT of checking for an opted-in goal or car
// fund (`Month0CashChain.autoExtraReserve`). Until this landed, nothing put those dollars INTO
// anything: the forecast grew savings only from `monthly_contribution`, transfers and lump sums,
// so an opted-in user's money simply evaporated — strictly worse than not shipping the feature.
//
// Would-fail check: delete step 4c-ii in forecast-engine.ts and every "savings grew" expectation
// below fails while the cash side still drops, which is exactly the evaporation this pins shut.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { CardProjectionResult, Month0Result } from '@/lib/debt-model-types';
import type { Tables } from '@/integrations/supabase/types';

type GoalRow = Partial<Tables<'savings_goals'>>;

const acct = (over: Record<string, unknown>): AccountRow =>
  ({
    id: 'x', name: 'x', account_type: 'checking', balance: 0, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
    ...over,
  } as unknown as AccountRow);

const ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  // Zero growth everywhere so a balance difference can only be a real transfer, never interest.
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

const goal = (over: GoalRow): GoalRow => ({
  id: 'g-1', user_id: 'u', name: 'Goal', target_amount: 10000, current_amount: 0,
  monthly_contribution: 0, target_date: null, linked_account: null, linked_rule_id: null,
  linked_rule_ids: [], goal_type: 'savings', lump_sum_payments: [],
  contribution_start_date: null, auto_end_contributions: false, auto_end_stamped_rules: [],
  sort_order: 0, auto_extra: false,
  ...over,
});

const CHK = acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 20000 });
const SAV = acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 1000 });

/** A month-0 stub carrying only what step 4c-ii and the cash side read. Everything else the
 *  forecast pulls off `cardProjectionData` is absent on purpose — captured fixtures predate half
 *  of it, and the engine already reads all of it defensively. */
function cardProjection(perTarget: Month0Result['autoExtraPerTarget']): CardProjectionResult {
  const reserved = Math.round(perTarget.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  return {
    data: [], simCards: [], allPaymentTotals: [], debtPaymentTotals: [],
    perCardPayments: [], perCardPaymentsScaled: [], paymentLedger: [],
    monthlyRevolvingBalances: new Map(), monthlyBalances: new Map(),
    perCardMinPayments: new Map(), monthlyCyclingOwed: new Map(),
    monthlyCyclingInterest: new Map(), monthlyInterest: new Map(),
    monthlyCyclingBacklog: new Map(),
    month0: { autoExtraPerTarget: perTarget, chain: { autoExtraReserve: reserved } },
  } as unknown as CardProjectionResult;
}

function makeInputs(goals: GoalRow[], perTarget: Month0Result['autoExtraPerTarget']): ForecastInputs {
  return {
    debts: [], goals, carFunds: [],
    accounts: [CHK, SAV],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: cardProjection(perTarget),
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

const RESERVE = 400;

describe('forecast-engine — ranked automatic extra payments reach the savings side', () => {
  afterEach(() => vi.useRealTimers());

  it('is byte-identical when nothing is opted in', () => {
    anchor();
    const none = calculateForecast(makeInputs([goal({}), goal({ id: 'g-2', linked_account: 'sav-1' })], []));
    anchor();
    const zero = calculateForecast(makeInputs(
      [goal({}), goal({ id: 'g-2', linked_account: 'sav-1' })],
      [{ id: 'g-1', kind: 'goal', amount: 0 }],
    ));
    expect(zero.data).toEqual(none.data);
  });

  it('credits a LINKED goal into its own savings account, and takes the cash out of checking', () => {
    anchor();
    const base = calculateForecast(makeInputs([goal({ id: 'g-2', linked_account: 'sav-1' })], []));
    anchor();
    const opted = calculateForecast(makeInputs(
      [goal({ id: 'g-2', linked_account: 'sav-1' })],
      [{ id: 'g-2', kind: 'goal', amount: RESERVE }],
    ));

    expect(opted.data[0].savingsBalance - base.data[0].savingsBalance).toBeCloseTo(RESERVE, 2);
    expect(opted.data[0].endingCash - base.data[0].endingCash).toBeCloseTo(-RESERVE, 2);

    // The named account moved, not some anonymous pool.
    const savOf = (r: typeof base.data[number]) =>
      r.assetBreakdown.find((a) => a.id === 'sav-1')?.balance ?? 0;
    expect(savOf(opted.data[0]) - savOf(base.data[0])).toBeCloseTo(RESERVE, 2);
  });

  it('credits an UNLINKED goal into its own pool', () => {
    anchor();
    const base = calculateForecast(makeInputs([goal({})], []));
    anchor();
    const opted = calculateForecast(makeInputs([goal({})], [{ id: 'g-1', kind: 'goal', amount: RESERVE }]));

    expect(opted.data[0].savingsBalance - base.data[0].savingsBalance).toBeCloseTo(RESERVE, 2);
    const poolOf = (r: typeof base.data[number]) =>
      r.assetBreakdown.find((a) => a.id === 'g-1')?.balance ?? 0;
    expect(poolOf(opted.data[0]) - poolOf(base.data[0])).toBeCloseTo(RESERVE, 2);
  });

  it('conserves the money — nothing appears, nothing evaporates, in month 0 and every month after', () => {
    anchor();
    const base = calculateForecast(makeInputs([goal({})], []));
    anchor();
    const opted = calculateForecast(makeInputs([goal({})], [{ id: 'g-1', kind: 'goal', amount: RESERVE }]));

    for (const [i, row] of opted.data.entries()) {
      const cashDelta = row.endingCash - base.data[i].endingCash;
      const savingsDelta = row.savingsBalance - base.data[i].savingsBalance;
      // The reserve is a MOVE: whatever cash lost, savings gained, for the whole horizon.
      expect(cashDelta + savingsDelta, `month ${i} conserved`).toBeCloseTo(0, 0);
      expect(cashDelta, `month ${i} cash never rises`).toBeLessThanOrEqual(0.5);
    }
  });

  it('only ever takes the reserve ONCE — month 0, never compounding month after month', () => {
    anchor();
    const base = calculateForecast(makeInputs([goal({})], []));
    anchor();
    const opted = calculateForecast(makeInputs([goal({})], [{ id: 'g-1', kind: 'goal', amount: RESERVE }]));

    for (const [i, row] of opted.data.entries()) {
      expect(row.savingsBalance - base.data[i].savingsBalance, `month ${i}`).toBeCloseTo(RESERVE, 0);
    }
  });
});
