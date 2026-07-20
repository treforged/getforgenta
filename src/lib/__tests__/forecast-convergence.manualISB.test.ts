// @vitest-environment jsdom
//
// Q4/Q5 regression test (promoted from the q4-diagnostic on 2026-07-15): the golden fixture is
// now captured POST-Q5, so Prime Visa carries a live manual statement_balance (interest-saving
// balance, 1164.79) and the sim exercises the Q5 synthetic-pin path — the exact configuration
// that produced the 07-14 live regressions (payoff 36 vs 12 months, Aug 2026 floor breach) before
// the Q4 fixes (engine models the ISB pin as mandatory in PASS 2's floor look-ahead; adaptive
// raw-stability damping in the convergence loop).
//
// Two clock anchors guard oscillation behavior at different due-day alignments (the 07-14 bug
// only manifested once Prime Visa's due day had passed, shifting the pin's dueMonth). Baselines
// below are pinned to the 2026-07-15 fixture — re-pin passes/payoff if the fixture is recaptured.
//
// Self-skips when the gitignored fixture is absent (same pattern as forecast-engine.goldenTierA).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

function runScenario(clockOffsetDays: number) {
  const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

  vi.useFakeTimers({ toFake: ['Date'] });
  const clock = new Date(capturedAt);
  clock.setDate(clock.getDate() + clockOffsetDays);
  vi.setSystemTime(clock);

  const base = renderProjectionFromFixture(inputs);

  // Q5 path precondition: the fixture's manual Prime Visa statement_balance must surface as a
  // synthetic ISB pin, otherwise this test is silently no longer covering the Q4 scenario.
  const pv = inputs.accounts.find(a => a.name === 'Prime Visa');
  expect(Number(pv?.statement_balance), 'fixture must carry the manual PV statement_balance').toBeGreaterThan(0);
  expect(base.manualIsbPins?.length, 'sim must derive a manual ISB pin from the fixture').toBeGreaterThanOrEqual(1);
  expect(base.manualIsbPins![0].amount).toBeCloseTo(Number(pv!.statement_balance), 2);

  const out = runDebtCashConvergence(base, inputs);
  const ccFree = out.projections.milestones.find(m => m.event.startsWith('CC Debt Free'));
  const floorBreaches = out.projections.milestones.filter(m => m.event.includes('below safe minimum'));
  return { out, ccFree, floorBreaches };
}

describe('runDebtCashConvergence — manual ISB pin on the golden fixture (Q4/Q5 regression)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('clock=capturedAt (2026-07-15): converges with no floor breach and the live payoff', () => {
    const { out, ccFree, floorBreaches } = runScenario(0);
    expect(out.converged, 'convergence loop must settle within the pass budget').toBe(true);
    // Re-pinned 2026-07-20 (Q12 floor cutoff + real paymentPlans in the harness): 18 passes —
    // AT the maxPasses=18 budget, converging on the final allowed pass. Zero regression margin
    // left; the converged assertion above is the only remaining cliff guard. Was 16 pre-Q12
    // (and 10 on main with plans), so Q12 measurably slows convergence on this fixture —
    // flagged for a maxPasses/damping decision before merge.
    expect(out.passes, 'pass count regressed past the budget cliff').toBeLessThanOrEqual(18);
    expect(ccFree, 'CC Debt Free milestone should fire within the horizon').toBeTruthy();
    expect(ccFree!.month, 'payoff month regressed').toBe('Jul 2027');
    expect(floorBreaches.map(m => m.month), 'cash-floor breaches after convergence').toEqual([]);
  });

  maybeIt('post-payoff months never underpay a cycling statement (Q6 — Feb–Jun 2028 regression)', () => {
    // Before the reducibleDebtCapByMonth fix (floor-protection.ts), the look-ahead's cash walk
    // assumed all surplus flowed to debt forever, rode its modeled balance along the floor for
    // the whole horizon, and flagged Apr 2028's $2.7k cycling statement as a breach the user's
    // actual ~$16k cash would never feel — capping Jan–Mar 2028 payments so Prime Visa paid
    // $194 of an $831 statement (backlog + interest), plus a permanent never-cleared backlog
    // from Jan 2029 onward. Post-payoff, a converged run must pay every statement in full.
    const { out } = runScenario(0);
    expect(out.converged).toBe(true);
    const cp = out.cardProjection;
    const payoffM = cp.forecastRevolvingPayoffMonth;
    expect(payoffM, 'fixture must pay off within the horizon').not.toBeNull();
    for (const [cardId, backlog] of cp.monthlyCyclingBacklog.entries()) {
      const interest = cp.monthlyCyclingInterest.get(cardId) ?? [];
      for (let m = payoffM!; m < backlog.length; m++) {
        expect(backlog[m], `card ${cardId} carries cycling backlog at m${m}`).toBeLessThanOrEqual(0.01);
        expect(interest[m] ?? 0, `card ${cardId} accrues cycling interest at m${m}`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  maybeIt('clock=+11d (2026-07-26, all July due days passed): converges with no floor breach', () => {
    const { out, ccFree, floorBreaches } = runScenario(11);
    expect(out.converged, 'convergence loop must settle within the pass budget').toBe(true);
    expect(out.passes, 'pass count regressed toward the budget cliff').toBeLessThanOrEqual(12);
    expect(ccFree, 'CC Debt Free milestone should fire within the horizon').toBeTruthy();
    // Jul 2027 since the 2026-07-20 re-pin (real paymentPlans in the harness — the earlier
    // Jun 2027 was measured with paymentPlans=[], a $228/mo-richer sim walk).
    expect(ccFree!.month, 'payoff month regressed').toBe('Jul 2027');
    expect(floorBreaches.map(m => m.month), 'cash-floor breaches after convergence').toEqual([]);
  });
});
