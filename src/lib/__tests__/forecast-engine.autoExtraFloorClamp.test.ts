// THE RANKED RESERVE CANNOT SPEND WHAT THE CARD PAYMENT IS ABOUT TO SPEND.
//
// The month's discretionary reserve for ranked goals and the sim's payment ledger were each sized
// against the cash floor independently, and neither was told about the other, so together they
// could spend more than the month had. Measured on live data 2026-08-26, Oct 2027: cash before the
// reserve $4,789.33, reserve $2,629.48, ledger payment $2,355.00, floor $2,009.40, ending cash
// MINUS $195.15 -- an amount of cash that cannot exist.
//
// Would-fail check: delete the `i > 0 && autoExtraOutThisMonth > 0` clamp in forecast-engine.ts and
// the second and third tests below fail while the first still passes, which is the point of having
// all three. The first pins that the clamp stays INERT when the money is really there, so a fix for
// the overspend can never quietly become a tax on every opted-in month.

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

/**
 * A projection stub carrying only what the cash chain reads, plus the one thing the sibling
 * fixtures leave empty and this file needs: a payment ledger. `ledgerEntry.total` is the planned
 * debt payment the clamp has to reckon with, and with an empty ledger the clamp deliberately
 * treats the payment as zero and never fires.
 */
function cardProjection(
  perTarget: Month0Result['autoExtraPerTarget'],
  ledgerPayment: number,
): CardProjectionResult {
  const reserved = Math.round(perTarget.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  return {
    data: [], simCards: [], allPaymentTotals: [], debtPaymentTotals: [],
    perCardPayments: [], perCardPaymentsScaled: [],
    paymentLedger: Array.from({ length: 60 }, () => ({
      total: ledgerPayment, revolving: ledgerPayment, cycling: 0,
    })),
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
  checking: number,
  ledgerPayment: number,
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
    cardProjectionData: cardProjection(perTarget, ledgerPayment),
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

const OPTED_IN = goal({ id: 'g-2', linked_account: 'sav-1', auto_extra: true });
const RESERVE = 400;
/** Half a cent, matching the engine's own clamp epsilon. */
const AUTO_EXTRA_CENT = 0.005;
const reserveOf = (amount: number): Month0Result['autoExtraPerTarget'] =>
  [{ id: 'g-2', kind: 'goal', amount }];

describe('forecast-engine — the ranked reserve gives way before the month goes negative', () => {
  afterEach(() => vi.useRealTimers());

  it('leaves the reserve untouched when the month can genuinely afford it', () => {
    // Plenty of cash and a small planned payment, so the clamp has nothing to do. Month 0 is read
    // rather than a later month because month 0's reserve is replayed verbatim from the chain and
    // is the cleanest statement of "the full reserve arrived".
    anchor();
    const control = calculateForecast(makeInputs([OPTED_IN], [], 40000, 50));
    anchor();
    const opted = calculateForecast(makeInputs([OPTED_IN], reserveOf(RESERVE), 40000, 50));

    expect(opted.data[0].savingsBalance - control.data[0].savingsBalance).toBeCloseTo(RESERVE, 2);
    expect(opted.data[0].endingCash - control.data[0].endingCash).toBeCloseTo(-RESERVE, 2);
  });

  it('takes NO reserve at all in a month the planned payment has already exhausted', () => {
    // A payment ledger big enough to swallow the month on its own. The clamp cannot rescue such a
    // month and must not pretend to -- a card payment is contractual and this test would be lying
    // if it asserted the month ends positive. What the clamp owes is narrower and is the whole
    // defect: the DISCRETIONARY reserve must not be taken on top. So the opted-in run has to come
    // out identical to a run with no reserve at all, month for month.
    //
    // Before the clamp the opted-in run sat a further $5,000 below the control in month 1 and every
    // month after, which is exactly the overspend measured on the live account.
    anchor();
    const control = calculateForecast(makeInputs([OPTED_IN], [], 6000, 4000));
    anchor();
    const opted = calculateForecast(makeInputs([OPTED_IN], reserveOf(5000), 6000, 4000));

    // Month 0 is exempt by design (its reserve is replayed from an already-reconciled chain), and
    // the dollars it takes stay gone from every later month's opening balance. So the assertion is
    // not that the two runs are equal -- they never can be -- but that the gap between them STOPS
    // GROWING. A constant gap means no further reserve was taken; before the clamp it grew by the
    // full reserve every month.
    const gapAt = (m: number) => control.data[m].endingCash - opted.data[m].endingCash;
    for (let m = 1; m < opted.data.length; m += 1) {
      expect(gapAt(m)).toBeCloseTo(gapAt(0), 2);
    }
  });

  it('splits the shortfall evenly between two targets the user ranked EQUALLY', () => {
    // ⚠️ READ THIS BEFORE CHANGING THE CLAMP'S SHEDDING ORDER. The waterfall funds ONE rank per
    // month ("only the highest one that is not finished gets the money"), so two targets at
    // DIFFERENT ranks are never in the money in the same month and the clamp is never asked to
    // choose between them. Measured 2026-08-26: with a $500 goal ranked above a $5,000 one, month 1
    // pays the first $500 and month 2 pays the second $2,498. Reverse-rank shedding and pro rata
    // are therefore identical everywhere EXCEPT a tie, which is the one case this can pin and the
    // one Tre asked about by name (2026-08-26, the 50/50 split).
    //
    // A tie must shed proportionally rather than in array order, or which goal loses its money
    // depends on the order the rows happened to load out of the database.
    const a = goal({ id: 'g-a', target_amount: 5000, auto_extra: true, sort_order: 3, surplus_share: 1 });
    const b = goal({ id: 'g-b', target_amount: 5000, auto_extra: true, sort_order: 3, surplus_share: 1 });

    anchor();
    const opted = calculateForecast(makeInputs([a, b], [], 3000, 0));
    const took = (m: number, id: string) => opted.data[m].autoExtraByTarget?.[id] ?? 0;

    // Month 1 is the first month the clamp can act in, month 0 being exempt.
    const aTook = took(1, 'g-a');
    const bTook = took(1, 'g-b');

    expect(aTook).toBeGreaterThan(AUTO_EXTRA_CENT);
    expect(aTook).toBeCloseTo(bTook, 2);
    // And the month stayed solvent, which is the clamp doing its job around the even split.
    expect(opted.data[1].endingCash).toBeGreaterThanOrEqual(0);
  });

  it('holds reserve back for a later month instead of draining to this month floor', () => {
    // The invariant a discretionary reserve owes: it may never leave a month holding cash that
    // cannot exist.
    //
    // ⚠️ HONEST SCOPE. This pins the CLAMP, not the LOOK-AHEAD half of it. Mutation-checked
    // 2026-08-26: forcing `lookaheadEnd` to 0 in forecast-engine.ts leaves all of these passing,
    // because this fixture has no future spike, so `requiredEndByMonth` never rises above the
    // month's own floor and the two targets coincide. Pinning the look-ahead needs a fixture with a
    // large one-time expense several months out, which `makeInputs` cannot express today
    // (`oneTimeByMonth` is hard-coded empty). The look-ahead itself is currently evidenced only by
    // the live 60-month check recorded on afbff446: Dec 2028's requiredEnd was 2883, the month was
    // ending at 2011 because the ranked reserve took the difference, and Jan 2029 landed at 1246
    // against a floor of 1955; after the fix none of the 60 months ends below its floor. Anyone
    // extending `makeInputs` to take one-time expenses should come back and finish this.
    //
    // The planned payment is deliberately ZERO here. With a mandatory payment the account drains
    // on its own and the month goes negative for a reason the clamp is not allowed to fix, which
    // would make the first assertion fail for the wrong reason. Zero leaves the reserve as the only
    // thing moving, which is exactly what is under test.
    const g = goal({ id: 'g-look', target_amount: 50000, auto_extra: true, sort_order: 1 });

    anchor();
    const control = calculateForecast(makeInputs([g], [], 3000, 0));
    anchor();
    const opted = calculateForecast(
      makeInputs([g], [{ id: 'g-look', kind: 'goal', amount: 2500 }], 3000, 0),
    );

    // THE INVARIANT: a discretionary reserve may never leave a month holding cash that cannot
    // exist. This is the assertion the look-ahead earns.
    for (const row of opted.data) expect(row.endingCash).toBeGreaterThanOrEqual(0);

    // The clamp did not achieve that by simply refusing to reserve anything - month 0 is exempt
    // and takes its full seeded amount, so the two runs must actually differ.
    expect(control.data[0].endingCash - opted.data[0].endingCash).toBeGreaterThan(AUTO_EXTRA_CENT);

    // And it never invents cash: the opted run can never end a month ABOVE the control, because a
    // reserve only ever takes money out.
    for (let m = 0; m < opted.data.length; m += 1) {
      expect(opted.data[m].endingCash).toBeLessThanOrEqual(control.data[m].endingCash + AUTO_EXTRA_CENT);
    }
  });

  it('conserves the money when it clamps, month by month', () => {
    // Whatever the clamp decides, the cash that left checking and the savings that arrived have to
    // be the same dollars. A clamp that scaled the total without scaling the itemised parts would
    // credit a balance out of money that never moved, and this is what would catch it.
    anchor();
    const control = calculateForecast(makeInputs([OPTED_IN], [], 6000, 4000));
    anchor();
    const opted = calculateForecast(makeInputs([OPTED_IN], reserveOf(5000), 6000, 4000));

    for (let m = 0; m < opted.data.length; m += 1) {
      const cashDrop = control.data[m].endingCash - opted.data[m].endingCash;
      const savingsRise = opted.data[m].savingsBalance - control.data[m].savingsBalance;
      expect(savingsRise).toBeCloseTo(cashDrop, 2);
    }
  });
});
