// RANKED AUTOMATIC EXTRA PAYMENTS — the diversion, in EVERY month, not just month 0.
//
// Until this landed the forecast modelled the reserve only at month 0: `useCardProjection`'s
// converged chain decided one month's diversion and the remaining months of the horizon carried
// on spending the user's surplus on credit cards. That made an opted-in user's projected payoff
// date OPTIMISTIC — the app was showing a plan it was not itself following.
//
// Months 1+ now decide their own reserve, in-loop, against a running remaining-need per target.
// The subtraction lands on `cashPreDebt`, which is what makes it real: `finalLiquid` falls by the
// reserve, so step 3's surplus branch feeds a correspondingly smaller revolving target back
// through convergence.
//
// Would-fail check: restore `i === 0 ? … : []` on the reserve and the four multi-month
// expectations below fail while month 0 keeps working — which is exactly the gap this pins shut.

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

/** A month-0 stub carrying only what the cash side and step 4c-ii read. Everything else is absent
 *  on purpose — captured fixtures predate half of it and the engine reads all of it defensively.
 *  With no sim cards, months 1+ see a zero card block: no minimums to protect, no balance to pay,
 *  so the whole surplus above the floor is rankable and the diversion is visible in isolation. */
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

function makeInputs(
  goals: GoalRow[],
  perTarget: Month0Result['autoExtraPerTarget'],
  checking = 20000,
): ForecastInputs {
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

describe('forecast-engine — the ranked reserve is modelled in every month, not only month 0', () => {
  afterEach(() => vi.useRealTimers());

  it('an OPTED-OUT goal is byte-identical to no goal at all, in every month', () => {
    anchor();
    const none = calculateForecast(makeInputs([], []));
    anchor();
    const optedOut = calculateForecast(makeInputs([goal({ auto_extra: false, target_amount: 3000 })], []));

    expect(optedOut.data.map((r) => r.endingCash)).toEqual(none.data.map((r) => r.endingCash));
    expect(optedOut.data.map((r) => r.savingsBalance)).toEqual(none.data.map((r) => r.savingsBalance));
  });

  it('an OPTED-IN goal keeps taking its share after month 0, until its need is met', () => {
    anchor();
    // Checking is deliberately smaller than the goal's need, so no single month can fill it and
    // the diversion HAS to span months to be visible at all.
    const base = calculateForecast(makeInputs([goal({ auto_extra: false, target_amount: 3000 })], [], 1500));
    anchor();
    const opted = calculateForecast(makeInputs([goal({ auto_extra: true, target_amount: 3000 })], [], 1500));

    const savingsGain = (i: number) => opted.data[i].savingsBalance - base.data[i].savingsBalance;
    // Month 0 has no stub reserve here, so every dollar below is a LATER month's decision.
    expect(savingsGain(0)).toBeCloseTo(0, 2);
    expect(savingsGain(1)).toBeGreaterThan(0);
    // Monotonic: a later month never gives the money back.
    for (let i = 1; i < opted.data.length; i++) {
      expect(savingsGain(i), `month ${i} never reverses`).toBeGreaterThanOrEqual(savingsGain(i - 1) - 0.01);
    }
  });

  it('conserves the money in EVERY month — nothing appears, nothing evaporates', () => {
    anchor();
    const base = calculateForecast(makeInputs([goal({ auto_extra: false, target_amount: 3000 })], [], 1500));
    anchor();
    const opted = calculateForecast(makeInputs([goal({ auto_extra: true, target_amount: 3000 })], [], 1500));

    for (const [i, row] of opted.data.entries()) {
      const cashDelta = row.endingCash - base.data[i].endingCash;
      const savingsDelta = row.savingsBalance - base.data[i].savingsBalance;
      expect(cashDelta + savingsDelta, `month ${i} conserved`).toBeCloseTo(0, 0);
      expect(cashDelta, `month ${i} cash never rises`).toBeLessThanOrEqual(0.5);
      expect(row.endingCash, `month ${i} cash never goes negative`).toBeGreaterThanOrEqual(-0.5);
    }
  });

  it('never diverts more than the goal actually needs, across the whole horizon', () => {
    anchor();
    const base = calculateForecast(makeInputs([goal({ auto_extra: false, target_amount: 1200 })], []));
    anchor();
    // Plenty of cash and a small need: the cap has to come from the goal, not from the wallet.
    const opted = calculateForecast(makeInputs([goal({ auto_extra: true, target_amount: 1200 })], []));

    const last = opted.data.length - 1;
    const totalDiverted = opted.data[last].savingsBalance - base.data[last].savingsBalance;
    expect(totalDiverted).toBeCloseTo(1200, 0);
  });

  it('counts the goal OWN monthly contribution against the same need, so it is never over-funded', () => {
    anchor();
    const base = calculateForecast(makeInputs(
      [goal({ auto_extra: false, target_amount: 1200, monthly_contribution: 300 })], []));
    anchor();
    const opted = calculateForecast(makeInputs(
      [goal({ auto_extra: true, target_amount: 1200, monthly_contribution: 300 })], []));

    const last = opted.data.length - 1;
    const totalDiverted = opted.data[last].savingsBalance - base.data[last].savingsBalance;
    // The contributions already fill part of the 1200; the reserve may only take the rest.
    expect(totalDiverted).toBeGreaterThan(0);
    // STRICTLY less than the full need: the contributions filled part of it, and the reserve is
    // only ever allowed the rest. (The goal's own contributions can still overshoot the target on
    // their own — the opted-OUT pool ends at 1500 against a 1200 target here — which is the
    // existing contribution-cutoff granularity, unchanged by and unrelated to the reserve.)
    expect(totalDiverted).toBeLessThan(1200);
  });
});
