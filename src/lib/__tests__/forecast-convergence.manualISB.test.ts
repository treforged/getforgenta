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
    // 16 passes on the 2026-07-15 fixture; bound guards regression back toward the 18-pass
    // budget/fallback cliff. (Live shows 12 on the same clock — fidelity gap: the fixture does
    // not capture debtPayoffOptions overrides; see fixtures/projection-harness.ts.)
    expect(out.passes, 'pass count regressed toward the budget cliff').toBeLessThanOrEqual(16);
    expect(ccFree, 'CC Debt Free milestone should fire within the horizon').toBeTruthy();
    expect(ccFree!.month, 'payoff month regressed').toBe('Jun 2027');
    expect(floorBreaches.map(m => m.month), 'cash-floor breaches after convergence').toEqual([]);
  });

  maybeIt('clock=+11d (2026-07-26, all July due days passed): converges with no floor breach', () => {
    const { out, ccFree, floorBreaches } = runScenario(11);
    expect(out.converged, 'convergence loop must settle within the pass budget').toBe(true);
    expect(out.passes, 'pass count regressed toward the budget cliff').toBeLessThanOrEqual(12);
    expect(ccFree, 'CC Debt Free milestone should fire within the horizon').toBeTruthy();
    expect(ccFree!.month, 'payoff month regressed').toBe('Jun 2027');
    expect(floorBreaches.map(m => m.month), 'cash-floor breaches after convergence').toEqual([]);
  });
});
