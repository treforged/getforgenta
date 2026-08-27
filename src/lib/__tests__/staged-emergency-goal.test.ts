// A STAGED EMERGENCY GOAL — one goal, two thresholds, one balance.
//
// Tre, 2026-08-26: fill the move fund, then three months of expenses, then STOP and throw
// everything at the cards, then come back for months four to six.
//
// This is money math on a live balance, so what is pinned here is the DECISION at each step rather
// than one end-to-end total:
//   (a) what a month of essential cost is, one rule source at a time (`isEssentialExpenseRule`);
//   (b) where the two thresholds land, measured upwards from `target_amount` (`goalStages`);
//   (c) which one the goal is chasing right now (`stagedTargetFor`), including the hand-off;
//   (d) the engine actually stopping at stage 1 while a card owes revolving, and RESUMING at
//       stage 2 the month that debt clears.
//
// Would-fail check for (d): force `stagedTail` to 0 where `autoExtraCapacity` is seeded in
// `forecast-engine.ts`, or delete the `revBalTotal <= 0` unlock above the month's reserve, and the
// reopening test funds $3,000 instead of $5,000.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  goalStages, stagedTargetFor, goalRemainingNeed, revolvingRemainingOf,
  type GoalStageContext, type RankableGoal,
} from '../ranked-extra-payment-targets';
import {
  computeEssentialMonthlyExpenses, isEssentialExpenseRule, type EssentialRule,
} from '../essential-monthly-expenses';
import { buildSurplusRankRows } from '../surplus-ranking';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { CardProjectionResult, Month0Result } from '@/lib/debt-model-types';
import type { CarFund } from '../types';
import type { Tables } from '@/integrations/supabase/types';

// ── (a) WHAT COUNTS AS A MONTH OF KEEPING THE LIGHTS ON ──────────────────────

describe('isEssentialExpenseRule — one payment source at a time', () => {
  const CARDS = new Set(['card-1', 'account:card-1']);
  const CHK = 'chk-1';
  const rule = (over: Partial<EssentialRule> = {}): EssentialRule =>
    ({ active: true, rule_type: 'expense', amount: 100, frequency: 'monthly', ...over });

  it('counts a rule with NO source — every other reader treats that as the funding account', () => {
    expect(isEssentialExpenseRule(rule(), CARDS, CHK)).toBe(true);
  });

  it('counts a rule paid from the funding account, bare or `account:`-prefixed', () => {
    expect(isEssentialExpenseRule(rule({ payment_source: CHK }), CARDS, CHK)).toBe(true);
    expect(isEssentialExpenseRule(rule({ payment_source: `account:${CHK}` }), CARDS, CHK)).toBe(true);
  });

  it('COUNTS a rule charged to a credit card — the card is how it is paid, not a reason it is '
    + 'optional. This is the ~$700/mo `baseExpenses` misses on Tre\'s own rows', () => {
    expect(isEssentialExpenseRule(rule({ payment_source: 'card-1' }), CARDS, CHK)).toBe(true);
    expect(isEssentialExpenseRule(rule({ payment_source: 'account:card-1' }), CARDS, CHK)).toBe(true);
  });

  it('EXCLUDES a rule paid from another bank account — no cash impact, same as the month drawer', () => {
    expect(isEssentialExpenseRule(rule({ payment_source: 'biz-1' }), CARDS, CHK)).toBe(false);
    expect(isEssentialExpenseRule(rule({ payment_source: 'account:biz-1' }), CARDS, CHK)).toBe(false);
  });

  it('excludes an inactive rule and anything that is not an expense', () => {
    expect(isEssentialExpenseRule(rule({ active: false }), CARDS, CHK)).toBe(false);
    expect(isEssentialExpenseRule(rule({ rule_type: 'income' }), CARDS, CHK)).toBe(false);
  });

  it('with NO funding account, excludes nothing — over-reporting a runway is the safe error', () => {
    expect(isEssentialExpenseRule(rule({ payment_source: 'biz-1' }), CARDS, null)).toBe(true);
  });
});

describe('computeEssentialMonthlyExpenses', () => {
  const accounts = [
    { id: 'chk-1', account_type: 'checking', active: true },
    { id: 'card-1', account_type: 'credit_card', active: true },
    { id: 'biz-1', account_type: 'checking', active: true },
  ];
  const rule = (amount: number, payment_source: string | null): EssentialRule =>
    ({ active: true, rule_type: 'expense', amount, frequency: 'monthly', due_day: 1, payment_source });

  it('sums checking-paid and card-charged rules and drops the business account', () => {
    const monthly = computeEssentialMonthlyExpenses({
      rules: [rule(1_200, null), rule(300, 'account:card-1'), rule(100, 'account:biz-1')],
      accounts, carFunds: [], fundingAccountId: 'chk-1',
      asOf: new Date('2026-09-15T12:00:00'),
    });
    expect(monthly).toBe(1_500);
  });

  it('returns 0 when there is nothing to measure, rather than a guess', () => {
    expect(computeEssentialMonthlyExpenses({
      rules: [], accounts, carFunds: [], fundingAccountId: 'chk-1',
    })).toBe(0);
  });

  it('averages the window, so a weekly rule is not whichever of 4 or 5 the calendar produced', () => {
    // 52 weeks over 12 months is 4.333 occurrences a month, which no single month ever shows.
    const monthly = computeEssentialMonthlyExpenses({
      rules: [{ active: true, rule_type: 'expense', amount: 100, frequency: 'weekly', due_day: 1,
        start_date: '2026-01-01' }],
      accounts, carFunds: [], fundingAccountId: 'chk-1',
      asOf: new Date('2026-09-15T12:00:00'), months: 12,
    });
    expect(monthly).toBeGreaterThan(4 * 100);
    expect(monthly).toBeLessThan(5 * 100);
  });

  it('includes the vehicle loan payment and its insurance — both are cash out and neither is a rule', () => {
    const carFunds = [{
      id: 'cf-1', phase: 'loan', monthly_insurance: 173,
      insurance_start_date: '2026-01-01',
      loan_start_date: '2026-01-01', payment_start_date: '2026-01-01',
      loan_amount: 20_000, expected_apr: 6, loan_term_months: 60,
      actual_monthly_payment: 423, lump_sum_payments: [],
    } as unknown as CarFund];
    const withCar = computeEssentialMonthlyExpenses({
      rules: [rule(1_000, null)], accounts, carFunds, fundingAccountId: 'chk-1',
      asOf: new Date('2026-09-15T12:00:00'), months: 1,
    });
    const withoutCar = computeEssentialMonthlyExpenses({
      rules: [rule(1_000, null)], accounts, carFunds: [], fundingAccountId: 'chk-1',
      asOf: new Date('2026-09-15T12:00:00'), months: 1,
    });
    expect(withCar - withoutCar).toBeCloseTo(423 + 173, 2);
  });
});

// ── (b) AND (c) THE TWO THRESHOLDS, AND WHICH ONE IS BEING CHASED ────────────

const staged = (over: Partial<RankableGoal> = {}): RankableGoal => ({
  id: 'g-1', target_amount: 5_730, current_amount: 0, auto_extra: true, sort_order: 0,
  emergency_months_stage1: 3, emergency_months_stage2: 6, ...over,
});

describe('goalStages — measured UPWARDS from target_amount', () => {
  it("puts stage 1 at base + 3E and stage 2 at base + 6E, so the move fund is not cannibalised", () => {
    const s = goalStages(staged(), 1_000);
    expect(s).toEqual({ staged: true, stage1: 8_730, stage2: 11_730 });
  });

  it('is NOT staged when the goal has no stage 1 — every ordinary goal, and the whole opt-out', () => {
    expect(goalStages(staged({ emergency_months_stage1: null }), 1_000))
      .toEqual({ staged: false, stage1: 5_730, stage2: 5_730 });
  });

  it('is NOT staged when there is no expense figure to multiply — a target nobody derived is not '
    + 'a target this app will move money against', () => {
    expect(goalStages(staged(), 0).staged).toBe(false);
    expect(goalStages(staged(), Number.NaN).staged).toBe(false);
  });

  it('collapses stage 2 onto stage 1 when only stage 1 is set — "and then stop"', () => {
    const s = goalStages(staged({ emergency_months_stage2: null }), 1_000);
    expect(s).toEqual({ staged: true, stage1: 8_730, stage2: 8_730 });
  });

  it('never lets stage 2 sit BELOW stage 1, whatever is stored', () => {
    const s = goalStages(staged({ emergency_months_stage1: 6, emergency_months_stage2: 3 }), 1_000);
    expect(s.stage2).toBe(s.stage1);
  });
});

describe('stagedTargetFor — the hand-off to the cards', () => {
  const ctx = (revolvingRemaining: number): GoalStageContext =>
    ({ essentialMonthlyExpenses: 1_000, revolvingRemaining });

  it('chases stage 1 while it is still short, cards or no cards', () => {
    expect(stagedTargetFor(staged({ current_amount: 6_000 }), ctx(9_999))).toBe(8_730);
    expect(stagedTargetFor(staged({ current_amount: 6_000 }), ctx(0))).toBe(8_730);
  });

  it('HOLDS at stage 1 once it is reached while any revolving balance remains — capacity 0, which '
    + 'is already how a rank yields its dollars to the next one', () => {
    const g = staged({ current_amount: 8_730 });
    expect(stagedTargetFor(g, ctx(1))).toBe(8_730);
    expect(goalRemainingNeed(g, ctx(1))).toBe(0);
  });

  it('opens stage 2 the moment revolving debt is gone', () => {
    const g = staged({ current_amount: 8_730 });
    expect(stagedTargetFor(g, ctx(0))).toBe(11_730);
    expect(goalRemainingNeed(g, ctx(0))).toBe(3_000);
  });

  it('reports the BASE target with no context at all — a caller that cannot size the stages must '
    + 'not offer capacity it cannot explain', () => {
    expect(goalRemainingNeed(staged())).toBe(5_730);
  });
});

describe('revolvingRemainingOf', () => {
  it('sums positive balances and ignores a card on autopay-in-full', () => {
    expect(revolvingRemainingOf([
      { balance: 1_000 }, { balance: 500 },
      { balance: 900, autopayFullBalance: true },
      { balance: 0 }, { balance: -20 }, { balance: null },
    ])).toBe(1_500);
  });
});

// ── THE RANKED LIST AGREES WITH THE ENGINE ───────────────────────────────────

describe('buildSurplusRankRows — a staged goal shows the stage it is actually chasing', () => {
  const goalRowFor = (over: Partial<RankableGoal> = {}) =>
    ({ ...staged(over), name: 'Move fund, then emergency fund', created_at: '2026-01-01' });

  /** The list always carries the card BLOCK row too, so the goal is looked up rather than indexed. */
  const goalRow1 = (p: Parameters<typeof buildSurplusRankRows>[0]) =>
    buildSurplusRankRows(p).find(r => r.id === 'g-1')!;

  it('shows stage 1 remaining, not the base target, once expenses are known', () => {
    expect(goalRow1({
      goals: [goalRowFor()], carFunds: [], essentialMonthlyExpenses: 1_000,
    }).remaining).toBe(8_730);
  });

  it('shows ZERO remaining while the cards still owe — the same hold the engine applies', () => {
    expect(goalRow1({
      goals: [goalRowFor({ current_amount: 8_730 })],
      carFunds: [], cards: [{ id: 'card-1', balance: 2_000 }],
      essentialMonthlyExpenses: 1_000,
    }).remaining).toBe(0);
  });

  it('reopens to stage 2 once the cards are clear', () => {
    expect(goalRow1({
      goals: [goalRowFor({ current_amount: 8_730 })],
      carFunds: [], cards: [{ id: 'card-1', balance: 0 }],
      essentialMonthlyExpenses: 1_000,
    }).remaining).toBe(3_000);
  });

  it('is byte-identical to the old list for an UNSTAGED goal', () => {
    expect(goalRow1({
      goals: [goalRowFor({ emergency_months_stage1: null, emergency_months_stage2: null })],
      carFunds: [], essentialMonthlyExpenses: 1_000,
    }).remaining).toBe(5_730);
  });
});

// ── (d) THE ENGINE: STOP AT STAGE 1, RESUME AT STAGE 2 ───────────────────────

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

const goalRow = (over: GoalRow): GoalRow => ({
  id: 'g-1', user_id: 'u', name: 'Move fund, then emergency fund',
  target_amount: 2_000, current_amount: 0,
  monthly_contribution: 0, target_date: null, linked_account: null, linked_rule_id: null,
  linked_rule_ids: [], goal_type: 'savings', lump_sum_payments: [],
  contribution_start_date: null, auto_end_contributions: false, auto_end_stamped_rules: [],
  sort_order: 0, auto_extra: true,
  ...over,
});

/**
 * One $1,000/month expense rule paid from checking, so the engine's own
 * `computeEssentialMonthlyExpenses` lands on exactly $1,000 and the thresholds below are readable:
 * base 2,000 + 1×E = stage 1 of 3,000; + 3×E = stage 2 of 5,000.
 */
const RULES = [{
  id: 'r-1', user_id: 'u', active: true, rule_type: 'expense', name: 'Bills',
  amount: 1_000, frequency: 'monthly', due_day: 1, category: 'Bills',
  payment_source: null, start_date: null, end_date: null,
}] as unknown as ForecastInputs['rules'];

/**
 * Month-0 stub carrying only what step 4c-ii reads, plus the revolving schedule the stage gate
 * consults. `revolvingByMonth` is what makes this test possible at all: the engine reads
 * `cardProjectionData.monthlyRevolvingBalances`, so a fixture can say exactly when the cards clear.
 */
function cardProjection(
  perTarget: Month0Result['autoExtraPerTarget'],
  revolvingByMonth: number[] = [],
): CardProjectionResult {
  const reserved = Math.round(perTarget.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  const hasCard = revolvingByMonth.length > 0;
  return {
    data: [],
    simCards: hasCard
      ? [{ id: 'visa', name: 'Visa', balance: revolvingByMonth[0], minPayment: 0, apr: 0 }]
      : [],
    allPaymentTotals: [], debtPaymentTotals: [],
    perCardPayments: [], perCardPaymentsScaled: [], paymentLedger: [],
    monthlyRevolvingBalances: hasCard ? new Map([['visa', revolvingByMonth]]) : new Map(),
    monthlyBalances: new Map(),
    perCardMinPayments: new Map(), monthlyCyclingOwed: new Map(),
    monthlyCyclingInterest: new Map(), monthlyInterest: new Map(),
    monthlyCyclingBacklog: new Map(),
    month0: { autoExtraPerTarget: perTarget, chain: { autoExtraReserve: reserved } },
  } as unknown as CardProjectionResult;
}

function makeInputs(goals: GoalRow[], revolvingByMonth: number[] = []): ForecastInputs {
  return {
    debts: [], goals, carFunds: [],
    accounts: [
      acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 200_000 }),
      acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 1_000 }),
    ],
    budgetItems: [],
    // ⚠️ `cards_sort_order` 5 puts the goal (sort_order 0) ABOVE the card block, which is the
    // arrangement the whole feature is about: the goal fills stage 1 FIRST and then hands the
    // dollars down to the cards. Left at the default 0 the cards win the tie, take everything, and
    // the goal is never funded at all — which looks like the stage gate working and is not.
    profile: { tax_rate: 0, paycheck_deductions: [] as never, cards_sort_order: 5 },
    assumptions: ASSUMPTIONS,
    rules: RULES,
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: cardProjection([], revolvingByMonth),
    // Real income, because the essential-expense rule above is real cash out: a fixture with a
    // $1,000 bill and no paycheck has no surplus at all, and every assertion below would pass for
    // the wrong reason.
    payConfig: { weeklyGross: 5_000, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
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

const STAGED_GOAL: GoalRow = {
  emergency_months_stage1: 1, emergency_months_stage2: 3,
} as GoalRow;

describe('forecast-engine — a staged goal stops at stage 1 and resumes at stage 2', () => {
  afterEach(() => vi.useRealTimers());

  const totalFor = (rows: ReturnType<typeof calculateForecast>['data'], id: string) =>
    rows.reduce((s, r) => s + Number(r.autoExtraByTarget?.[id] ?? 0), 0);

  it('funds ONLY stage 1 while the cards still owe revolving — the hand-off Tre asked for', () => {
    anchor();
    // Revolving never clears across the horizon, so stage 2 never opens.
    const rows = calculateForecast(
      makeInputs([goalRow(STAGED_GOAL)], new Array(120).fill(5_000)),
    ).data;
    expect(totalFor(rows, 'g-1')).toBeCloseTo(3_000, 2);
  });

  it('resumes to stage 2 once revolving debt is gone, and stops there', () => {
    anchor();
    // Cards clear at month 6.
    const revolving = new Array(120).fill(0).map((_, i) => (i < 6 ? 5_000 : 0));
    const rows = calculateForecast(makeInputs([goalRow(STAGED_GOAL)], revolving)).data;
    expect(totalFor(rows, 'g-1')).toBeCloseTo(5_000, 2);
    // Nothing beyond stage 1 arrives before the debt clears.
    const beforeClear = rows.slice(0, 6)
      .reduce((s, r) => s + Number(r.autoExtraByTarget?.['g-1'] ?? 0), 0);
    expect(beforeClear).toBeLessThanOrEqual(3_000 + 0.005);
  });

  it('never over-funds past stage 2, whatever the month-by-month split', () => {
    anchor();
    const revolving = new Array(120).fill(0).map((_, i) => (i < 3 ? 5_000 : 0));
    const rows = calculateForecast(makeInputs([goalRow(STAGED_GOAL)], revolving)).data;
    expect(totalFor(rows, 'g-1')).toBeLessThanOrEqual(5_000 + 0.005);
  });

  it('leaves an UNSTAGED goal exactly as it was — the whole feature is opt-in', () => {
    anchor();
    const rows = calculateForecast(
      makeInputs([goalRow({})], new Array(120).fill(5_000)),
    ).data;
    expect(totalFor(rows, 'g-1')).toBeCloseTo(2_000, 2);
  });
});
