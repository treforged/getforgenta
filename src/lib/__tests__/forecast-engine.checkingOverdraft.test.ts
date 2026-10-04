/**
 * A CHECKING ACCOUNT THAT IS NOT THE FUNDING ACCOUNT CANNOT GO NEGATIVE WITH NOBODY PAYING THE GAP.
 *
 * Ask e2f7101f. Step 4b-iii pays the part of an account-paid expense its account cannot cover from
 * the FUNDING checking (f3c0cdf5), but it only looked in the savings, investment and retirement
 * maps. A bill paid out of a SECOND checking account was debited in the asset tracker with no clamp
 * and no remainder, so the account went negative and nobody paid the difference. Measured on Tre's
 * 2026-10-04 dump: "General Operations" ($134, $161/mo of bills) read -$6.77 in Oct 2026 and
 * -$250.37 in Feb 2027. Same "money vanishes" shape as e3566eab / f3c0cdf5.
 *
 * The rule pinned here is the savings rule, unchanged: the account pays what it holds, floors at 0,
 * and the rest comes out of the funding checking, ONCE, through `unfundedAccountOutflow` (so the
 * cash chain, the sim's card budget and the milestone all see the same dollars).
 *
 * Month 0 counts only the occurrences still to come after the sync date. Before this, a bill
 * already in the synced balance was debited again; with the remainder now paid from checking, that
 * double count would have become a real charge (Tre's -$6.77 October was $7 of exactly that).
 *
 * SYNTHETIC DATA ONLY. Zero income, zero growth, no cards, so a cash difference can only be the
 * remainder being paid.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { AssumptionsType } from '@/contexts/CardProjectionContext';

const acct = (over: Record<string, unknown>): AccountRow =>
  ({
    id: 'x', name: 'x', account_type: 'checking', balance: 0, active: true,
    apy_rate: null, card_start_date: null, statement_balance: null,
    ...over,
  } as unknown as AccountRow);

const GENOPS_BAL = 134;
const BILL = 161;
const FUNDING = acct({ id: 'chk-1', name: 'CHASE CHECKING', account_type: 'checking', balance: 20_000 });
const genOpsAcct = (balance: number) =>
  acct({ id: 'chk-2', name: 'General Operations', account_type: 'checking', balance });

const ASSUMPTIONS: AssumptionsType = {
  incomeGrowthEnabled: false, incomeGrowth: 0, raiseMonth: 3, raiseMode: 'pct',
  investmentGrowth: 0, savingsInterest: 0,
  bonusEnabled: false, bonusAmount: 0, bonusMode: 'flat', bonusMonth: 12, bonusRecurring: true,
  taxReturnEnabled: false, taxReturnFilingStatus: 'single', taxReturnDependents: 0,
  taxReturnState: 'FL', taxReturnFederalWithheld: 0, taxReturnMonth: 2, taxReturnAmountOverride: 0,
  promotions: [],
};

// Due on the 20th, after the sync date, so month 0's occurrence is still to come.
const BILL_RULE = [{
  id: 'r-genops', name: 'Business bills', rule_type: 'expense', amount: BILL, active: true,
  frequency: 'monthly', due_day: 20, payment_source: 'account:chk-2',
  category: 'Bills', start_date: null, end_date: null,
}] as unknown as ForecastInputs['rules'];

function makeInputs(genOpsBalance: number, withBill: boolean): ForecastInputs {
  return {
    debts: [], goals: [], carFunds: [],
    accounts: [FUNDING, genOpsAcct(genOpsBalance)],
    budgetItems: [],
    profile: { tax_rate: 0, paycheck_deductions: [] as never },
    assumptions: ASSUMPTIONS,
    rules: withBill ? BILL_RULE : [],
    monthlyAggregates: {} as ForecastInputs['monthlyAggregates'],
    debtPaymentsByMonth: {} as ForecastInputs['debtPaymentsByMonth'],
    debtBalancesByMonth: [] as unknown as ForecastInputs['debtBalancesByMonth'],
    cardProjectionData: null,
    payConfig: { weeklyGross: 0, taxRate: 0, paycheckDay: 1, frequency: 'monthly' },
    oneTimeByMonth: {}, ccOneTimeByMonth: {}, ccScheduledByMonth: [],
    transactions: [],
    currentMonthRecommendedDebt: null,
    forecastMonthEvents: [],
    forecastFundingAccountId: 'chk-1',
    cashFloor: 0,
    pauseSavings: false,
    syncCutoffDate: '2026-10-15',
    planExpensesByMonth: [],
    annualFederalWithheldFromBudget: 0,
  };
}

function run(genOpsBalance: number, withBill: boolean) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00'));
  const out = calculateForecast(makeInputs(genOpsBalance, withBill));
  vi.useRealTimers();
  return out;
}

const genOps = (row: { assetBreakdown: { id: string; balance: number }[] }) =>
  row.assetBreakdown.find(a => a.id === 'chk-2')!.balance;

describe('forecast-engine - a bill paid from a non-funding checking account', () => {
  afterEach(() => vi.useRealTimers());

  it('never takes that account below 0', () => {
    const out = run(GENOPS_BAL, true);
    // Month 0 pays $134 of the $161 bill and the account is then empty for good: nothing refills it.
    expect(genOps(out.data[0])).toBe(0);
    for (const r of out.data) expect(genOps(r), r.month).toBeGreaterThanOrEqual(0);
  });

  it('pays the uncovered part from the funding checking, exactly once', () => {
    const base = run(GENOPS_BAL, false);
    const out = run(GENOPS_BAL, true);
    // First uncovered month (Oct 2026): $161 bill - $134 in the account = $27.00.
    expect(base.data[0].rawEndingCash - out.data[0].rawEndingCash).toBeCloseTo(27, 2);
    expect(out.data[0].unfundedAccountOutflow).toBeCloseTo(27, 2);
    // Every later month the account is empty, so the whole $161 comes from checking: once, not twice.
    expect(out.data[1].unfundedAccountOutflow).toBeCloseTo(BILL, 2);
    expect(base.data[1].rawEndingCash - out.data[1].rawEndingCash).toBeCloseTo(27 + BILL, 2);
    expect(base.data[11].rawEndingCash - out.data[11].rawEndingCash).toBeCloseTo(27 + BILL * 11, 2);
  });

  it('names the shortfall in the milestones', () => {
    const out = run(GENOPS_BAL, true);
    const hit = out.milestones.find(m => m.month === out.data[0].month && m.event.includes('more than its account holds'));
    expect(hit?.event).toContain('$27 must come from checking');
  });

  it('names it ONCE per run of short months, not every month', () => {
    const out = run(GENOPS_BAL, true);
    // Every month is short (the account is never refilled), so this is one run: one warning.
    const hits = out.milestones.filter(m => m.event.includes('more than its account holds'));
    expect(out.data.filter(r => (r.unfundedAccountOutflow ?? 0) > 0.005).length).toBeGreaterThan(10);
    expect(hits.map(m => m.month)).toEqual([out.data[0].month]);
  });

  it('an account that is ALREADY overdrawn keeps its overdraft, and every bill comes from checking', () => {
    const base = run(-50, false);
    const out = run(-50, true);
    // Flooring it to 0 would erase $50 the user owes the bank.
    expect(genOps(out.data[3])).toBeCloseTo(-50, 2);
    expect(out.data[0].unfundedAccountOutflow).toBeCloseTo(BILL, 2);
    expect(base.data[3].rawEndingCash - out.data[3].rawEndingCash).toBeCloseTo(BILL * 4, 2);
  });

  it('does not debit a month-0 bill dated on or before the sync date: the balance already paid it', () => {
    // Tre's dump: a Google Workspace bill paid Oct 1 (sync Oct 3) was debited again, so General
    // Operations read -$6.77 for October when it really ends at +$0.23. Here: due the 5th, sync the 15th.
    const early = [{ ...(BILL_RULE[0] as object), due_day: 5 }] as unknown as ForecastInputs['rules'];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00'));
    const out = calculateForecast({ ...makeInputs(GENOPS_BAL, true), rules: early });
    vi.useRealTimers();
    expect(genOps(out.data[0])).toBeCloseTo(GENOPS_BAL, 2);
    expect(out.data[0].unfundedAccountOutflow).toBe(0);
    // November's occurrence is still to come: $134 pays $134 of it and $27 comes from checking.
    expect(genOps(out.data[1])).toBe(0);
    expect(out.data[1].unfundedAccountOutflow).toBeCloseTo(27, 2);
  });

  it('control: an account that CAN cover the bill costs the funding checking nothing', () => {
    const base = run(10_000, false);
    const out = run(10_000, true);
    expect(out.data[5].rawEndingCash).toBeCloseTo(base.data[5].rawEndingCash, 2);
    expect(out.data.every(r => (r.unfundedAccountOutflow ?? 0) === 0)).toBe(true);
    // The account itself still pays the bill: $161 a month, six months in = 6 occurrences.
    expect(genOps(out.data[5])).toBeCloseTo(10_000 - BILL * 6, 2);
    expect(out.milestones.some(m => m.event.includes('more than its account holds'))).toBe(false);
  });
});
