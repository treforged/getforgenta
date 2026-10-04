// @vitest-environment jsdom
//
// THE FLOOR LOOK-AHEAD SEES A SAVINGS TRANSFER INTO CHECKING. Ask b80124a0.
//
// PASS 3 (forecast-engine.ts, step 4b-ii) now adds to checking what a savings / investment /
// retirement account really moved into the funding checking account (`nonCashIntoFunding`). PASS 2's
// floor look-ahead sizes every month's debt cap from its own forward cash walk, so it must see the
// same inflow: without it the walk runs below real cash by the inflow, accumulating month on month,
// and the caps hold the cards back for money that is in fact in checking. It reads the previous
// convergence run's own realised figure, exactly as it reads `unfundedAccountOutflow`.
//
// Measured on this persona. With the PASS 2 term: every uncapped month from Oct 2026 tracks real
// cash within $3. Without it (proven red by zeroing the term): Feb 2027 -$326, Jul 2027 -$957 and
// falling further every month; the Nov 2026 cap is $1,269 instead of $1,869, and the cards pay off
// a month later.
//
// RESIDUE, NOT COVERED HERE: in a month whose cap BINDS (a save-up month) the engine's debt target
// echoes the card sim's own payment, and the sim does not see the inflow (useCardProjection, see the
// note in `run`). Real cash then ends ABOVE the walk - Nov 2026 by $603 here. That direction can
// only hold cash back, never leave a month short, so those months are checked one way only.
//
// SYNTHETIC DATA ONLY: the committed demo persona with its revolving card made heavier (so the caps
// bind), a yearly cash bill in December so there is a month the reserve has to see coming, and a
// $300 monthly transfer from the demo's savings into its funding checking account. Savings holds
// $5,812, so the transfer runs dry inside the horizon and the walk must follow that too.
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
const SWEEP = 300;
/** Same bound as floor-protection.walkTracksReal.test.ts. */
const MAX_GAP = 25;

const rule = (over: Record<string, unknown>) => ({
  user_id: 'demo', due_month: null, start_date: '2026-01-01', end_date: null, deposit_account: null,
  active: true, notes: '', created_at: '', updated_at: '', ...over,
});

function run() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const accounts = demoAccounts.map(a => a.id !== 'd7' ? a : { ...a, balance: 11000, balance_tranches: [], min_payment: 400 });
  const simRules = [
    ...demoRecurringRules,
    rule({ id: 'synthetic-annual-bill', name: 'Annual Bill', amount: BILL, rule_type: 'expense', frequency: 'yearly', due_day: 20, due_month: 12, category: 'Insurance', payment_source: 'account:d1' }),
  ];
  // d3 (Ridgeway Savings, high-yield) -> d1 (Northvale Checking, the funding account).
  const rules = [
    ...simRules,
    rule({ id: 'synthetic-sweep', name: 'Savings Sweep', amount: SWEEP, rule_type: 'transfer', frequency: 'monthly', due_day: 28, category: 'Transfer', payment_source: 'd3', deposit_account: 'd1' }),
  ];
  // ⚠️ THE CARD SIM IS RENDERED WITHOUT THE SWEEP, ON PURPOSE. useCardProjection counts EVERY
  // transfer rule as a checking outflow in months 1+ (its simulationMonthEvents `monthTransfers`
  // loop has no non-cash-source exclusion), so with the sweep it models $300 a month LEAVING
  // checking where the engine has $300 arriving - a $600 swing that sets the sim's payment in the
  // save-up months, where the engine's target only echoes the sim. That is a separate hook gap
  // (reported with b80124a0, not fixed here). Leaving the sweep out of the sim isolates PASS 2.
  const cp = runDemoCardProjection(NOW, { profile: demoProfile, rules: simRules, accounts });
  const base = demoForecastInputs({ now: NOW, cardProjection: cp, rules: rules as never });
  const forecastMonthEvents = base.forecastMonthEvents.map((e, i) =>
    i === BILL_MONTH_INDEX ? { ...e, expenses: e.expenses + BILL } : e);
  const inputs = { ...base, accounts, rules, forecastMonthEvents } as unknown as ForecastInputs;
  const out = runDebtCashConvergence(cp as unknown as CardProjectionResult, inputs);
  vi.useRealTimers();
  return out;
}

describe('the floor look-ahead walk includes a savings transfer into the funding account', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('tracks real ending cash in every uncapped month, and never runs above it', () => {
    const out = run();
    expect(out.converged).toBe(true);
    const rows = out.projections.data;
    const caps = out.projections.maxDebtPaymentByMonth;
    const walk = out.projections.lookAheadWalkEndByMonth;
    expect(walk, 'the engine exposes the walk').toBeDefined();

    // Positive controls: the inflow really reaches checking, in full while savings lasts and less
    // once it runs dry; and the caps really bind somewhere, or a tight walk would prove nothing.
    const inflow = rows.map(r => r.nonCashIntoFunding ?? 0);
    expect(inflow[1]).toBeCloseTo(SWEEP, 2);
    expect(inflow.some(v => v > 0.005 && v < SWEEP - 0.005), 'savings runs dry inside the horizon').toBe(true);
    const capped = rows.map((_, m) => m).filter(m => m > 0 && Number.isFinite(caps[m]));
    expect(capped.length, 'the look-ahead caps at least one month').toBeGreaterThan(0);
    const uncapped = rows.map((_, m) => m).filter(m => m > 0 && !Number.isFinite(caps[m]));
    expect(uncapped.length, 'there are uncapped months to check').toBeGreaterThan(12);

    // Month 0 is live-anchored to the hook's month-0 chain, which does not see the inflow either
    // (same residue as above), so the check starts at month 1.
    const gap = (m: number) => ({ month: rows[m].month, gap: walk![m] - rows[m].rawEndingCash });
    const worst = uncapped.map(gap).reduce((a, g) => (Math.abs(g.gap) > Math.abs(a.gap) ? g : a));
    expect(Math.abs(worst.gap), `${worst.month}: walk minus real = ${worst.gap.toFixed(2)}`).toBeLessThanOrEqual(MAX_GAP);
    for (const m of capped) {
      const g = gap(m);
      expect(g.gap, `${g.month}: walk minus real = ${g.gap.toFixed(2)} (walk above real cash)`).toBeLessThanOrEqual(MAX_GAP);
    }
    for (const r of rows) expect(r.rawEndingCash, r.month).toBeGreaterThanOrEqual(r.rawMonthMinSafe - 0.005);
  }, 120_000);
});
