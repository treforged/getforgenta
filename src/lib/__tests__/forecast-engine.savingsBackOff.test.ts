// GOAL CONTRIBUTIONS ARE NOT UNCONDITIONAL (2026-08-25). Two defects, one term.
//
// PASS 1 summed every goal's `monthly_contribution` with no gate of any kind:
//
//     const monthlySavingsContrib = goals.reduce((s, g) => { ... return s + contrib; }, 0);
//
// 1. `pauseSavings` did nothing to it. The engine already honoured the toggle for car funds
//    (`monthlyCarContrib`, `vehicleProjections`) and the sim zeroes its own `goalContrib` and drops
//    `monthSavings` from every simulated month — so the Debt Payoff page moved and the Forecast's
//    savings line did not. Measured on the real 2026-07-20 capture: toggling `pauseSavings` changed
//    the forecast's total goal contribution by exactly $0.00 across all 36 months.
//
// 2. There was no affordability back-off. A month with nowhere near the cash still "made" its
//    transfers and simply ended under its own floor. Measured on the same capture under an $8,000
//    April shock: Apr 2027 ended $2,232.54 BELOW its floor while still contributing the full $100.
//    The debt payment has always had this back-off (step 3's deficit branch feeds a lower target
//    through convergence until the sim sits on its contract minimums); the savings transfer did not.
//
// WOULD-FAIL CHECK, run 2026-08-25 with the gate and the back-off both reverted: `pauses every goal
// contribution` reports $300 where it expects $0 in all 36 months, and every affordability case
// reports the full $300 in months that end hundreds below their floor.
//
// The floor here is `getAugmentedMinSafeCash`, not the `cashFloor` setting: with the paycheck on
// the 20th and one $2,000 bill on the 5th, each month reserves exactly one of those bills, so the
// yardstick is a flat $2,000 (the same construction forecast-engine.floorBreachReporting uses).
// Income replaces the bill exactly, so the balance is cash-neutral and every dollar of movement in
// these cases is the goal contribution and nothing else.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow, RuleRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { Tables } from '@/integrations/supabase/types';

// Same shape the other forecast-engine tests build goals from (forecast-engine.autoExtraMultiMonth).
type GoalRow = Partial<Tables<'savings_goals'>>;

const ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

const CHK_ID = 'chk-1';
const BILL = 2000;
const FLOOR = BILL;

const checking = (balance: number): AccountRow =>
  ({
    id: CHK_ID, name: 'Checking', account_type: 'checking', balance, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
  } as unknown as AccountRow);

const rules = (): RuleRow[] => ([
  {
    id: 'income-1', name: 'Paycheck', amount: 2000, rule_type: 'income', frequency: 'monthly',
    due_day: 25, payment_source: null, deposit_account: CHK_ID, active: true, category: 'Other',
  },
  {
    id: 'bill-1', name: 'Rent', amount: BILL, rule_type: 'expense', frequency: 'monthly',
    due_day: 5, payment_source: CHK_ID, deposit_account: null, active: true, category: 'Bills',
  },
] as unknown as RuleRow[]);

const goal = (over: GoalRow): GoalRow => ({
  id: 'g-1', user_id: 'u', name: 'Move fund', target_amount: 100000, current_amount: 0,
  monthly_contribution: 0, target_date: null, linked_account: null, linked_rule_id: null,
  linked_rule_ids: [], goal_type: 'savings', lump_sum_payments: [],
  contribution_start_date: null, auto_end_contributions: false, auto_end_stamped_rules: [],
  sort_order: 0, auto_extra: false,
  ...over,
} as unknown as GoalRow);

function makeInputs(balance: number, goals: GoalRow[], pauseSavings = false): ForecastInputs {
  return {
    debts: [], carFunds: [], goals,
    accounts: [checking(balance)],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: rules(),
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 20, frequency: 'monthly' },
    oneTimeByMonth: {}, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
    transactions: [],
    currentMonthRecommendedDebt: null,
    forecastMonthEvents: [],
    forecastFundingAccountId: CHK_ID,
    cashFloor: 0,
    pauseSavings,
    syncCutoffDate: '2026-09-30',
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
  } as unknown as ForecastInputs;
}

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T12:00:00'));
};

describe('forecast-engine — pauseSavings reaches goal contributions', () => {
  afterEach(() => vi.useRealTimers());

  it('pauses every goal contribution, and the goal balance stops growing with it', () => {
    anchor();
    const goals = [goal({ monthly_contribution: 300 })];
    const on = calculateForecast(makeInputs(20000, goals, true));
    anchor();
    const off = calculateForecast(makeInputs(20000, goals, false));

    const total = (r: typeof on) => r.data.reduce((s, row) => s + row.savingsContrib, 0);
    expect(total(off)).toBeGreaterThan(0);
    expect(total(on)).toBe(0);
    // The measured symptom on the real capture was a delta of exactly $0.00 between these two.
    expect(total(off) - total(on)).toBeGreaterThan(0);

    // Paused cash is cash the user still HAS, so the funding account keeps it...
    expect(on.data[0].endingCash).toBeGreaterThan(off.data[0].endingCash);
    // ...and the goal it did not go to must not grow anyway. Two surfaces crediting the same
    // paused dollar is how a projection invents money.
    expect(on.data[0].savingsBalance).toBe(0);
    expect(off.data[0].savingsBalance).toBeGreaterThan(0);
    // The drawer's per-goal rows are the same fact told twice; they must agree with the total.
    expect(on.data[0].savingsGoalItems).toEqual([]);
    expect(off.data[0].savingsGoalItems).toHaveLength(1);
  });

  it('leaves an unpaused forecast untouched', () => {
    anchor();
    const goals = [goal({ monthly_contribution: 300 })];
    const out = calculateForecast(makeInputs(20000, goals, false));
    // Nothing about the gate may change the default path: every month still contributes in full
    // while there is cash to do it with.
    expect(out.data.slice(0, 12).map(r => r.savingsContrib)).toEqual(Array(12).fill(300));
  });
});

describe('forecast-engine — a goal contribution backs off before the floor breaks', () => {
  afterEach(() => vi.useRealTimers());

  it('skips the contribution outright in a month that cannot afford any of it', () => {
    anchor();
    // $1,000 on hand against a $2,000 floor: already short before a single dollar is saved. Month 0
    // is live-anchored (see below) and still contributes; from month 1 on there is nothing to give.
    const out = calculateForecast(makeInputs(1000, [goal({ monthly_contribution: 300 })]));

    expect(out.data[1].savingsContrib).toBe(0);
    expect(out.data[2].savingsContrib).toBe(0);
    expect(out.data[1].savingsGoalItems).toEqual([]);
    // The cash it did not spend stays in checking rather than vanishing.
    expect(out.data[1].endingCash).toBe(out.data[0].endingCash);
  });

  it('tapers to a PARTIAL contribution rather than an all-or-nothing skip', () => {
    anchor();
    // $6,000 on hand, draining $300/mo. The balance walks down to the floor and the last affordable
    // month contributes only what clears it — the proof that this is a cap on the contribution and
    // not a switch. Contributions never take a month below $2,000.
    const out = calculateForecast(makeInputs(6000, [goal({ monthly_contribution: 300 })]));

    const contribs = out.data.map(r => r.savingsContrib);
    const partial = contribs.filter(c => c > 0 && c < 300);
    expect(partial.length, 'exactly one tapering month').toBe(1);
    expect(partial[0]).toBeGreaterThan(0);
    expect(partial[0]).toBeLessThan(300);

    // Full months come first, the taper next, zeros after — never a full month after a skipped one.
    const firstZero = contribs.findIndex(c => c === 0);
    expect(firstZero).toBeGreaterThan(0);
    expect(contribs.slice(firstZero).every(c => c === 0)).toBe(true);

    // And the point of the whole exercise: no month is left under its floor by a savings transfer.
    for (const row of out.data) {
      expect(row.rawEndingCash, `${row.month}`).toBeGreaterThanOrEqual(FLOOR - 0.005);
      expect(row.belowSafeMinimum, `${row.month}`).toBe(false);
    }
  });

  it('never lets the goal balance grow by more than the cash that actually left checking', () => {
    anchor();
    const out = calculateForecast(makeInputs(6000, [goal({ monthly_contribution: 300 })]));
    // Skipped is skipped: with `auto_extra` off there is no catch-up path, so the balance is
    // exactly the sum of what was contributed and never the sum of what was scheduled.
    const contributed = out.data.reduce((s, r) => s + r.savingsContrib, 0);
    const last = out.data[out.data.length - 1];
    expect(last.savingsBalance).toBeCloseTo(contributed, 0);
    expect(contributed).toBeLessThan(300 * out.data.length);
  });

  it('cuts two goals pro rata, not one before the other', () => {
    anchor();
    // Same total, split 200/100. A tapering month must cut both in the same proportion — there is
    // no recorded intent for which goal loses first, so none is invented.
    const out = calculateForecast(makeInputs(6000, [
      goal({ id: 'g-1', name: 'Move fund', monthly_contribution: 200, sort_order: 0 }),
      goal({ id: 'g-2', name: 'Car repair', monthly_contribution: 100, sort_order: 1 }),
    ]));

    const taper = out.data.find(r => r.savingsContrib > 0 && r.savingsContrib < 300);
    expect(taper, 'a tapering month exists').toBeTruthy();
    const items = taper!.savingsGoalItems;
    expect(items).toHaveLength(2);
    const byId = Object.fromEntries(items.map(i => [i.goalId, i.amount]));
    expect(byId['g-1'] + byId['g-2']).toBeCloseTo(taper!.savingsContrib, 6);
    expect(byId['g-1'] / byId['g-2']).toBeCloseTo(2, 6);
  });

  it('leaves month 0 alone, because it is live-anchored to the sim own month-0 chain', () => {
    anchor();
    // useCardProjection's month-0 cash chain takes `goalContrib` whole, and the convergence loop
    // substitutes NaN at m === 0, so nothing decided here would ever be reconciled against the sim.
    // Cutting month 0 would make Dashboard and Forecast print different month-0 ending cash for the
    // same plan — a worse defect than the one being fixed. This pins the exemption deliberately.
    const out = calculateForecast(makeInputs(1000, [goal({ monthly_contribution: 300 })]));

    expect(out.data[0].savingsContrib).toBe(300);
    expect(out.data[0].belowSafeMinimum).toBe(true);
  });

  it('does not touch a month that can comfortably afford its contribution', () => {
    anchor();
    const out = calculateForecast(makeInputs(50000, [goal({ monthly_contribution: 300 })]));
    // No month in the horizon comes near the floor, so nothing is cut anywhere.
    expect(out.data.every(r => r.savingsContrib === 300)).toBe(true);
    expect(out.data.every(r => !r.belowSafeMinimum)).toBe(true);
  });
});
