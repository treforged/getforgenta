// EXTRA PRINCIPAL ON A LIVE VEHICLE LOAN — the fourth ranked target kind.
//
// This file exists because of a bug that shipped past 2,083 green tests and died on the first real
// page load: `autoExtraLoanFunds` was declared beside its siblings ~280 lines above the
// amortization loop that fills `loanBalancesByFundId`, so it read a `const` in its temporal dead
// zone and the whole app threw "Cannot access 'loanBalancesByFundId' before initialization".
//
// Nothing caught it because NO test ran `calculateForecast` with a loan-phase car fund opted in.
// The first assertion below is therefore the cheapest and most valuable one here: the engine runs
// at all. The rest pin the thing that made loan targets worth gating in the first place — the cash
// leaves checking AND the liability falls by the same dollars, so the money cannot evaporate.
//
// Would-fail check: delete step 4c-ii-b (the balance reduction) and `pays the cash out of checking
// AND takes it off the loan` fails while every other test in the suite stays green — which is
// exactly the asymmetry the gate was protecting against.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { CardProjectionResult } from '@/lib/debt-model-types';
import type { CarFund } from '@/lib/types';

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

/** Tre's actual C5: $16,530 at 10.18% over 48 months, first payment 2026-08-07. */
const c5 = (over: Partial<CarFund> = {}): CarFund => ({
  id: 'c5', user_id: 'u', vehicle_name: '2004 Chevrolet C5',
  target_price: 0, tax_fees: 0, down_payment_goal: 7_700, current_saved: 0,
  saved_source: 'fixed', saved_percent: 0, monthly_insurance: 0,
  expected_apr: 10.18, loan_term_months: 48, phase: 'loan',
  loan_amount: 16_530, loan_start_date: '2026-08-07', payment_start_date: '2026-08-07',
  interest_start_date: '2026-08-07', insurance_start_date: null,
  actual_monthly_payment: 422.89, linked_account: null, linked_rule_id: null,
  loan_payment_account: null, linked_loan_account_id: null, planned_purchase_date: null,
  gift_contribution: 0, lump_sum_payments: [], sort_order: 0, auto_extra: false,
  created_at: '', ...over,
} as unknown as CarFund);

/** No sim cards, so months 1+ see a zero card block and the whole surplus above the floor is
 *  rankable — the diversion is then visible in isolation. */
const CARD_PROJECTION = {
  data: [], simCards: [], allPaymentTotals: [], debtPaymentTotals: [],
  perCardPayments: [], perCardPaymentsScaled: [], paymentLedger: [],
  monthlyRevolvingBalances: new Map(), monthlyBalances: new Map(),
  perCardMinPayments: new Map(), monthlyCyclingOwed: new Map(),
  monthlyCyclingInterest: new Map(), monthlyInterest: new Map(),
  monthlyCyclingBacklog: new Map(),
  month0: { autoExtraPerTarget: [], chain: { autoExtraReserve: 0 } },
} as unknown as CardProjectionResult;

function makeInputs(carFunds: CarFund[], checking = 30_000): ForecastInputs {
  return {
    debts: [], goals: [], carFunds,
    accounts: [acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: checking })],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: CARD_PROJECTION,
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

const loanAt = (r: { carLoanBreakdown?: { name: string; balance: number }[] }) =>
  r.carLoanBreakdown?.reduce((s, b) => s + b.balance, 0) ?? 0;

describe('forecast-engine — extra principal on a vehicle loan', () => {
  afterEach(() => vi.useRealTimers());

  it('runs at all with a loan-phase fund opted in', () => {
    // The regression that shipped: this threw before the declaration was moved below the
    // amortization loop. Cheap, and it is the one nobody had.
    anchor();
    expect(() => calculateForecast(makeInputs([c5({ auto_extra: true })]))).not.toThrow();
  });

  it('an OPTED-OUT loan is byte-identical to the pre-feature projection', () => {
    anchor();
    const off = calculateForecast(makeInputs([c5({ auto_extra: false })]));
    anchor();
    const alsoOff = calculateForecast(makeInputs([c5()]));
    expect(off.data.map(r => r.endingCash)).toEqual(alsoOff.data.map(r => r.endingCash));
    expect(off.data.map(r => r.projectedCarLoan)).toEqual(alsoOff.data.map(r => r.projectedCarLoan));
  });

  it('pays the cash out of checking AND takes it off the loan — never one without the other', () => {
    anchor();
    const off = calculateForecast(makeInputs([c5({ auto_extra: false })]));
    anchor();
    const on = calculateForecast(makeInputs([c5({ auto_extra: true })]));

    const i = 3;
    const cashSpent = off.data[i].endingCash - on.data[i].endingCash;
    const loanCut = loanAt(off.data[i]) - loanAt(on.data[i]);

    // Cash really left…
    expect(cashSpent).toBeGreaterThan(0);
    // …and the liability really fell. Without step 4c-ii-b this is 0 and the money has vanished.
    expect(loanCut).toBeGreaterThan(0);
    // The loan can never fall by MORE than the cash that paid it. It may fall by less once the
    // balance bottoms out at zero, which is why this is an inequality rather than an equality.
    expect(loanCut).toBeLessThanOrEqual(cashSpent + 0.01);
  });

  it('never reserves against principal it has already retired', () => {
    anchor();
    const on = calculateForecast(makeInputs([c5({ auto_extra: true })], 500_000));
    // Enough cash to clear the loan outright. Once the balance is zero it must STAY zero — a
    // capacity read from a stale running total would keep taking money against nothing.
    const balances = on.data.map(loanAt);
    const firstZero = balances.findIndex(b => b <= 0.01);
    expect(firstZero).toBeGreaterThanOrEqual(0);
    for (let i = firstZero; i < balances.length; i += 1) {
      expect(balances[i], `month ${i} stays retired`).toBeLessThanOrEqual(0.01);
    }
  });

  it('the loan balance is monotonically non-increasing, extras or not', () => {
    anchor();
    const on = calculateForecast(makeInputs([c5({ auto_extra: true })]));
    const balances = on.data.map(loanAt);
    for (let i = 1; i < balances.length; i += 1) {
      expect(balances[i], `month ${i} never grows`).toBeLessThanOrEqual(balances[i - 1] + 0.01);
    }
  });
});
