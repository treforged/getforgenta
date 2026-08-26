// The /debt "with extra payments" readout wiring. `ForecastResult` exposes the engine's OWN
// per-debt monthly balance arrays - `nonCCLiabilityBalancesById` (one row per liability account
// id, straight from `nonCCLiabilities.rows`) and `carLoanBalancesByFundId` (keyed by
// `car_funds.id`) - as SHARED REFERENCES into the arrays steps 4c-ii-b/c reduce in place, so they
// are extra-aware by construction. DebtPayoff derives the with-extras payoff month as the first
// index whose opening balance is <= 0 (the reducers use Math.max(0, before - amount), exact zero,
// no dust tolerance), and shows it only when it beats the scheduled readout.
//
// Would-fail check: return copies instead of the shared references (or build the map before the
// month loop runs) and "strictly earlier" fails - the exposed arrays would stop agreeing with
// `nonCCLiabBreakdown` / `carLoanBreakdown` the moment the waterfall credits a ranked target.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { calculatePayoffMonths } from '@/lib/calculations';
import type { AccountRow, DebtRow, RuleRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';
import type { CardProjectionResult } from '@/lib/debt-model-types';
import type { CarFund } from '@/lib/types';

const acct = (over: Record<string, unknown>): AccountRow =>
  ({
    id: 'x', name: 'x', account_type: 'checking', balance: 0, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
    surplus_sort_order: null, surplus_share: null,
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

/** The `forecast-engine.autoExtraLiability.test.ts` harness, plus an override hook so the
 *  vehicle-loan case can swap in its own carFunds / cardProjectionData / payConfig. */
function makeInputs(
  accounts: AccountRow[], debts: DebtRow[], monthlyRuleExpenses: number,
  over: Partial<ForecastInputs> = {},
): ForecastInputs {
  return {
    debts, goals: [], carFunds: [],
    accounts,
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [] as RuleRow[],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: 1200, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
    oneTimeByMonth: {}, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
    transactions: [],
    currentMonthRecommendedDebt: null,
    forecastMonthEvents: Array.from({ length: PROJECTION_MONTHS }, () => ({
      income: 0, nonPaycheckIncome: 0, expenses: monthlyRuleExpenses,
    })),
    forecastFundingAccountId: 'chk-1',
    cashFloor: 0,
    pauseSavings: false,
    syncCutoffDate: '2025-12-31',
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
    ...over,
  };
}

const CHK = acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 20000 });
/** apr 12 ⇒ 1%/mo, payment 300: the account's 12000 amortizes 12000 → 11820 → … with no extra. */
const STUDENT_DEBT = { id: 'd1', name: 'Student Loan', balance: 12000, apr: 12, target_payment: 300 } as unknown as DebtRow;
const loanAcct = (over: Record<string, unknown> = {}) => acct({
  id: 'sl-1', name: 'Student Loan', account_type: 'student_loan', balance: 12000, ...over,
});

/** Same fixture as `forecast-engine.autoExtraLoan.test.ts`: Tre's actual C5. */
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

/** No sim cards ⇒ months 1+ see a zero card block and the surplus above the floor is rankable. */
const CARD_PROJECTION = {
  data: [], simCards: [], allPaymentTotals: [], debtPaymentTotals: [],
  perCardPayments: [], perCardPaymentsScaled: [], paymentLedger: [],
  monthlyRevolvingBalances: new Map(), monthlyBalances: new Map(),
  perCardMinPayments: new Map(), monthlyCyclingOwed: new Map(),
  monthlyCyclingInterest: new Map(), monthlyInterest: new Map(),
  monthlyCyclingBacklog: new Map(),
  month0: { autoExtraPerTarget: [], chain: { autoExtraReserve: 0 } },
} as unknown as CardProjectionResult;

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

const run = (accounts: AccountRow[], expenses = 1000) =>
  calculateForecast(makeInputs(accounts, [STUDENT_DEBT], expenses));
const firstZero = (balances: number[] | undefined) =>
  balances ? balances.findIndex(b => b <= 0) : -1;

describe('forecast-engine - the exposed with-extras payoff arrays', () => {
  afterEach(() => vi.useRealTimers());

  it('a RANKED liability with auto-extra pays off strictly earlier in the exposed array than the scheduled projection', () => {
    anchor();
    const control = run([CHK, loanAcct()]);
    anchor();
    const ranked = run([CHK, loanAcct({ surplus_sort_order: 0 })]);

    const scheduledMonths = calculatePayoffMonths(12000, 12, 300);
    // The control's exposed array IS the scheduled amortization: its first-zero month equals the
    // closed-form payoff the /debt tabs already print, which is what makes "differs from the
    // scheduled date" a meaningful gate rather than a race between two models.
    expect(firstZero(control.nonCCLiabilityBalancesById.get('sl-1'))).toBe(scheduledMonths);

    const clearedAt = firstZero(ranked.nonCCLiabilityBalancesById.get('sl-1'));
    expect(clearedAt).toBeGreaterThan(0);
    expect(clearedAt).toBeLessThan(scheduledMonths);

    // No second math path: the exposed array is the very data the month drawer itemises, extras
    // included - a copy taken before the waterfall ran would break this at the first credit.
    const balances = ranked.nonCCLiabilityBalancesById.get('sl-1')!;
    for (const i of [0, 1, 3, clearedAt]) {
      expect(balances[i]).toBe(ranked.data[i].nonCCLiabBreakdown.find(r => r.id === 'sl-1')!.balance);
    }
  });

  it('an UNRANKED debt exposes only the scheduled projection - no differing secondary month exists', () => {
    anchor();
    const { data, nonCCLiabilityBalancesById } = run([CHK, loanAcct()]);
    const balances = nonCCLiabilityBalancesById.get('sl-1');
    expect(balances).toBeDefined();
    // Untouched schedule: 12000 * 1.01 − 300 = 11820 in month 1, and the first-zero month lands
    // exactly on the closed-form scheduled payoff - the readout the tab already shows - so a
    // "with extra payments" line derived from this array can never render for an unranked debt.
    expect(balances![1]).toBeCloseTo(11820, 6);
    expect(firstZero(balances)).toBe(calculatePayoffMonths(12000, 12, 300));
    expect(data.every(r => Object.keys(r.autoExtraByTarget).length === 0)).toBe(true);
    for (const i of [0, 1, 12, 40]) {
      expect(balances![i]).toBe(data[i].nonCCLiabBreakdown.find(r => r.id === 'sl-1')!.balance);
    }
  });

  it('exposes the vehicle-loan arrays by fund id, reduced by the ranked extra', () => {
    const loanInputs = (fund: CarFund) => makeInputs(
      [acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 30_000 })], [], 0,
      {
        carFunds: [fund], cardProjectionData: CARD_PROJECTION,
        payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
        forecastMonthEvents: [],
      },
    );
    anchor();
    const off = calculateForecast(loanInputs(c5({ auto_extra: false })));
    anchor();
    const on = calculateForecast(loanInputs(c5({ auto_extra: true })));

    const offZero = firstZero(off.carLoanBalancesByFundId.get('c5'));
    const onZero = firstZero(on.carLoanBalancesByFundId.get('c5'));
    // Opted out, the array's first zero is the scheduled payoff; opted in, the waterfall clears
    // the loan strictly earlier - the exact comparison the Auto Loans tab renders.
    expect(offZero).toBeGreaterThan(0);
    expect(onZero).toBeGreaterThan(0);
    expect(onZero).toBeLessThan(offZero);

    // Same shared-reference pin as the liability case, against `carLoanBreakdown` (which drops a
    // fund once its balance is flat zero - the reason the id-keyed map, not the name-keyed rows,
    // is what got exposed).
    const balances = on.carLoanBalancesByFundId.get('c5')!;
    for (const i of [0, 1, onZero - 1]) {
      expect(balances[i]).toBe(on.data[i].carLoanBreakdown.find(r => r.name === '2004 Chevrolet C5')?.balance ?? 0);
    }
    expect(on.data[onZero].carLoanBreakdown.find(r => r.name === '2004 Chevrolet C5')).toBeUndefined();
  });
});
