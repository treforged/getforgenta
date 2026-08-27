// MEASUREMENT ONLY — no engine or UI behaviour is changed by this file.
//
// `carLoanBalancesByFundId` / `nonCCLiabilityBalancesById` are SEEDED as the balance a month OPENS
// at and REDUCED from index `i` INCLUSIVE by the ranked extras. A previous session proposed
// "seed endBalance instead". This file measures, per consuming surface, what index `i` actually
// holds today and what that surface's own on-screen label asks for, so the question can be settled
// with numbers rather than with a reading of the comments.
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

  it('THE FORECAST DRAWER: its liability line is month-OPENING while the cash and asset lines '
    + 'beside it are month-END, so month i\'s Net Worth subtracts the loan payment from cash and '
    + 'still carries the balance it paid down', () => {
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
      expect(drawer.balance).toBeCloseTo(schedRow.startBalance, 2);
    }
    // The drawer's own cash line for the same month is END-of-month: month 0's ending cash is
    // already 422.89 lighter than the 30,000 it started with (the loan payment left), while its
    // loan line has not moved. Net Worth therefore double-counts the principal.
    console.log('[M3] month 0 endingCash =', rows[0].endingCash, ' (opened at 30,000; payment 422.89 has left)');
    console.log('[M3] month 0 netWorth   =', rows[0].netWorth,
      ' | with an end-of-month loan line it would be', Math.round(rows[0].netWorth + proj.schedule[proj.monthsElapsed].principal));
    expect(rows[0].endingCash).toBeLessThan(30_000);
  });

  it('THE RANKED CAPACITY READ: `capacity = balances[i]` offers the OPENING balance, so in the '
    + 'clearing month the waterfall can send more principal than the loan can absorb after its '
    + 'own scheduled payment — cash leaves checking for the whole amount', () => {
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
    // And the scheduled payment keeps being charged after the array reads zero, because the
    // amortization schedule — not the reduced array — is what prices the monthly expense.
    console.log('[M4] carLoanPayment at idx', lastExtraMonth + 1, '=', on.data[lastExtraMonth + 1].carLoanPayment,
      '| at idx', lastExtraMonth + 6, '=', on.data[lastExtraMonth + 6].carLoanPayment);
    expect(sent).toBeLessThanOrEqual(openingAtM + 0.01);
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
