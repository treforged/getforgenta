// Non-CC debt service: the payment leaves projected cash in the SAME pass the balance falls in.
//
// Until 2026-08-24 the two halves were unconnected. `buildNonCCLiabilities` amortized a student
// loan's balance every month as if a payment were being made, while the only non-CC payment that
// actually left projected cash was a mortgage's — so a student loan paid itself down with money
// the forecast never spent, and every month's cash read high by the payment.
//
// The mortgage half had the opposite failure: the cash left, but `liabilityTypes` did not list
// 'mortgage', so the account never reached the liability projection at all.
//
// Would-fail check: drop `otherDebtPayment` from PASS 3's `totalMonthlyOut`/`cashPreDebt` and case
// 1 reports the same ending cash whether or not the loan has a payment; remove 'mortgage' from
// `liabilityTypes` and case 4 shows no liability row for a $250,000 mortgage.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import type { AccountRow, DebtRow, RuleRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

const acct = (over: Record<string, unknown>): AccountRow =>
  ({
    id: 'x', name: 'x', account_type: 'checking', balance: 0, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
    ...over,
  } as unknown as AccountRow);

const rule = (over: Record<string, unknown>): RuleRow =>
  ({
    id: 'r', name: 'r', amount: 0, rule_type: 'expense', frequency: 'monthly', active: true,
    start_date: null, category: 'Bills',
    ...over,
  } as unknown as RuleRow);

const ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

/**
 * `baseExpenses` arrives pre-computed as `forecastMonthEvents[i].expenses` — the engine never
 * re-derives it from `rules`. That is exactly why the dedupe rule exists and why these cases have
 * to state the rule's own cash here as well as in `rules`: an expense rule IS already in this
 * number, so a `debts` row counted on top of it would be the same dollars twice.
 */
function makeInputs(
  accounts: AccountRow[],
  debts: DebtRow[],
  rules: RuleRow[],
  monthlyRuleExpenses: number,
): ForecastInputs {
  return {
    debts, goals: [], carFunds: [],
    accounts,
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules,
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
const STUDENT_LOAN = acct({ id: 'sl-1', name: 'Student Loan', account_type: 'student_loan', balance: 12000 });
/** apr 12 ⇒ 1%/mo: 12000 → 12000 * 1.01 − 300 = 11820. */
const STUDENT_DEBT = { id: 'd1', name: 'Student Loan', balance: 9999, apr: 12, target_payment: 300, min_payment: 250 } as unknown as DebtRow;

const anchor = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
};

const loanRow = (row: ReturnType<typeof calculateForecast>['data'][number], name: string) =>
  row.nonCCLiabBreakdown.find(r => r.name === name);

describe('forecast-engine — non-CC debt service leaves cash and reduces the balance', () => {
  afterEach(() => vi.useRealTimers());

  it('takes a student loan payment out of cash in the same pass its balance falls', () => {
    anchor();
    const paid = calculateForecast(makeInputs([CHK, STUDENT_LOAN], [STUDENT_DEBT], [], 1000));
    // Control: the same loan account with NOTHING paired to it. This is the old behavior for a
    // student loan — a flat, unpaid balance and no cash leaving.
    const unpaired = calculateForecast(makeInputs(
      [CHK, STUDENT_LOAN],
      [{ ...STUDENT_DEBT, name: 'Some Other Debt' } as unknown as DebtRow],
      [], 1000,
    ));

    // Cash half.
    expect(paid.data[1].otherDebtPayment).toBeCloseTo(300, 6);
    expect(paid.data[1].totalExpenses).toBeCloseTo(1000 + 300, 6);
    expect(unpaired.data[1].otherDebtPayment).toBe(0);
    for (const i of [0, 1, 6, 12]) {
      expect(paid.data[i].rawEndingCash).toBeCloseTo(unpaired.data[i].rawEndingCash - 300 * (i + 1), 6);
    }

    // Balance half, same run: the account's balance wins over the stale manual 9999.
    //
    // ⚠️ THESE ARE END-OF-MONTH BALANCES (2026-08-27). The drawer row for month i sits between
    // Total Assets and Net Worth, both of which are month-END, so it prints what the liability
    // CLOSES the month at, not what it opened at. Month 0 therefore reads 12000 * 1.01 − 300 =
    // 11820, one payment in; the 12000 the user sees on /accounts is still `balances[0]`, and
    // `forecast-engine.balanceArrayConvention.test.ts` pins that separately.
    expect(loanRow(paid.data[0], 'Student Loan')?.balance).toBeCloseTo(11820, 6);
    expect(loanRow(paid.data[1], 'Student Loan')?.balance).toBeCloseTo(11638.2, 6);
    expect(loanRow(paid.data[2], 'Student Loan')!.balance).toBeLessThan(11638.2);
  });

  it('lets a matching expense rule be the cash side, so the payment is not taken twice', () => {
    anchor();
    // The user pays this loan through a recurring rule as well as recording it as a debt. The
    // rule's $300 is already inside baseExpenses, so month expenses are 1000 + 300.
    const withRule = calculateForecast(makeInputs(
      [CHK, STUDENT_LOAN],
      [STUDENT_DEBT],
      [rule({ id: 'r1', name: '  student LOAN ', amount: 300 })],
      1300,
    ));
    const withoutRule = calculateForecast(makeInputs([CHK, STUDENT_LOAN], [STUDENT_DEBT], [], 1000));

    // Matched case-insensitively and trimmed, so the debts row contributes no second outflow.
    expect(withRule.data[1].otherDebtPayment).toBe(0);
    expect(withRule.data[1].totalExpenses).toBeCloseTo(1300, 6);
    // $300 leaves either way, never $600: the two runs end every month on the same cash.
    for (const i of [0, 1, 6, 12]) {
      expect(withRule.data[i].rawEndingCash).toBeCloseTo(withoutRule.data[i].rawEndingCash, 6);
    }
    // The balance still amortizes — the dedupe drops the cash term, not the debt. End of month 1,
    // i.e. two payments in: 12000 → 11820 → 11638.20.
    expect(loanRow(withRule.data[1], 'Student Loan')?.balance).toBeCloseTo(11638.2, 6);
    expect(withRule.data[1].rawTotalLiabilities)
      .toBeCloseTo(withoutRule.data[1].rawTotalLiabilities, 6);
  });

  it('still pays the debts row when the same-named rule is switched off', () => {
    anchor();
    // An inactive rule contributes nothing to baseExpenses, so it must not silence the debts row
    // either — that would make the payment vanish from cash entirely.
    const { data } = calculateForecast(makeInputs(
      [CHK, STUDENT_LOAN],
      [STUDENT_DEBT],
      [rule({ id: 'r1', name: 'Student Loan', amount: 300, active: false })],
      1000,
    ));
    expect(data[1].otherDebtPayment).toBeCloseTo(300, 6);
  });

  it('puts a mortgage account in the forecast liabilities, paired, with no duplicate row', () => {
    anchor();
    const { data } = calculateForecast(makeInputs(
      [CHK, acct({ id: 'mtg-1', name: 'Home Loan', account_type: 'mortgage', balance: 250000 })],
      [{ id: 'd2', name: 'Home Loan', balance: 999, apr: 6, target_payment: 1800 } as unknown as DebtRow],
      [], 1000,
    ));

    // ONE row, carried by the ACCOUNT (250000 wins over the manual 999), and the unpaired-debt
    // fallback in non-cc-liabilities.ts adds no second `debt:`-prefixed copy of it.
    // 0.5%/mo, so month 0 CLOSES at 250000 * 1.005 − 1800 = 249450 — see the end-of-month note in
    // the first case above. The row and the total move together, which is the point of this file.
    // Identity asserted exactly, balance to the cent: an amortized closing figure carries float
    // residue (249449.99999999997) that a deep-equal would fail on for no reason a user could see.
    expect(data[0].nonCCLiabBreakdown.map(r => ({ id: r.id, name: r.name, account_type: r.account_type })))
      .toEqual([{ id: 'mtg-1', name: 'Home Loan', account_type: 'mortgage' }]);
    expect(data[0].nonCCLiabBreakdown[0].balance).toBeCloseTo(249450, 6);
    expect(data[0].rawTotalLiabilities).toBeCloseTo(249450, 6);
    // Cash half of the same pairing.
    expect(data[0].otherDebtPayment).toBeCloseTo(1800, 6);
    // End of month 1, two payments in: 249450 * 1.005 − 1800 = 248897.25.
    expect(loanRow(data[1], 'Home Loan')?.balance).toBeCloseTo(248897.25, 6);
  });

  it('leaves an auto loan to car_funds — no debt-service cash on this side', () => {
    anchor();
    // The vehicle loan is owned by `car_funds` and the vehicle-loan engine. Charging its payment
    // here as well would be the double-count this whole file exists to prevent.
    const { data } = calculateForecast(makeInputs(
      [CHK, acct({ id: 'al-1', name: 'FIXED RATE LOAN', account_type: 'auto_loan', balance: 20000 })],
      [{ id: 'd3', name: 'FIXED RATE LOAN', balance: 20000, apr: 5, target_payment: 450 } as unknown as DebtRow],
      [], 1000,
    ));
    expect(data[1].otherDebtPayment).toBe(0);
    // End of month 0, 5%/12 on 20000 less the paired row's 450 target: 19633.33 — see the
    // end-of-month note in the first case above.
    //
    // ⚠️ NOT A CLAIM THAT THIS IS RIGHT, only what it does. `buildNonCCLiabilities` amortizes this
    // account at the paired debts row's target payment while `sumOtherDebtPayments` deliberately
    // charges no cash for it (an `auto_loan` belongs to `car_funds`) — so with no car fund linked,
    // the balance falls with nothing leaving checking. That is the same defect this file's header
    // records for student loans, on the one account type the cash half excludes, and it predates
    // the end-of-month change: it simply becomes visible one month earlier. Out of scope here.
    expect(loanRow(data[0], 'FIXED RATE LOAN')?.balance).toBeCloseTo(19633.333333, 5);
  });
});
