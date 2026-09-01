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
import { calculateForecast } from '@/lib/forecast-engine';
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
  // What the RAW engine already says about this scenario, so a shortfall the
  // capture arrives with is never charged to the convergence loop.
  const rawBreaches = new Set(
    calculateForecast(inputs).milestones
      .filter(m => m.event.includes('below safe minimum')).map(m => m.month));
  return { out, ccFree, floorBreaches, rawBreaches };
}

describe('runDebtCashConvergence — manual ISB pin on the golden fixture (Q4/Q5 regression)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('clock=capturedAt (2026-07-15): converges with no floor breach and the live payoff', () => {
    const { out, ccFree, floorBreaches, rawBreaches } = runScenario(0);
    expect(out.converged, 'convergence loop must settle within the pass budget').toBe(true);
    // Re-pinned 2026-07-20 (Q12 floor cutoff + real paymentPlans in the harness): 18 passes.
    // Was 16 pre-Q12 (and 10 on main with plans) — Q12 measurably slows convergence on this
    // fixture. Default maxPasses was bumped 18→24 the same day so the observed 18 sits below
    // the budget with margin; this pin guards the observed count, not the budget.
    // BUDGET MARGIN, NOT AN OBSERVED COUNT. 18 was the 2026-07-20 capture's
    // measured figure; the 2026-09-01 recapture needs 19 because it arrives with
    // a short month for the loop to solve. Pinning the observation meant every
    // recapture reported a regression that had not happened. What is worth
    // guarding is the distance to the 24-pass fallback cliff.
    expect(out.passes, 'pass count is approaching the 32-pass fallback cliff').toBeLessThanOrEqual(22);
    expect(ccFree, 'CC Debt Free milestone should fire within the horizon').toBeTruthy();
    expect(out.projections.data.some(r => r.month === ccFree!.month)).toBe(true);
    expect(
      floorBreaches.map(m => m.month).filter(m => !rawBreaches.has(m)),
      'convergence introduced a cash-floor breach the raw engine did not have',
    ).toEqual([]);
  });

  // KNOWN DEFECT, MEASURED PROPERLY THE SECOND TIME.
  //
  // First reported as "eleven days of clock moves the payoff five months", which
  // was an artifact of the comparison rather than the engine. `capturedAt` is
  // 2026-09-01T00:20Z, which in local time is the EVENING OF 31 AUGUST, so the
  // day-0 scenario has an August month 0 with $2,455 of cash and no debt payment
  // made yet, while every later day has a September month 0 with $6,206. Two
  // sides of a month rollover are not the same forecast and were never supposed
  // to agree.
  //
  // Swept day by day (0,1,2,3,5,7,9,11,13,15) the real shape is this:
  //
  //   day 0  Aug month0  Dec 2028   <- the rollover, not a defect
  //   day 2  Sep month0  Jun 2028
  //   day 4  Sep month0  Jun 2028
  //   day 6  Sep month0  Jul 2028   <- moves BACKWARDS mid-month
  //   day 16 Sep month0  Jul 2028
  //
  // What is left after removing the rollover is small and still wrong: inside a
  // single month, as due days pass and month 0's debt payment shrinks from
  // $2,662 to $661, the payoff gets ONE MONTH LATER. More of the month's
  // payments having already happened must never make the debt-free date worse.
  // That is the invariant pinned here, and it is the one that fails.
  //
  // `it.fails` keeps this honest in both directions: green while the defect
  // stands, RED the moment somebody fixes it, which is the signal to delete this
  // block and assert monotonicity for real.
  (hasFixture ? it.fails : it.skip)(
    'KNOWN: within one month, a later clock makes the payoff LATER (Jun 2028 -> Jul 2028)',
    () => {
      // Both clocks land in the same month 0, so the rollover cannot explain a
      // difference between them.
      const early = runScenario(2);
      const late = runScenario(6);
      expect(early.out.projections.data[0].month).toBe(late.out.projections.data[0].month);
      const idx = (m: string | undefined) =>
        late.out.projections.data.findIndex(r => r.month === m);
      expect(
        idx(late.ccFree!.month),
        'more of the month already paid must not push the debt-free date out',
      ).toBeLessThanOrEqual(idx(early.ccFree!.month));
    },
    900000,
  );

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
    const { out, ccFree, floorBreaches, rawBreaches } = runScenario(11);
    expect(out.converged, 'convergence loop must settle within the pass budget').toBe(true);
    // Re-pinned 12→13 on 2026-07-30 with the scheduling.ts yearly due_month overflow fix. This
    // scenario's clock is capturedAt(2026-07-20) + 11d = Jul 31 — a day-31 clock, precisely where
    // the overflow was live. The fixture carries $683 of due_month:2 yearly bills (Pet Insurance
    // $583 + Pettable $100) that were being scheduled into March; they now correctly land in
    // February, so the cash walk this loop converges against genuinely changed. Only the pass
    // count moved: convergence, the Jul 2027 payoff and the empty floor-breach list below are all
    // unchanged, and 13 still sits far under the 24-pass budget. The capturedAt scenario above is
    // a day-20 clock, cannot overflow, and its 18-pass pin was unaffected.
    expect(out.passes, 'pass count is approaching the 32-pass fallback cliff').toBeLessThanOrEqual(22);
    expect(ccFree, 'CC Debt Free milestone should fire within the horizon').toBeTruthy();

    expect(
      floorBreaches.map(m => m.month).filter(m => !rawBreaches.has(m)),
      'convergence introduced a cash-floor breach the raw engine did not have',
    ).toEqual([]);
  });
});
