// @vitest-environment jsdom
//
// A BILL ANOTHER ACCOUNT CANNOT PAY COMES OUT OF CHECKING, SO THE FLOOR RESERVE MUST PLAN FOR IT.
// Ask b520a4e7.
//
// Step 4b-iii (forecast-engine.ts) charges the part of an account-paid bill its own account cannot
// cover to checking (`unfundedAccountOutflow`, f3c0cdf5 / e2f7101f). PASS 2's floor look-ahead did
// not model that charge, so it counted those dollars as free: an earlier month sent them to the
// cards and the tight month ended below its floor by about the charge. Tre's 2026-10-04 capture
// with the Owners transfers paused showed it exactly: General Operations' $60.90 of monthly bills
// was charged to checking, and one month ended $60.90 under its floor.
//
// SYNTHETIC DATA ONLY: the committed demo persona plus a second, EMPTY checking account that pays
// $300 a month of bills (nothing refills it, so all $300 is charged to checking every month), and a
// yearly cash bill in December so December is the tight month the reserve has to see coming.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoCardProjection, demoForecastInputs } from './fixtures/demo-forecast-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import { demoAccounts, demoProfile, demoRecurringRules } from '../demo-data';

const NOW = new Date('2026-09-10T12:00:00');
/** December is month 3 at NOW. */
const BILL_MONTH_INDEX = 3;
const BILL = 1500;
const OPS_BILLS = 300;
/**
 * The bills start in OCTOBER (month 1), not September. Month 0's payment is decided by the live
 * month-0 chain in useCardProjection, which has no model of another account's balance, so a month-0
 * shortfall is a separate gap this test does not claim to cover (measured: with the bills also in
 * September, the Dashboard's month-0 end cash reads $300 above the Forecast's, and September ends
 * $196 under its floor - reported, not fixed, in ask b520a4e7).
 */
const OPS_START = '2026-10-01';

const rule = (over: Record<string, unknown>) => ({
  user_id: 'demo', due_month: null, start_date: '2026-01-01', end_date: null, deposit_account: null,
  active: true, notes: '', created_at: '', updated_at: '', ...over,
});

function run(withOpsAccount: boolean) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const accounts = [
    // A heavier card so the cards take every spare dollar and the cap has to bind. Its contract
    // minimum is stated (min_payment) so that PASS 2's `ccMinTotal` and the sim's `revolvingMinDue`
    // agree: with the fixture's unstated minimum PASS 2 models $25 while the sim pays the formula
    // (~$140 in December), a separate PASS 2 gap this test is not about (reported with b520a4e7).
    ...demoAccounts.map(a => a.id !== 'd7' ? a : { ...a, balance: 11000, balance_tranches: [], min_payment: 400 }),
    ...(withOpsAccount ? [{
      id: 'ops', user_id: 'demo', name: 'Operations', account_type: 'checking', institution: 'Synthetic',
      balance: 0, credit_limit: null, apr: null, active: true, notes: '', created_at: '', updated_at: '',
    }] : []),
  ];
  const rules = [
    ...demoRecurringRules,
    rule({ id: 'synthetic-annual-bill', name: 'Annual Bill', amount: BILL, rule_type: 'expense', frequency: 'yearly', due_day: 20, due_month: 12, category: 'Insurance', payment_source: 'account:d1' }),
    ...(withOpsAccount ? [rule({ id: 'synthetic-ops-bills', name: 'Ops Bills', amount: OPS_BILLS, rule_type: 'expense', frequency: 'monthly', due_day: 15, category: 'Software', payment_source: 'account:ops', start_date: OPS_START })] : []),
  ];
  const cp = runDemoCardProjection(NOW, { profile: demoProfile, rules, accounts });
  const base = demoForecastInputs({ now: NOW, cardProjection: cp, rules: rules as never });
  // The harness builds the engine's month events from the committed fixture's rules, so the
  // synthetic cash bill is added to its month here. The ops bills stay OUT of the month events on
  // purpose: they are paid from another account, and only 4b-iii's remainder reaches checking.
  const forecastMonthEvents = base.forecastMonthEvents.map((e, i) =>
    i === BILL_MONTH_INDEX ? { ...e, expenses: e.expenses + BILL } : e);
  const inputs = { ...base, accounts, forecastMonthEvents } as unknown as ForecastInputs;
  const out = runDebtCashConvergence(cp as unknown as CardProjectionResult, inputs);
  vi.useRealTimers();
  return out;
}

const shortMonths = (out: ReturnType<typeof run>) =>
  out.projections.data
    .filter(r => r.rawEndingCash < r.rawMonthMinSafe - 0.005)
    .map(r => `${r.month} short ${(r.rawMonthMinSafe - r.rawEndingCash).toFixed(2)}`);

describe('floor reserve plans for a bill another account cannot pay', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('control: without the empty account the same persona never ends a month below its floor', () => {
    const out = run(false);
    expect(out.converged).toBe(true);
    expect(shortMonths(out)).toEqual([]);
  }, 120_000);

  it('with $300 a month charged to checking every month still ends at or above its floor', () => {
    const out = run(true);
    expect(out.converged).toBe(true);
    // The charge really reaches checking: all $300 in December, since the account never holds a
    // dollar. Without this the green below could come from a bill the engine never charged.
    expect(out.projections.data[BILL_MONTH_INDEX].unfundedAccountOutflow).toBeCloseTo(OPS_BILLS, 2);
    expect(shortMonths(out)).toEqual([]);
    for (const r of out.projections.data) {
      expect(r.rawEndingCash, r.month).toBeGreaterThanOrEqual(r.rawMonthMinSafe - 0.005);
    }
  }, 120_000);
});
