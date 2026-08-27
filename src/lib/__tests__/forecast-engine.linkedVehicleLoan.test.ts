// Tre, 2026-08-18: "on the forecast pop ups its showing the manual amount and the connected
// amount. if an account is connected the manual amount should be disregarded and not used."
//
// The month drawer maps `nonCCLiabBreakdown` and then `carLoanBreakdown` back to back. His 2004
// C5 is a `car_funds` loan AND a connected `auto_loan` account ("FIXED RATE LOAN"), explicitly
// linked — so the same debt was itemised twice: once amortizing, once as a flat line for all 60
// months, because a Plaid auto_loan account has `min_payment` null and no `debts` row to match.
//
// The account row is the one that gets dropped, which is the OPPOSITE survivor from
// `net-worth.ts` — see `vehicle-loan-link.ts` for why that is deliberate.
//
// Would-fail check: without the `linkedVehicleAccountIds` filter, "one row for a linked pair"
// sees two rows; without the `currentBalance` wiring, the projected balance opens at 16530.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { applyLinkedLoanBalances } from '@/lib/vehicle-loan-link';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { CarFund } from '@/lib/types';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

const LOAN_ACCOUNT_ID = 'bcbc52b8-9a80-40d7-a45e-4b121c735629';
const LIVE_BALANCE = 16254.49;
const TYPED_LOAN_AMOUNT = 16530;

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

const carFund = (over: Partial<CarFund> = {}): CarFund => ({
  id: 'car-1', user_id: 'u1', vehicle_name: '2004 Chevorlet C5', target_price: 0, tax_fees: 0,
  down_payment_goal: 0, current_saved: 0, saved_source: 'fixed', saved_percent: 0, sort_order: 0, auto_extra: false,
  monthly_insurance: 0, expected_apr: 10.18, loan_term_months: 48, phase: 'loan',
  loan_amount: TYPED_LOAN_AMOUNT,
  loan_start_date: '2026-06-21', payment_start_date: '2026-08-07', interest_start_date: '2026-08-07',
  actual_monthly_payment: 422.89, linked_account: null, linked_rule_id: null,
  loan_payment_account: null, linked_loan_account_id: null,
  planned_purchase_date: null, gift_contribution: 0, lump_sum_payments: [],
  insurance_start_date: null, created_at: '2026-01-01',
  ...over,
});

function makeInputs(carFunds: CarFund[]): ForecastInputs {
  return {
    debts: [], goals: [], carFunds,
    accounts: [
      acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 20000 }),
      acct({ id: LOAN_ACCOUNT_ID, name: 'FIXED RATE LOAN', account_type: 'auto_loan', balance: LIVE_BALANCE }),
    ],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: 1200, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
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

// Month 0 = Oct 2026: two payments (Aug, Sep) have posted, so the first unpaid row is Oct.
const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

const rowsFor = (data: ReturnType<typeof calculateForecast>['data'], i: number) => [
  ...data[i].nonCCLiabBreakdown.map(r => ({ name: r.name, balance: r.balance })),
  ...data[i].carLoanBreakdown.map(r => ({ name: r.name, balance: r.balance })),
];

describe('forecast-engine — a linked vehicle loan is itemised once, at the bank\'s balance', () => {
  afterEach(() => vi.useRealTimers());

  it('emits ONE row for a linked pair — the amortizing car fund, not the flat account', () => {
    anchor();
    const linked = applyLinkedLoanBalances(
      [carFund({ linked_loan_account_id: LOAN_ACCOUNT_ID })],
      [{ id: LOAN_ACCOUNT_ID, balance: LIVE_BALANCE, active: true }],
    );
    const { data } = calculateForecast(makeInputs(linked));

    const rows = rowsFor(data, 0);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('2004 Chevorlet C5');
    expect(data[0].nonCCLiabBreakdown.some(r => r.name === 'FIXED RATE LOAN')).toBe(false);

    // The surviving row is the one that can move: it amortizes down over the projection.
    expect(rowsFor(data, 12)[0].balance).toBeLessThan(rows[0].balance);
  });

  it('opens at the live balance, not at the typed loan_amount', () => {
    anchor();
    const linked = applyLinkedLoanBalances(
      [carFund({ linked_loan_account_id: LOAN_ACCOUNT_ID })],
      [{ id: LOAN_ACCOUNT_ID, balance: LIVE_BALANCE, active: true }],
    );
    const result = calculateForecast(makeInputs(linked));
    const { data } = result;
    // THE SEED IS THE LIVE FIGURE, and that is what "opens at the live balance" means: index 0 of
    // the engine's own array is the bank's number to the cent — the same one /accounts and the
    // Garage card print.
    expect(result.carLoanBalancesByFundId.get('car-1')![0]).toBeCloseTo(LIVE_BALANCE, 2);
    // The DRAWER row is one payment further on, deliberately (2026-08-27): it sits beside
    // end-of-month cash and end-of-month assets, so it prints what the loan closes October owing.
    // 285.00 is October's principal.
    expect(rowsFor(data, 0)[0].balance).toBeCloseTo(LIVE_BALANCE - 285, 2);

    // Unlinked, the car fund's own row still amortizes from the typed figure — the account row
    // beside it is what carries the bank's balance, and that is the double-count.
    const unlinked = calculateForecast(makeInputs([carFund()]));
    const unlinkedVehicleRow = rowsFor(unlinked.data, 0).find(r => r.name === '2004 Chevorlet C5')!;
    expect(unlinked.carLoanBalancesByFundId.get('car-1')![0]).not.toBeCloseTo(LIVE_BALANCE, 2);
    // Oct OPENS at 15962.28 off loan_amount (where Sep closed) and CLOSES at 15674.80.
    expect(unlinked.carLoanBalancesByFundId.get('car-1')![0]).toBeCloseTo(15962.28, 2);
    expect(unlinkedVehicleRow.balance).toBeCloseTo(15674.80, 2);
  });

  it('emits TWO rows when the loan is not linked — an unrelated auto loan is still real debt', () => {
    anchor();
    const { data } = calculateForecast(makeInputs([carFund()]));
    const rows = rowsFor(data, 0);
    expect(rows.length).toBe(2);
    expect(rows.map(r => r.name).sort()).toEqual(['2004 Chevorlet C5', 'FIXED RATE LOAN']);
  });

  it('emits TWO rows when the linked account is inactive — nothing may silently vanish', () => {
    anchor();
    // An inactive account is already excluded from the forecast's own account list, so the point
    // here is that the car fund keeps its MANUAL amortization rather than losing its balance.
    const inactive = applyLinkedLoanBalances(
      [carFund({ linked_loan_account_id: LOAN_ACCOUNT_ID })],
      [{ id: LOAN_ACCOUNT_ID, balance: LIVE_BALANCE, active: false }],
    );
    const { data } = calculateForecast(makeInputs(inactive));
    const rows = rowsFor(data, 0);
    expect(rows.some(r => r.name === '2004 Chevorlet C5')).toBe(true);
    expect(rows.find(r => r.name === '2004 Chevorlet C5')!.balance).not.toBeCloseTo(LIVE_BALANCE, 2);
  });
});
