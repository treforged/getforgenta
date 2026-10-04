// @vitest-environment jsdom
//
// THE FLOOR LOOK-AHEAD'S CASH WALK MUST TRACK THE ENGINE'S REAL CASH. Ask e2850463.
//
// PASS 2 (forecast-engine.ts) sizes every month's debt-payment cap from its own forward cash walk
// (computeFloorProtection's `walkEndByMonth`). A walk that runs BELOW the engine's real ending cash
// makes the caps too tight: the cards are held to their minimums for money that is in fact still in
// checking, and the user pays interest for nothing. A walk that runs ABOVE it is worse: a cap sized
// from cash that does not exist lets a month end below its floor. So the gap is bounded both ways.
//
// Two causes were measured on Tre's 2026-09-29 capture (walk up to $5,687.96 below real cash):
//   (b) the walk charged today's static `minPayment` summed over EVERY card, every month, while the
//       sim pays `revolvingMinDue` per card and $0 on a card that has paid off ($973.45 against
//       $412.95 a month there). Covered by the engine-level case below, on SYNTHETIC data.
//   (a) the walk subtracted the full planned goal contribution in months where PASS 3's
//       affordability back-off contributed $0. Covered by the direct computeFloorProtection case.
// Fixing (b) unmasked a third, smaller error in the OPTIMISTIC direction: the walk's debt bound
// counted only a card's revolving carry-over, not the purchases and interest the sim pays in its
// last months, so it could not drain to real cash there. The engine-level case covers that too.
//
// SYNTHETIC DATA ONLY: the committed demo persona with its revolving card made heavier (so the caps
// bind) plus a small card with a high stated minimum that pays off in its first months, and a yearly
// cash bill in December so there is a month the reserve has to see coming.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoCardProjection, demoForecastInputs } from './fixtures/demo-forecast-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import { computeFloorProtection, type FloorProtectionParams } from '@/lib/floor-protection';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import { PROJECTION_MONTHS } from '@/lib/scheduling';
import { demoAccounts, demoProfile, demoRecurringRules } from '../demo-data';

const NOW = new Date('2026-09-10T12:00:00');
/** December is month 3 at NOW. */
const BILL_MONTH_INDEX = 3;
const BILL = 1500;
/** The small card's stated minimum: what the static sum keeps charging after it has paid off. */
const SMALL_CARD_MIN = 300;
/**
 * Largest gap, in dollars, the walk may sit from real ending cash in a month that still carries
 * revolving debt. Measured on this persona: worst -$1.91 (Jan 2027) after the fix. With the old
 * static-minimum sum it was -$282.78 (Dec 2026, the small card's $300 minimum still charged); with
 * the new minimum but the old revolving-only debt bound it was +$108.53 (Aug 2027, walk ABOVE real
 * cash because it could not drain what the sim pays in the cards' last months).
 */
const MAX_GAP = 25;

const rule = (over: Record<string, unknown>) => ({
  user_id: 'demo', due_month: null, start_date: '2026-01-01', end_date: null, deposit_account: null,
  active: true, notes: '', created_at: '', updated_at: '', ...over,
});

function run() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const accounts = [
    ...demoAccounts.map(a => a.id !== 'd7' ? a : { ...a, balance: 11000, balance_tranches: [], min_payment: 400 }),
    {
      id: 'small-card', user_id: 'demo', name: 'Small Card', account_type: 'credit_card', institution: 'Synthetic',
      balance: 450, credit_limit: 2000, apr: 21.99, active: true, notes: '', created_at: '', updated_at: '',
      payment_due_day: 10, payment_preference: 'statement', min_payment: SMALL_CARD_MIN,
    },
  ];
  const rules = [
    ...demoRecurringRules,
    rule({ id: 'synthetic-annual-bill', name: 'Annual Bill', amount: BILL, rule_type: 'expense', frequency: 'yearly', due_day: 20, due_month: 12, category: 'Insurance', payment_source: 'account:d1' }),
  ];
  const cp = runDemoCardProjection(NOW, { profile: demoProfile, rules, accounts });
  const base = demoForecastInputs({ now: NOW, cardProjection: cp, rules: rules as never });
  const forecastMonthEvents = base.forecastMonthEvents.map((e, i) =>
    i === BILL_MONTH_INDEX ? { ...e, expenses: e.expenses + BILL } : e);
  const inputs = { ...base, accounts, forecastMonthEvents } as unknown as ForecastInputs;
  const out = runDebtCashConvergence(cp as unknown as CardProjectionResult, inputs);
  vi.useRealTimers();
  return out;
}

describe('the floor look-ahead walk tracks the engine', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('stays within $25 of real ending cash in every month that still carries revolving debt', () => {
    const out = run();
    expect(out.converged).toBe(true);
    const cp = out.cardProjection;
    const walk = out.projections.lookAheadWalkEndByMonth;
    expect(walk, 'the engine exposes the walk').toBeDefined();

    // Positive controls. The small card really pays off early, so the static sum really does keep
    // charging a minimum the sim no longer pays; and the caps really bind somewhere, or a tight walk
    // would cost nothing and this test would prove nothing.
    const smallRev = cp.monthlyRevolvingBalances.get('small-card') ?? [];
    const smallClearedAt = smallRev.findIndex((b, m) => m > 0 && b <= 0);
    expect(smallClearedAt, 'small card pays off').toBeGreaterThan(0);
    expect(smallClearedAt).toBeLessThan(4);
    const capped = out.projections.maxDebtPaymentByMonth.filter((c, m) => m > 0 && Number.isFinite(c)).length;
    expect(capped, 'the look-ahead caps at least one month').toBeGreaterThan(0);

    // Months 1+ that still owe revolving debt entering the month: where a cap can bind.
    const rows = out.projections.data;
    const debtMonths = rows
      .map((_, m) => m)
      .filter(m => m > 0 && cp.simCards.some(c => (cp.monthlyRevolvingBalances.get(c.id)?.[m - 1] ?? 0) > 0));
    expect(debtMonths.length, 'there are debt months to check').toBeGreaterThan(smallClearedAt + 3);

    const gaps = debtMonths.map(m => ({ month: rows[m].month, gap: walk![m] - rows[m].rawEndingCash }));
    const worst = gaps.reduce((a, g) => (Math.abs(g.gap) > Math.abs(a.gap) ? g : a));
    expect(Math.abs(worst.gap), `${worst.month}: walk minus real = ${worst.gap.toFixed(2)}`).toBeLessThanOrEqual(MAX_GAP);
    // And the reason the bound matters: no month ends below its floor.
    for (const r of rows) expect(r.rawEndingCash, r.month).toBeGreaterThanOrEqual(r.rawMonthMinSafe - 0.005);
  }, 120_000);
});

describe('the walk applies the goal back-off', () => {
  // Direct computeFloorProtection: a month that cannot afford its goal contribution. PASS 3 lets the
  // debt payment fall to its minimum first, then cuts the contribution by the shortfall, so the
  // month ends AT its floor with the rest of the contribution still in checking.
  const N = PROJECTION_MONTHS;
  const flat = (v: number) => Array(N).fill(v) as number[];
  const params = (goalContribByMonth?: number[]): FloorProtectionParams => ({
    incomeByMonth: flat(3000),
    // Month 2 carries a $2,000 bill; every month includes a $500 goal contribution. Months 0-1 bank
    // at their minimum to $2,300, so month 2 ends $300 under its floor if the contribution is made.
    expenseByMonth: Array.from({ length: N }, (_, m) => 2000 + 500 + (m === 2 ? 2000 : 0)),
    oneTimeNetByMonth: flat(0), carDownPaymentByMonth: flat(0), floorByMonth: flat(1000),
    startingBalance: 1500, ccMinTotal: 100, ccMinByMonth: flat(100),
    reducibleDebtCapByMonth: flat(50_000), cyclingExcessByMonth: flat(0),
    carFunds: [], transactions: [], ccSourceIds: new Set(), now: new Date('2026-09-10T12:00:00'),
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
    goalContribByMonth,
  });

  it('ends a month that cannot afford its contribution at the floor, not below it', () => {
    const without = computeFloorProtection(params());
    const withGoal = computeFloorProtection(params(flat(500)));
    // Control: without the input the walk is the old one, and month 2 really is $300 short.
    expect(without.walkEndByMonth[2]).toBeCloseTo(700, 6);
    // With it the contribution gives back exactly the shortfall: month 2 ends at its floor, with the
    // other $200 of the contribution still made.
    expect(withGoal.walkEndByMonth[2]).toBeCloseTo(1000, 6);
    // A month that CAN afford its contribution is untouched.
    expect(withGoal.walkEndByMonth[1]).toBeCloseTo(without.walkEndByMonth[1], 6);
  });

  it('never gives back more than the contribution', () => {
    const r = computeFloorProtection(params(flat(100)));
    const without = computeFloorProtection(params());
    // A $100 contribution can cover only $100 of the $300 shortfall: the month still ends $200 short.
    expect(r.walkEndByMonth[2] - without.walkEndByMonth[2]).toBeCloseTo(100, 6);
    expect(r.walkEndByMonth[2]).toBeCloseTo(800, 6);
  });
});
