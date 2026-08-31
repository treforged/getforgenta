// THE SAVE-UP CAP IS IN CASCADE-POOL UNITS, SO THE MANDATORY INSTALLMENT IS NOT INSIDE IT.
//
// `computeFloorProtection` has one consumer convention and had two callers using different ones.
// `credit-card-engine.ts:1810/1848` compares the cap it receives against an `availableCash` that
// has ALREADY had `installmentCashCost` deducted (Step 2.5), so the cap must be in cascade-pool
// units — CONVENTION B, which `useCardProjection.ts` builds (installment added to `expenseByMonth`,
// stripped back out of ccMin as `ccMinRevOnly`). forecast-engine's PASS 2 did neither, so the cap
// it handed the sim through `forecast-convergence.ts:192` was inflated by exactly
// `installmentCashCost` and was too loose to bind. Measured on live data 2026-08-28, Oct 2026:
// `mDebtCap 784.80`, `installmentCashCost 510.50`, `availableCash 330.00` — 784.80 sat at more
// than double the pool it was being compared against, so `1d1de408`'s clamp, correct in itself,
// was unreachable. Fixed in `40218c8d`; this file is what pins it.
//
// The pin is DIFFERENTIAL — every assertion is one run against an otherwise-identical control that
// differs only by the installment. Nothing here hardcodes a floor, an income derivation, or a
// dollar cap, so a change to any of those cannot silently rewrite what this file is protecting.
//
// Would-fail check, and why there are two scenarios rather than one:
//   • Delete `+ installmentCostByMonth[i]` from PASS 2's `expenseByMonth` and BOTH scenarios fail.
//   • Delete `- installmentCostByMonth[m]` from `ccMinByMonth` and scenario B fails while
//     scenario A still passes — A's cap comes from the `availableForDebt` branch, which the
//     expense term alone moves. Only a month where the backward chain binds the cap down to ccMin
//     itself can see the other half of the conversion.
//   • Delete `+ installmentCostByMonth[i]` from `debtPayments` and the third test fails: the
//     DISPLAYED payment is `allPaymentTotals` (Convention A, installment included) and would be
//     cut by contractual money that was never reducible.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { CardProjectionResult } from '@/lib/debt-model-types';

const MONTHS = 60;

/** The mandatory installment under test. One number, used by both scenarios. */
const INSTALLMENT = 200;
/** Total contract minimum across the sim's cards. Deliberately above INSTALLMENT so the
 *  Convention-B ccMin (`ccMinTotal - INSTALLMENT`) never hits the `Math.max(0, …)` floor — the
 *  clamp would hide the very subtraction this file is measuring. */
const CC_MIN_TOTAL = 300;
/** Convention A: every CC outflow, installment included. What PASS 2's `rawDebtPayment` reads. */
const ALL_PAYMENT_TOTAL = 5000;
const START_CHECKING = 10000;
const MONTHLY_INCOME = 700;
/** A single spike, far enough out that the backward chain reaches month 0 and forces a cap. */
const SPIKE_MONTH = 5;
const SPIKE_EXPENSE = 8000;

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

/**
 * A projection stub carrying only what PASS 2 reads.
 *
 * `monthlyRevolvingBalances` is populated with a balance far larger than anything the cap could
 * deploy: `reducibleDebtCapByMonth` bounds ccMin by the debt still outstanding, and an empty map
 * (what the sibling fixtures use) would drive ccMin to zero from month 1 onward and quietly
 * remove the term this file exists to measure.
 *
 * `allPaymentTotals === debtPaymentTotals` so `cyclingByMonth` is zero and the only CC term
 * moving between the two runs is the installment.
 *
 * There is deliberately NO `paymentLedger`. When one is present the engine takes the month's shown
 * payment straight from `ledgerEntry.total` (forecast-engine.ts:2326) and PASS 2's `debtPayments`
 * array never reaches `data[i].debtPayment` at all — which made the third test below pass while
 * the add-back it is meant to protect was deleted. Leaving the ledger out is what makes that
 * assertion able to fail.
 */
function cardProjection(installmentCostByMonth: number[]): CardProjectionResult {
  return {
    data: [],
    simCards: [{ id: 'cc-1', name: 'Card', minPayment: CC_MIN_TOTAL, m0MinSettled: false }],
    allPaymentTotals: Array.from({ length: MONTHS }, () => ALL_PAYMENT_TOTAL),
    debtPaymentTotals: Array.from({ length: MONTHS }, () => ALL_PAYMENT_TOTAL),
    installmentCostByMonth,
    perCardPayments: [], perCardPaymentsScaled: [],
    monthlyRevolvingBalances: new Map([['cc-1', Array.from({ length: MONTHS }, () => 500000)]]),
    monthlyBalances: new Map(),
    perCardMinPayments: new Map(),
    monthlyCyclingOwed: new Map(), monthlyCyclingInterest: new Map(), monthlyInterest: new Map(),
    monthlyCyclingBacklog: new Map(),
    manualIsbPins: [],
    month0: { autoExtraPerTarget: [], chain: { autoExtraReserve: 0 } },
  } as unknown as CardProjectionResult;
}

/** 'YYYY-MM' for month index i off the fake anchor. */
const monthKey = (i: number): string => {
  const d = new Date(2026, 9 + i, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * All income and the one spike ride on `oneTimeByMonth`, the only lever this harness has that
 * lands an exact dollar amount in an exact month without going through pay-frequency and tax
 * derivation. The two runs share it byte for byte; the installment array is the sole difference.
 */
function makeInputs(installmentCostByMonth: number[]): ForecastInputs {
  const oneTimeByMonth: Record<string, { income: number; expense: number }> = {};
  for (let i = 0; i < MONTHS; i++) {
    oneTimeByMonth[monthKey(i)] = {
      income: MONTHLY_INCOME,
      expense: i === SPIKE_MONTH ? SPIKE_EXPENSE : 0,
    };
  }
  return {
    debts: [], goals: [], carFunds: [],
    accounts: [acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: START_CHECKING })],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: cardProjection(installmentCostByMonth),
    payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
    oneTimeByMonth, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
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

const NONE = Array.from({ length: MONTHS }, () => 0);
const withInstallmentIn = (month: number): number[] =>
  Array.from({ length: MONTHS }, (_, m) => (m === month ? INSTALLMENT : 0));

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

afterEach(() => vi.useRealTimers());

describe('PASS 2 save-up cap: the mandatory installment is an expense, never part of ccMin', () => {
  it('A — where the cap comes from the deployable pool, it ends at pool minus the installment', () => {
    anchor();
    // Month 0 is the one month whose cap is not already chained down to ccMin by an earlier
    // capped month, so it is the only place the `availableForDebt` branch can be observed with
    // real headroom above the minimum.
    const control = calculateForecast(makeInputs(NONE));
    const withInst = calculateForecast(makeInputs(withInstallmentIn(0)));

    const capControl = control.maxDebtPaymentByMonth[0];
    const capWithInst = withInst.maxDebtPaymentByMonth[0];

    // The cap has to actually bind, or the test would pass on two Infinities.
    expect(Number.isFinite(capControl)).toBe(true);
    expect(Number.isFinite(capWithInst)).toBe(true);
    expect(capControl).toBeLessThan(ALL_PAYMENT_TOTAL);
    // ...and it must sit above the bare minimum, which is what makes this the pool branch rather
    // than the ccMin branch that scenario B covers.
    expect(capControl).toBeGreaterThan(CC_MIN_TOTAL);

    expect(capWithInst).toBeCloseTo(capControl - INSTALLMENT, 2);
  });

  it('B — where the chain binds the cap down to the minimum, the minimum is the revolving-only one', () => {
    anchor();
    // By month 2 the backward chain has drained months 0 and 1 to their required ending balance,
    // so `availableForDebt` lands exactly on ccMin and the cap IS the minimum. Convention B's
    // minimum excludes the installment; Convention A's includes it.
    const control = calculateForecast(makeInputs(NONE));
    const withInst = calculateForecast(makeInputs(withInstallmentIn(2)));

    const capControl = control.maxDebtPaymentByMonth[2];
    const capWithInst = withInst.maxDebtPaymentByMonth[2];

    expect(Number.isFinite(capControl)).toBe(true);
    expect(Number.isFinite(capWithInst)).toBe(true);
    expect(capControl).toBeLessThan(ALL_PAYMENT_TOTAL);

    expect(capWithInst).toBeCloseTo(capControl - INSTALLMENT, 2);

    // The months without an installment are untouched: the conversion is invariant on the
    // backward pass (adding I to expense and removing I from ccMin leaves netAtMin, and therefore
    // requiredEndByMonth, unchanged), so only the installment month's cap may move.
    expect(withInst.maxDebtPaymentByMonth[0]).toBeCloseTo(control.maxDebtPaymentByMonth[0], 2);
    expect(withInst.maxDebtPaymentByMonth[1]).toBeCloseTo(control.maxDebtPaymentByMonth[1], 2);
  });

  it('the DISPLAYED debt payment is unchanged — the cap side adds the installment back', () => {
    anchor();
    // `debtPayments[i] = min(rawDebtPayment, cap + installment)`. `rawDebtPayment` is
    // `allPaymentTotals` — Convention A — so without the add-back the shown payment would be cut
    // by an amount that is contractual and was never reducible.
    const control = calculateForecast(makeInputs(NONE));
    const withInst = calculateForecast(makeInputs(withInstallmentIn(0)));

    expect(withInst.data[0].debtPayment).toBe(control.data[0].debtPayment);
  });
});
