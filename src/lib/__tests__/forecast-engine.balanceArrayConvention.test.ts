// MEASUREMENT FIRST, THEN THE REGRESSIONS THE MEASUREMENTS EARNED.
//
// `carLoanBalancesByFundId` / `nonCCLiabilityBalancesById` are SEEDED as the balance a month OPENS
// at and REDUCED from index `i` INCLUSIVE by the ranked extras. A previous session proposed
// "seed endBalance instead". This file measured, per consuming surface, what index `i` actually
// holds and what that surface's own on-screen label asks for, so the question could be settled
// with numbers rather than with a reading of the comments.
//
// The verdict (2026-08-27): the SEED is right — `balances[0]` is the bank's own figure and the
// Garage card, /accounts and the exposed arrays all need it. What was wrong was three EMISSION
// sites reading that opening balance where the surface around them is end-of-month, plus a
// scheduled payment that outlived the balance it was paying. Both are fixed; the tests below
// that say FIXED carry the before/after numbers.
//
// Every number these tests print was produced by running the real `calculateForecast` and the real
// `buildAmortizationSchedule` against the C5 fixture the sibling tests already use.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { PROJECTION_MONTHS } from '@/lib/credit-card-engine';
import { buildAmortizationSchedule } from '@/lib/vehicle-loan-engine';
import { buildAutoExtraByTarget } from '@/lib/auto-extra-projection';
import { extraAwarePayoffMonthIndex } from '@/lib/extra-aware-payoff';
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

/** Tre's actual C5 — the same fixture `forecast-engine.extrasPayoffReadout.test.ts` uses. */
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

const loanInputs = (fund: CarFund, cash: number) => makeInputs(
  [acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: cash })], [], 0,
  {
    carFunds: [fund], cardProjectionData: CARD_PROJECTION,
    payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
    forecastMonthEvents: [],
  },
);

/** The `LoanInput` the Garage card builds for the SAME fund, so the schedule under measurement is
 *  literally the one on screen. */
const scheduleInput = (fund: CarFund) => ({
  loanAmount: Number(fund.loan_amount),
  apr: Number(fund.expected_apr),
  termMonths: Number(fund.loan_term_months),
  loanStartDate: fund.loan_start_date as string,
  paymentStartDate: fund.payment_start_date as string,
  interestStartDate: (fund.interest_start_date ?? fund.payment_start_date) as string,
  actualMonthlyPayment: Number(fund.actual_monthly_payment),
  lumpSumPayments: fund.lump_sum_payments ?? [],
  currentBalance: (fund as { current_balance_override?: number | null }).current_balance_override ?? null,
});

const firstZero = (b: readonly number[]) => b.findIndex(v => v <= 0);

describe('balance-array convention — what each consumer actually gets at index i', () => {
  afterEach(() => vi.useRealTimers());

  it('MONTH 0: the seed is what the loan is owed TODAY — the same figure the Garage card, the '
    + 'Accounts page and the bank all print. Seeding endBalance would understate it by one '
    + "month's principal", () => {
    const fund = c5({ current_balance_override: 15_900 });
    anchor();
    const res = calculateForecast(loanInputs(fund, 30_000));
    const proj = buildAmortizationSchedule(scheduleInput(fund));
    const balances = res.carLoanBalancesByFundId.get('c5')!;

    const openRow = proj.schedule[proj.monthsElapsed];
    console.log('[M1] monthsElapsed        =', proj.monthsElapsed);
    console.log('[M1] balances[0]          =', balances[0]);
    console.log('[M1] proj.remainingBalance=', proj.remainingBalance, '  <- "X remaining" on the Garage card');
    console.log('[M1] row.startBalance     =', openRow.startBalance);
    console.log('[M1] row.endBalance       =', openRow.endBalance, ' <- what an endBalance seed would put at index 0');
    console.log('[M1] delta (one principal)=', +(openRow.startBalance - openRow.endBalance).toFixed(2));

    // What the app shows as "what you owe" today IS the opening balance, and the live-balance
    // splice lands on it, so month 0 reads the bank's own figure to the cent.
    expect(balances[0]).toBeCloseTo(15_900, 2);
    expect(balances[0]).toBeCloseTo(proj.remainingBalance, 2);
    expect(openRow.endBalance).toBeLessThan(balances[0]);
  });

  it('THE GARAGE CHART: its two series carry DIFFERENT conventions — "Remaining" is endBalance, '
    + '"With auto extra" is the engine array\'s opening balance, so the dashed line sits one '
    + "month's principal ABOVE the solid one in every month before an extra lands", () => {
    const fund = c5({ auto_extra: true });
    anchor();
    const res = calculateForecast(loanInputs(fund, 30_000));
    const extraBalances = res.carLoanBalancesByFundId.get('c5')!;
    const extras = buildAutoExtraByTarget(res.data).get('c5') ?? [];
    const effective = buildAmortizationSchedule(scheduleInput(fund));

    // Vehicles.tsx:650-660, verbatim.
    const n = new Date();
    const nowBaseMonth = n.getFullYear() * 12 + n.getMonth();
    const chartData = effective.schedule.map(r => {
      const d = new Date(r.date + 'T00:00:00');
      const idx = (d.getFullYear() * 12 + d.getMonth()) - nowBaseMonth;
      const autoBalance = idx >= 0 && idx < extraBalances.length ? extraBalances[idx] : undefined;
      return { date: r.date, idx, balance: r.endBalance, autoBalance, principal: r.principal };
    });

    const firstExtraMonth = extras.findIndex(v => v > 0);
    expect(firstExtraMonth).toBeGreaterThan(0);
    const pts = chartData.filter(p => p.idx >= 0 && p.idx < firstExtraMonth);
    expect(pts.length).toBeGreaterThan(0);
    console.log('[M2] first month an extra lands: idx', firstExtraMonth);
    for (const p of pts) {
      console.log(`[M2] ${p.date} idx=${p.idx}  solid(endBalance)=${p.balance}  dashed(engine)=${p.autoBalance}`
        + `  gap=${(Number(p.autoBalance) - p.balance).toFixed(2)}  thisMonthPrincipal=${p.principal}`);
    }
    // The gap is exactly that month's scheduled principal, and it has the WRONG sign for a line
    // whose legend says "With auto extra": the accelerated plan is drawn above the un-accelerated
    // one until the first extra arrives.
    for (const p of pts) {
      expect(Number(p.autoBalance) - p.balance).toBeCloseTo(p.principal, 2);
      expect(Number(p.autoBalance)).toBeGreaterThan(p.balance);
    }
  });

  it('THE FORECAST DRAWER: FIXED 2026-08-27 — its liability line is now month-END, the same '
    + 'convention as the cash and asset lines it sits between, so Net Worth no longer subtracts '
    + 'the loan payment from cash AND carries the balance that payment retired', () => {
    const fund = c5({});
    anchor();
    const res = calculateForecast(loanInputs(fund, 30_000));
    const proj = buildAmortizationSchedule(scheduleInput(fund));
    const rows = res.data;

    for (const i of [0, 1, 2]) {
      const drawer = rows[i].carLoanBreakdown.find(r => r.name === '2004 Chevrolet C5')!;
      const schedRow = proj.schedule[proj.monthsElapsed + i];
      console.log(`[M3] month ${i}  drawer="${drawer.balance}"  sched.start=${schedRow.startBalance}`
        + `  sched.end=${schedRow.endBalance}  principalPaidThisMonth=${schedRow.principal}`);
      // WAS `schedRow.startBalance` — the defect. The drawer row is printed between "Total Assets"
      // and "Net Worth", both of which are end-of-month, so it prints the end-of-month balance.
      expect(drawer.balance).toBeCloseTo(schedRow.endBalance, 2);
      expect(drawer.balance).toBeLessThan(schedRow.startBalance);
    }
    // The proof that the pairing is now consistent: month 0's ending cash is 422.89 lighter than
    // the 30,000 it opened at (the loan payment left), and its loan line has fallen by that
    // payment's principal in the same row. Net Worth is one principal HIGHER than it used to be,
    // which is the understatement being corrected.
    const principal0 = proj.schedule[proj.monthsElapsed].principal;
    console.log('[M3] month 0 endingCash =', rows[0].endingCash, ' (opened at 30,000; payment 422.89 has left)');
    console.log('[M3] month 0 netWorth   =', rows[0].netWorth, ' | month-0 principal =', principal0);
    expect(rows[0].endingCash).toBeLessThan(30_000);
    // Net worth reconciles by hand: cash + every asset − every liability, all end-of-month.
    expect(rows[0].rawNetWorth).toBeCloseTo(
      rows[0].rawTotalAssets - proj.schedule[proj.monthsElapsed].endBalance, 2,
    );
    // The total equals the rows the drawer prints under it — the invariant that forces the
    // itemised lines to move with `totalLiabilities` rather than lag it by a month.
    expect(rows[0].rawTotalLiabilities).toBeCloseTo(
      rows[0].carLoanBreakdown.reduce((s, r) => s + r.balance, 0)
        + rows[0].nonCCLiabBreakdown.reduce((s, r) => s + r.balance, 0)
        + (rows[0].rawCcDisplayBalance ?? 0), 2,
    );
  });

  it('MONTH 0 IS STILL THE LIVE FIGURE WHERE IT HAS TO BE: the seed, and therefore the Garage '
    + "card, /accounts and the exposed array, are untouched by the drawer's end-of-month move", () => {
    const fund = c5({ current_balance_override: 15_900 });
    anchor();
    const res = calculateForecast(loanInputs(fund, 30_000));
    const proj = buildAmortizationSchedule(scheduleInput(fund));
    const balances = res.carLoanBalancesByFundId.get('c5')!;
    const drawer = res.data[0].carLoanBreakdown.find(r => r.name === '2004 Chevrolet C5')!;

    console.log('[M3b] balances[0]      =', balances[0], ' <- bank / Garage card / /accounts');
    console.log('[M3b] drawer month 0   =', drawer.balance, ' <- end of October');
    console.log('[M3b] startingCash     =', res.data[0].startingCash, ' <- the live bank cash');
    console.log('[M3b] array length     =', balances.length);
    expect(balances[0]).toBeCloseTo(15_900, 2);
    expect(balances[0]).toBeCloseTo(proj.remainingBalance, 2);
    // Cash: month 0 still opens on the live bank balance, to the cent.
    expect(res.data[0].startingCash).toBeCloseTo(30_000, 2);
    // The drawer is one month's principal below it, and that is the whole of the change.
    expect(drawer.balance).toBeCloseTo(proj.schedule[proj.monthsElapsed].endBalance, 2);
    // One entry past the horizon, so the last projected month has a closing balance to read
    // rather than an invented one. `closingBalanceAt` depends on this.
    expect(balances.length).toBe(PROJECTION_MONTHS + 1);
    expect(res.nonCCLiabilityBalancesById.size).toBe(0);
  });

  it('THE RANKED CAPACITY READ: FIXED 2026-08-27 — capacity is what the loan can still ABSORB '
    + 'after its own scheduled payment (its closing balance), not what it opened owing, so the '
    + 'clearing month no longer sends principal the scheduled payment was already retiring', () => {
    const fund = c5({ auto_extra: true });
    anchor();
    const off = calculateForecast(loanInputs(c5({ auto_extra: false }), 300_000));
    anchor();
    const on = calculateForecast(loanInputs(fund, 300_000));
    const before = off.carLoanBalancesByFundId.get('c5')!;
    const after = on.carLoanBalancesByFundId.get('c5')!;
    const extras = buildAutoExtraByTarget(on.data).get('c5') ?? [];

    const lastExtraMonth = extras.reduce((last, v, i) => (v > 0 ? i : last), -1);
    expect(lastExtraMonth).toBeGreaterThan(0);
    const cumBefore = extras.slice(0, lastExtraMonth).reduce((s, v) => s + v, 0);
    // No clamping happened before the clearing month, so the prior extras are a clean constant
    // offset and the pre-reduction figures are recoverable.
    expect(before[lastExtraMonth] - after[lastExtraMonth]).toBeCloseTo(cumBefore + extras[lastExtraMonth], 2);

    const openingAtM = before[lastExtraMonth] - cumBefore;         // capacity the engine offered
    const absorbableAtM = Math.max(0, before[lastExtraMonth + 1] - cumBefore); // left after the scheduled payment
    const sent = extras[lastExtraMonth];
    console.log('[M4] clearing month idx      =', lastExtraMonth);
    console.log('[M4] capacity offered (open) =', openingAtM.toFixed(2));
    console.log('[M4] absorbable after payment=', absorbableAtM.toFixed(2));
    console.log('[M4] extra actually sent     =', sent.toFixed(2));
    console.log('[M4] over-allocation         =', Math.max(0, sent - absorbableAtM).toFixed(2));
    console.log('[M4] array after reduction   =', after[lastExtraMonth], after[lastExtraMonth + 1]);
    // The whole `sent` really did leave checking — it is not clamped to what the balance absorbed.
    const cashGap = off.data[lastExtraMonth].endingCash - on.data[lastExtraMonth].endingCash;
    console.log('[M4] endingCash off - on     =', cashGap, '(vs extras sent so far',
      extras.slice(0, lastExtraMonth + 1).reduce((s, v) => s + v, 0).toFixed(2), ')');
    console.log('[M4] carLoanPayment at idx', lastExtraMonth, '=', on.data[lastExtraMonth].carLoanPayment,
      '| at idx', lastExtraMonth + 1, '=', on.data[lastExtraMonth + 1].carLoanPayment,
      '| at idx', lastExtraMonth + 6, '=', on.data[lastExtraMonth + 6].carLoanPayment);

    // WAS `sent <= openingAtM` and measured $289.92 of over-allocation inside that bound. The
    // capacity is now the closing balance, so the extra is exactly what is left after the month's
    // own $422.89 goes out — no dollar leaves checking for principal that was already retiring.
    expect(sent).toBeCloseTo(absorbableAtM, 2);
    expect(Math.max(0, sent - absorbableAtM)).toBeLessThan(0.01);
    expect(sent).toBeLessThan(openingAtM);
    // The loan is genuinely cleared by the end of that month, and stays cleared.
    expect(after[lastExtraMonth + 1]).toBeCloseTo(0, 2);
    // Cash still falls by every dollar sent — the fix reduces what is SENT, it does not lose track
    // of it. (Compared loosely: the two runs' floors and card blocks differ slightly by month.)
    expect(cashGap).toBeGreaterThan(0);
  });

  it('THE NON-CC LIABILITY ARRAY: index 0 is the account balance the user can see on /accounts, '
    + 'and the /debt "with extra payments" readout is a COUNT of months that only comes out right '
    + 'on an opening-seeded array', () => {
    const student = acct({ id: 'sl-1', name: 'Student Loan', account_type: 'student_loan', balance: 12_000 });
    const debt = { id: 'd1', name: 'Student Loan', balance: 12_000, apr: 12, target_payment: 300 } as unknown as DebtRow;
    anchor();
    const res = calculateForecast(makeInputs(
      [acct({ id: 'chk-1', name: 'Checking', account_type: 'checking', balance: 20_000 }), student],
      [debt], 1_000,
    ));
    const balances = res.nonCCLiabilityBalancesById.get('sl-1')!;
    console.log('[M6] balances[0..3] =', balances.slice(0, 4).map(v => +v.toFixed(2)).join(', '));
    console.log('[M6] accounts.balance (what /accounts shows today) =', 12_000);
    console.log('[M6] drawer month 0 =', res.data[0].nonCCLiabBreakdown.find(r => r.id === 'sl-1')!.balance);
    console.log('[M6] an endBalance seed would put', +balances[1].toFixed(2), 'at index 0');
    expect(balances[0]).toBeCloseTo(12_000, 6);
    // 12000 * 1.01 - 300 = 11820 — index 1 is what month 0 CLOSES at, i.e. exactly the value an
    // endBalance seed would shift into index 0.
    expect(balances[1]).toBeCloseTo(11_820, 6);
  });

  it('THE PAYOFF-DATE LABEL, no extras: `firstZero - 1` on an OPENING-seeded array names exactly '
    + "the schedule's final payment month — the offset is right, the convention is not the "
    + 'problem here', () => {
    const fund = c5({ auto_extra: false });
    anchor();
    const res = calculateForecast(loanInputs(fund, 30_000));
    const balances = res.carLoanBalancesByFundId.get('c5')!;
    const proj = buildAmortizationSchedule(scheduleInput(fund));

    const n = new Date();
    const idx = extraAwarePayoffMonthIndex(balances, null)!;
    const labelDate = new Date(n.getFullYear(), n.getMonth() + idx, 1);
    const labelKey = `${labelDate.getFullYear()}-${String(labelDate.getMonth() + 1).padStart(2, '0')}`;
    console.log(`[M5a] firstZero=${firstZero(balances)}  helper idx=${idx}  label=${labelKey}`
      + `  schedule final payment=${proj.payoffDate.substring(0, 7)}`
      + `  (an endBalance seed would put the same month at firstZero, not firstZero-1)`);
    expect(labelKey).toBe(proj.payoffDate.substring(0, 7));
  });

  it('THE PAYOFF-DATE LABEL, with extras: the engine array does NOT re-amortize, so the big date '
    + 'on the Garage card and the amortization TABLE directly beneath it are two different models '
    + '— measured here, not asserted equal', () => {
    for (const [label, cash] of [['modest surplus', 30_000], ['large surplus', 300_000]] as const) {
      anchor();
      const fund = c5({ auto_extra: true });
      const res = calculateForecast(loanInputs(fund, cash));
      const balances = res.carLoanBalancesByFundId.get('c5')!;
      const extras = buildAutoExtraByTarget(res.data).get('c5') ?? [];

      // Vehicles.tsx:589-616 — the schedule the amortization TABLE under the chart shows.
      const n = new Date();
      const autoExtraByMonth: Record<string, number> = {};
      extras.forEach((amount, i) => {
        if (!(amount > 0)) return;
        const d = new Date(n.getFullYear(), n.getMonth() + i, 1);
        autoExtraByMonth[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = amount;
      });
      const table = buildAmortizationSchedule({ ...scheduleInput(fund), autoExtraByMonth });

      const idx = extraAwarePayoffMonthIndex(balances, extras)!;
      const labelDate = new Date(n.getFullYear(), n.getMonth() + idx, 1);
      const labelKey = `${labelDate.getFullYear()}-${String(labelDate.getMonth() + 1).padStart(2, '0')}`;
      const tableKey = table.payoffDate.substring(0, 7);
      const naiveIdx = firstZero(balances) - 1;
      const naiveDate = new Date(n.getFullYear(), n.getMonth() + naiveIdx, 1);
      const naiveKey = `${naiveDate.getFullYear()}-${String(naiveDate.getMonth() + 1).padStart(2, '0')}`;

      console.log(`[M5b] ${label}: firstZero=${firstZero(balances)}  helper idx=${idx}`
        + `  card label=${labelKey}  naive(firstZero-1)=${naiveKey}  TABLE final payment=${tableKey}`);
      // The engine array is deliberately conservative (balance reduced, never re-amortized), so
      // its date can only ever be the same or LATER than the re-amortized table's.
      expect(labelKey >= tableKey).toBe(true);
    }
  });
});

// ── DEFECT 1: THE FORECAST KEPT PAYING A LOAN IT SAID WAS ALREADY GONE ───────
//
// Verified on Tre's live data 2026-08-27: the /forecast drawer for Oct 2029 — two months after the
// C5's own projected Aug 2029 payoff — still listed "Car Loan Payments $422.89", and kept listing
// it for the ~10 months to the schedule's original end. About $4,200 of cash removed for a debt
// the same screen said was cleared. `carLoanPayment` is priced off the amortization schedule while
// `carLoanBalancesByFundId` is reduced by the ranked extras; both cannot be true.
//
// WOULD-FAIL CHECK (run it before trusting this file): in `forecast-engine.ts`, change
// `const carLoanThisMonth = activeCarLoanByMonth[i] - clearedLoanPaymentThisMonth;`
// back to `= activeCarLoanByMonth[i];` and "stops charging" below fails on the very first
// post-payoff month, reporting 422.89 where it wants 0.

describe('a cleared vehicle loan stops being charged', () => {
  afterEach(() => vi.useRealTimers());

  /** Enough cash that the ranked waterfall clears the C5 within a handful of months, so the
   *  post-payoff tail is long and unambiguous — the fixture's stand-in for Oct 2029. */
  const clearEarly = () => {
    anchor();
    return calculateForecast(loanInputs(c5({ auto_extra: true }), 300_000));
  };

  it('stops charging the scheduled payment from the first month the balance reads zero, and '
    + 'keeps charging it in every month the loan still owes something', () => {
    const on = clearEarly();
    const balances = on.carLoanBalancesByFundId.get('c5')!;
    const clearedFrom = firstZero(balances);   // first month that OPENS owing nothing
    expect(clearedFrom).toBeGreaterThan(0);

    console.log('[D1] first month opening at zero  =', clearedFrom);
    for (const i of [clearedFrom - 1, clearedFrom, clearedFrom + 1, clearedFrom + 6, clearedFrom + 10]) {
      console.log(`[D1] idx ${i}: opening=${balances[i]?.toFixed(2)}  carLoanPayment=${on.data[i].carLoanPayment}`);
    }

    // Still owed → still charged, at the schedule's own figure.
    expect(on.data[clearedFrom - 1].carLoanPayment).toBeCloseTo(422.89, 2);
    // Nothing owed → nothing charged, that month and every month after, for the whole of what
    // would have been the remaining term.
    for (let i = clearedFrom; i < PROJECTION_MONTHS; i++) {
      expect(on.data[i].carLoanPayment).toBe(0);
    }
    // And it is not just the drawer line: the cash actually stays in checking. Against the same
    // fixture with the loan untouched, the post-payoff months no longer differ by the payment.
    anchor();
    const off = calculateForecast(loanInputs(c5({ auto_extra: false }), 300_000));
    const stillCharged = off.data[clearedFrom + 6].carLoanPayment;
    console.log('[D1] unaccelerated control still pays at idx', clearedFrom + 6, '=', stillCharged);
    expect(stillCharged).toBeCloseTo(422.89, 2);
  });

  it('leaves the payment alone while the loan has any balance at all — the suppression is keyed '
    + 'to the balance, not to a payoff flag that could go stale', () => {
    anchor();
    // No auto-extra: the loan runs its full 48-month schedule, so every month inside the term is
    // charged and every month past it is not, exactly as before this fix existed.
    const off = calculateForecast(loanInputs(c5({ auto_extra: false }), 30_000));
    const balances = off.carLoanBalancesByFundId.get('c5')!;
    const scheduleEnds = firstZero(balances);
    expect(scheduleEnds).toBeGreaterThan(30);
    console.log('[D1b] unaccelerated schedule opens at zero from idx', scheduleEnds);
    for (let i = 0; i < scheduleEnds - 1; i++) {
      expect(off.data[i].carLoanPayment).toBeGreaterThan(0);
    }
    // The final row is the schedule's own true-up, which is smaller than 422.89 and must survive.
    expect(off.data[scheduleEnds - 1].carLoanPayment).toBeGreaterThan(0);
    expect(off.data[scheduleEnds - 1].carLoanPayment).toBeLessThanOrEqual(422.89);
    expect(off.data[scheduleEnds].carLoanPayment).toBe(0);
  });

  it('FIXED: a loan whose first payment is still in the future no longer runs its balance array a '
    + 'month ahead of its payments', () => {
    // THE DEFECT, measured on the real captured fixture (2026-07-20 capture, C5's first payment
    // 2026-08-07). `buildAmortizationSchedule` clamps monthsElapsedRaw with Math.max(0,…) because
    // that figure counts PAYMENTS MADE, and the seed then did `schedule[monthsElapsed + i]` — so
    // month i got the row belonging to month i + 1 and the whole array ran a month ahead of the
    // payments the engine charges (those key off the calendar month and were never shifted). Its
    // last entry read zero while a real final payment was still owed that month.
    //
    // FIXED by seeding off `scheduleOffset`, the unclamped twin (-1 here). Months before the first
    // payment now read the loan's OPENING balance rather than the next row's, which is what a
    // disbursed, not-yet-amortizing loan actually owes.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));   // BEFORE the 2026-08-07 first payment
    const fund = c5({ auto_extra: false });
    const res = calculateForecast(loanInputs(fund, 30_000));
    const balances = res.carLoanBalancesByFundId.get('c5')!;
    const proj = buildAmortizationSchedule(scheduleInput(fund));

    expect(proj.monthsElapsed).toBe(0);          // no payment has been made...
    expect(proj.scheduleOffset).toBe(-1);        // ...and row 0 belongs to NEXT month.
    expect(proj.schedule[0].date.substring(0, 7)).toBe('2026-08');

    // Month 0 owes the opening balance in full — nothing has been paid yet. The OLD seed showed
    // row 1's balance here, i.e. a payment that has not happened.
    expect(balances[0]).toBeCloseTo(proj.schedule[0].startBalance, 2);
    expect(balances[0]).toBeGreaterThan(proj.schedule[1].startBalance);
    // ...and every later month is the row for that same calendar month.
    for (let i = 1; i < 6; i++) {
      expect(balances[i]).toBeCloseTo(proj.schedule[i - 1].startBalance, 2);
    }

    // The array and the payments now agree about the FINAL month: the last row is dated in forecast
    // month `schedule.length`, the balance there is still positive, and the payment is charged.
    const arrayZeroFrom = firstZero(balances);
    console.log('[D1c] schedule.length =', proj.schedule.length, ' array first zero =', arrayZeroFrom,
      ' payment at last owed idx =', res.data[arrayZeroFrom - 1].carLoanPayment);
    expect(arrayZeroFrom).toBe(proj.schedule.length + 1);
    expect(res.data[arrayZeroFrom - 1].carLoanPayment).toBeGreaterThan(0);
    expect(Object.keys(res.data[arrayZeroFrom - 1].autoExtraByTarget)).not.toContain('c5');
    // One month past the last row there is nothing owed and nothing charged, as always.
    expect(balances[arrayZeroFrom]).toBe(0);
    expect(res.data[arrayZeroFrom].carLoanPayment).toBe(0);
  });
});
