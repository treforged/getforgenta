// Ranked extra principal on a NON-VEHICLE liability: the cash leaves once, and the debt it left
// for actually falls.
//
// This is step 4c-ii-c, the sibling of the vehicle-loan credit in 4c-ii-b. The failure it exists
// to make impossible is the one 4c-ii was written for: a reserve is subtracted from projected cash
// and nothing anywhere goes down by the same dollars, so the user's money evaporates out of the
// projection and the forecast quietly flatters itself.
//
// Would-fail check: delete the 4c-ii-c loop and case 1's ranked run shows the SAME student-loan
// balance as the control while its cash is lower; leave `b.otherDebtBalance` in place of
// `nonCCDebtBalanceByMonth[i]` at PASS 3's `totalLiabilityBal` and case 2 reports a total that no
// longer equals the rows under it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import type { AccountRow, DebtRow, RuleRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

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

/** The same shape `forecast-engine.otherDebtService.test.ts` uses, with no cards and no goals. */
function makeInputs(accounts: AccountRow[], debts: DebtRow[], monthlyRuleExpenses: number): ForecastInputs {
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
  };
}

const CHK = acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 20000 });
/** apr 12 ⇒ 1%/mo, payment 300: 12000 → 12000 * 1.01 − 300 = 11820 with no extra. */
const STUDENT_DEBT = { id: 'd1', name: 'Student Loan', balance: 1, apr: 12, target_payment: 300 } as unknown as DebtRow;
const loanAcct = (over: Record<string, unknown> = {}) => acct({
  id: 'sl-1', name: 'Student Loan', account_type: 'student_loan', balance: 12000, ...over,
});

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

const run = (accounts: AccountRow[], expenses = 1000) =>
  calculateForecast(makeInputs(accounts, [STUDENT_DEBT], expenses));
const balanceOf = (row: ReturnType<typeof calculateForecast>['data'][number]) =>
  row.nonCCLiabBreakdown.find(r => r.id === 'sl-1')?.balance;

describe('forecast-engine — ranked extra principal on a non-CC liability', () => {
  afterEach(() => vi.useRealTimers());

  it('takes nothing at all for a liability the user has not ranked', () => {
    anchor();
    const { data } = run([CHK, loanAcct()]);
    expect(data.every(r => Object.keys(r.autoExtraByTarget).length === 0)).toBe(true);
    // `nonCCLiabBreakdown` is what the month CLOSES at (2026-08-27), so month 1 is two payments
    // in: 12000 → 11820 → 11638.20.
    expect(balanceOf(data[1])).toBeCloseTo(11638.2, 6);
  });

  it('credits the ranked extra to the liability from this month forward, and cash falls once', () => {
    anchor();
    const control = run([CHK, loanAcct()]);
    const ranked = run([CHK, loanAcct({ surplus_sort_order: 0 })]);

    // Something was actually reserved, every month, until the debt is gone.
    const reserve = (i: number) => ranked.data[i].autoExtraByTarget['sl-1'] ?? 0;
    expect(reserve(1)).toBeGreaterThan(0);

    // THE CREDIT. The balance is lower than the control's by exactly the reserves taken so far —
    // no re-amortization, so the reduction is dollar-for-dollar plus the interest no longer
    // charged on the principal that is gone.
    expect(balanceOf(ranked.data[1])!).toBeLessThan(balanceOf(control.data[1])!);
    // 11638.20, not 11820: the row is month 1's CLOSING balance (12000 → 11820 → 11638.20), and
    // the month's own reserve comes off it.
    expect(balanceOf(ranked.data[1])).toBeCloseTo(11638.2 - reserve(1), 6);

    // THE CASH, EXACTLY ONCE. Every month's ending cash is the control's less the reserves taken
    // up to and including that month — never twice, never zero.
    //
    // ⚠️ PLUS THE SCHEDULED PAYMENTS THE RANKED RUN NO LONGER OWES (2026-08-27). Paying the debt
    // off early does two things to cash, not one: the reserve leaves, and then the $300 scheduled
    // payment STOPS, because a debt with no balance left cannot take a payment. The control is
    // still paying it in those months. Written as the control's own `otherDebtPayment` minus the
    // ranked run's, so it stays exact if the fixture's payoff month moves — and so the identity
    // still fails the moment a reserve is counted twice, which is what this loop is for.
    let cumulative = 0;
    let cumulativeUnpaid = 0;
    for (let i = 0; i < 12; i++) {
      cumulative += reserve(i);
      cumulativeUnpaid += control.data[i].otherDebtPayment - ranked.data[i].otherDebtPayment;
      expect(ranked.data[i].rawEndingCash)
        .toBeCloseTo(control.data[i].rawEndingCash - cumulative + cumulativeUnpaid, 4);
    }
    // The fixture really does exercise that: the ranked run stops paying inside the window.
    expect(cumulativeUnpaid).toBeGreaterThan(0);

    // And the debt genuinely retires early rather than the money vanishing: the control still owes
    // something in the month the ranked run has cleared it.
    const clearedAt = ranked.data.findIndex(r => (balanceOf(r) ?? 0) <= 0);
    expect(clearedAt).toBeGreaterThan(0);
    expect(balanceOf(control.data[clearedAt])!).toBeGreaterThan(0);
  });

  it('never reserves more than is still owed, and stops once the debt is gone', () => {
    anchor();
    // $20,000 in checking, ~$5,200/mo of income and NO expenses: cash is not what limits this, the
    // debt is. Capacity is read fresh from the (already reduced) projection each month, so it can
    // never offer principal that has already been paid.
    const ranked = run([CHK, loanAcct({ balance: 9000, surplus_sort_order: 0 })], 0);
    const reserve = (i: number) => ranked.data[i].autoExtraByTarget['sl-1'] ?? 0;

    // Month 0's reserve is `useCardProjection`'s to decide and this fixture has no projection, so
    // nothing is reserved there — the month simply closes at 9000 * 1.01 − 300 = 8790.
    expect(reserve(0)).toBe(0);
    expect(balanceOf(ranked.data[0])).toBeCloseTo(8790, 6);

    // Month 1: the cap is what the debt can still ABSORB after its own scheduled payment, i.e.
    // what it closes at — 8790 * 1.01 − 300 = 8577.90 — not the 8790 it opened owing. Offering the
    // opening balance sent $212.10 of cash into principal the $300 payment was already retiring
    // that same month (2026-08-27). The two together now reconcile exactly: 300 + 8577.90 =
    // 8877.90 = the 8790 owed plus its 87.90 of interest. The debt is still cleared outright.
    expect(reserve(1)).toBeCloseTo(8577.9, 6);
    expect(balanceOf(ranked.data[1])).toBeCloseTo(0, 6);

    // Cleared stays cleared, and takes nothing further — a reserve against a zero balance would be
    // cash leaving checking for nowhere.
    for (let i = 2; i < PROJECTION_MONTHS; i++) {
      expect(reserve(i)).toBe(0);
      expect(balanceOf(ranked.data[i])).toBe(0);
    }
    // Total reserved over the whole horizon is one payoff, never more.
    const totalReserved = ranked.data.reduce((s, _, i) => s + reserve(i), 0);
    expect(totalReserved).toBeCloseTo(8577.9, 6);
  });

  it('keeps the liability TOTAL equal to the rows under it after a credit', () => {
    anchor();
    const { data } = run([CHK, loanAcct({ surplus_sort_order: 0 })]);
    for (const i of [0, 1, 3, 9, 24]) {
      const rowsSum = data[i].nonCCLiabBreakdown.reduce((s, r) => s + r.balance, 0);
      // No cards and no car funds in this fixture, so the whole liability total IS these rows.
      expect(data[i].rawTotalLiabilities).toBeCloseTo(rowsSum, 6);
    }
  });

  it('leaves the extra principal out of otherDebtPayment — that term is the SCHEDULED payment', () => {
    anchor();
    const { data } = run([CHK, loanAcct({ surplus_sort_order: 0 })]);
    // The reserve is its own cash term (`autoExtraOutThisMonth`). Folding it into this one would
    // double-count it against `totalExpenses`, which already carries the scheduled $300.
    expect(data[1].otherDebtPayment).toBeCloseTo(300, 6);
    // `totalExpenses` carries the reserve ONCE, as that separate term (2026-08-26): it is money
    // that left checking, and the table's "−Out" column reporting $1,300 for a month that spent
    // $13,120 disagreed with the End Cash cell beside it. Written against the reserve rather than
    // a literal so it still pins "exactly once" — the scheduled 300 plus the extra, never 300
    // inflated by it.
    expect(data[1].totalExpenses).toBeCloseTo(1000 + 300 + data[1].autoExtraByTarget['sl-1'], 6);
  });
});
