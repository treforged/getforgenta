// AUTO EXTRA → the Goals page's Savings Growth chart.
//
// Tre, 2026-08-20: "Auto Extra doesnt seem to affect anything yet. at least the chart on the goals
// tab doesnt change at all." He was right, and it was a wiring gap rather than a misunderstanding:
// `GrowthGoalInput` had no field for the ranked extra at all, so `SavingsGrowthChart` could not
// respond to `auto_extra` under any value while the engine itself worked fine.
//
// The chart now READS the engine's own per-month diversion (`ForecastMonthRow.autoExtraByTarget`)
// instead of modelling a second one. That direction is the whole point: a flat "extra monthly
// contribution" would drift from the Forecast as cards retire and goals fill, which is the §2.5
// disagreement class this codebase has already paid to fix once.
//
// Would-fail check: drop `extraByMonth` from `stepMonth` and the two "moves the line" expectations
// fail while every zero-extra expectation keeps passing — which is exactly the gap this pins shut.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs, type ForecastMonthRow } from '@/lib/forecast-engine';
import { buildAutoExtraByTarget } from '@/lib/auto-extra-projection';
import {
  buildSavingsGrowthData, estimateGoalCompletionMonths, type GrowthGoalInput,
} from '@/lib/savings-growth';
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
  // Zero growth everywhere, so a balance difference can only ever be a real transfer.
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

const SAV = acct({ id: 'sav-1', name: 'Savings', account_type: 'savings', balance: 1000 });

/** Month-0 stub carrying only what the cash side and step 4c-ii read; see the multi-month test. */
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

function makeInputs(goals: GoalRow[], checking = 1500): ForecastInputs {
  return {
    debts: [], goals, carFunds: [],
    accounts: [acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: checking }), SAV],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: cardProjection([]),
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

const TODAY = new Date('2026-10-15T12:00:00');

const growthGoal = (over: Partial<GrowthGoalInput> = {}): GrowthGoalInput => ({
  id: 'g-1', name: 'Goal', currentAmount: 0, monthlyContribution: 100,
  annualApyPercent: 4.5, contributionStartDate: null, lumpSums: [], targetAmount: 10000,
  ...over,
});

describe('forecast-engine — the ranked reserve is EMITTED per target, not just spent', () => {
  afterEach(() => vi.useRealTimers());

  it('emits nothing at all for an opted-OUT goal', () => {
    anchor();
    const out = calculateForecast(makeInputs([goal({ auto_extra: false, target_amount: 3000 })]));
    for (const [i, row] of out.data.entries()) {
      expect(row.autoExtraByTarget, `month ${i}`).toEqual({});
    }
  });

  it('emits, for an opted-IN goal, exactly the dollars the savings balance gained that month', () => {
    anchor();
    const base = calculateForecast(makeInputs([goal({ auto_extra: false, target_amount: 3000 })]));
    anchor();
    const opted = calculateForecast(makeInputs([goal({ auto_extra: true, target_amount: 3000 })]));

    const emitted = opted.data.map(r => r.autoExtraByTarget['g-1'] ?? 0);
    expect(emitted.some(v => v > 0), 'something is actually diverted').toBe(true);

    // The emitted figure is the SAME money step 4c-ii credits, not a parallel number: each
    // month's emission must equal that month's extra gain in the savings balance.
    for (let i = 1; i < opted.data.length; i++) {
      const gain = (opted.data[i].savingsBalance - base.data[i].savingsBalance)
        - (opted.data[i - 1].savingsBalance - base.data[i - 1].savingsBalance);
      expect(gain, `month ${i} emission matches the credit`).toBeCloseTo(emitted[i], 0);
    }
  });
});

describe('buildAutoExtraByTarget', () => {
  const rows = (perMonth: Record<string, number>[]) =>
    perMonth.map(m => ({ autoExtraByTarget: m }) as unknown as ForecastMonthRow);

  it('re-keys the rows into one full-length array per target', () => {
    const byTarget = buildAutoExtraByTarget(rows([{}, { a: 10 }, { a: 5, b: 2 }]));
    expect(byTarget.get('a')).toEqual([0, 10, 5]);
    expect(byTarget.get('b')).toEqual([0, 0, 2]);
  });

  it('omits targets that never take anything, so "no entry" and "all zeros" agree', () => {
    const byTarget = buildAutoExtraByTarget(rows([{ a: 0 }, { a: 0 }]));
    expect(byTarget.has('a')).toBe(false);
    expect(buildAutoExtraByTarget([]).size).toBe(0);
  });

  it('ignores a non-finite amount rather than poisoning the whole line with NaN', () => {
    const byTarget = buildAutoExtraByTarget(rows([{ a: Number.NaN }, { a: 4 }]));
    expect(byTarget.get('a')).toEqual([0, 4]);
  });
});

describe('savings-growth — extraByMonth', () => {
  // THE SAFETY PROPERTY. Every one of Tre's goals is opted OUT today, so every extraByMonth is
  // zeros and the chart he is looking at must not move by a cent.
  it('is byte-identical to omitting it when every month is zero', () => {
    const without = buildSavingsGrowthData([growthGoal()], { today: TODAY });
    const zeros = buildSavingsGrowthData(
      [growthGoal({ extraByMonth: new Array(60).fill(0) })], { today: TODAY },
    );
    expect(zeros).toEqual(without);
    expect(
      estimateGoalCompletionMonths(growthGoal({ extraByMonth: new Array(60).fill(0) }), 10000, { today: TODAY }),
    ).toBe(estimateGoalCompletionMonths(growthGoal(), 10000, { today: TODAY }));
  });

  it('raises the projected balance by the extra, month for month', () => {
    const extra = new Array(60).fill(0);
    extra[1] = 500;
    const base = buildSavingsGrowthData([growthGoal({ annualApyPercent: 0 })], { today: TODAY });
    const withExtra = buildSavingsGrowthData(
      [growthGoal({ annualApyPercent: 0, extraByMonth: extra })], { today: TODAY },
    );
    // Zero APY, so the gap is the extra itself and stays exactly that from month 1 onward.
    expect(Number(base.rows[0].s0)).toBe(Number(withExtra.rows[0].s0));
    for (let i = 1; i < base.rows.length; i++) {
      expect(Number(withExtra.rows[i].s0) - Number(base.rows[i].s0), `month ${i}`).toBeCloseTo(500, 2);
    }
  });

  it('pulls the completion estimate in, because the extra is real money toward the target', () => {
    const flat = growthGoal({ annualApyPercent: 0, monthlyContribution: 100, targetAmount: 1200 });
    const withExtra = { ...flat, extraByMonth: new Array(60).fill(100) };
    const plain = estimateGoalCompletionMonths(flat, 1200, { today: TODAY });
    const boosted = estimateGoalCompletionMonths(withExtra, 1200, { today: TODAY });
    expect(plain).toBe(12);
    expect(boosted).toBe(6);
  });

  it('reaches a target on the extra alone, with no contribution and no interest', () => {
    const idle = growthGoal({ annualApyPercent: 0, monthlyContribution: 0, targetAmount: 300 });
    expect(estimateGoalCompletionMonths(idle, 300, { today: TODAY })).toBeNull();
    expect(
      estimateGoalCompletionMonths({ ...idle, extraByMonth: new Array(12).fill(150) }, 300, { today: TODAY }),
    ).toBe(2);
  });
});
