// RANKED AUTOMATIC EXTRA PAYMENTS — the CARD BLOCK's own rank, read from the profile.
//
// `savings_goals.sort_order` and `car_funds.sort_order` rank the goals against each other. Nothing
// ranked the CARDS, so every caller passed a hardcoded 0 — cards first — and a user could not
// express "this goal matters more than my debt", which is the whole ask. `profiles.cards_sort_order`
// is where that answer lives, and this pins that the forecast's months 1+ actually read it.
//
// Would-fail check: drop the `profile?.cards_sort_order ?? 0` argument at the in-loop
// `computeAutoExtraReserve` and the cards-last expectation below fails while cards-first passes.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { CardProjectionResult } from '@/lib/debt-model-types';
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
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

const goal = (over: GoalRow): GoalRow => ({
  id: 'g-1', user_id: 'u', name: 'Goal', target_amount: 3000, current_amount: 0,
  monthly_contribution: 0, target_date: null, linked_account: null, linked_rule_id: null,
  linked_rule_ids: [], goal_type: 'savings', lump_sum_payments: [],
  contribution_start_date: null, auto_end_contributions: false, auto_end_stamped_rules: [],
  sort_order: 0, auto_extra: false,
  ...over,
});

const SAV = acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 1000 });

/** Longer than any horizon the engine runs — a stub array that runs out reads as a CLEARED card,
 *  which silently removes the card block from the ranking in that month. */
const HORIZON = 600;
const CARD_ID = 'card-1';
const CARD_MIN = 50;
/** A revolving balance far larger than any month's pool, so the card block's CAPACITY can never be
 *  the thing that stops it: whatever it does not take is a decision about RANK, not about need. */
const CARD_BALANCE = 500_000;

/** A month-0 stub carrying a real card block for months 1+ to rank against. Month 0 itself
 *  reserves nothing here (empty `perTarget`), so every diverted dollar below is a later month's
 *  own decision — which is the site under test. */
function cardProjection(): CardProjectionResult {
  const perCard = <T,>(v: T) => new Map([[CARD_ID, Array.from({ length: HORIZON + 1 }, () => v)]]);
  return {
    data: [], simCards: [{ id: CARD_ID, minPayment: CARD_MIN, balance: CARD_BALANCE }],
    allPaymentTotals: [], debtPaymentTotals: [],
    perCardPayments: [], perCardPaymentsScaled: [], paymentLedger: [],
    monthlyRevolvingBalances: perCard(CARD_BALANCE), monthlyBalances: perCard(CARD_BALANCE),
    perCardMinPayments: perCard(CARD_MIN), monthlyCyclingOwed: new Map(),
    monthlyCyclingInterest: new Map(), monthlyInterest: new Map(),
    monthlyCyclingBacklog: new Map(),
    month0: { autoExtraPerTarget: [], chain: { autoExtraReserve: 0 } },
  } as unknown as CardProjectionResult;
}

function makeInputs(goals: GoalRow[], cardsSortOrder: number): ForecastInputs {
  return {
    debts: [], goals, carFunds: [],
    accounts: [acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 20000 }), SAV],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never, cards_sort_order: cardsSortOrder },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: cardProjection(),
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

/** Everything the opted-in run put into savings that the opted-out run did not, by the last month. */
function totalDiverted(cardsSortOrder: number): number {
  anchor();
  const base = calculateForecast(makeInputs([goal({ auto_extra: false })], cardsSortOrder));
  anchor();
  const opted = calculateForecast(makeInputs([goal({ auto_extra: true })], cardsSortOrder));
  const last = opted.data.length - 1;
  return opted.data[last].savingsBalance - base.data[last].savingsBalance;
}

describe('forecast-engine — profiles.cards_sort_order ranks the card block', () => {
  afterEach(() => vi.useRealTimers());

  it('cards FIRST (the default 0) keeps the surplus on the debt', () => {
    // The goal sits at sort_order 0 and the cards at 0 too — and the card block is seated half a
    // rank ahead precisely so that tie resolves in favour of the debt. With a balance this large
    // the cards absorb every deployable dollar and the goal gets nothing.
    expect(totalDiverted(0)).toBeCloseTo(0, 0);
  });

  it('cards LAST lets a goal ranked above them take its share', () => {
    // Same data, same goal, one number different: the user has dragged the card row below it.
    const diverted = totalDiverted(5);
    expect(diverted).toBeGreaterThan(0);
    // Never more than the goal actually needs — the rank decides who is asked first, not how much.
    expect(diverted).toBeLessThanOrEqual(3000 + 0.5);
  });

  it('an absent cards_sort_order behaves exactly like an explicit 0', () => {
    anchor();
    const withColumn = calculateForecast(makeInputs([goal({ auto_extra: true })], 0));
    anchor();
    const inputs = makeInputs([goal({ auto_extra: true })], 0);
    delete (inputs.profile as Record<string, unknown>).cards_sort_order;
    const without = calculateForecast(inputs);

    expect(without.data.map(r => r.endingCash)).toEqual(withColumn.data.map(r => r.endingCash));
    expect(without.data.map(r => r.savingsBalance)).toEqual(withColumn.data.map(r => r.savingsBalance));
  });
});
