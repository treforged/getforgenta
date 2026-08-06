// @vitest-environment jsdom
//
// THE CROSS-SURFACE INVARIANT: Dashboard "Month-End Cash" == Forecast month-0 "End Cash".
//
// WHY THIS EXISTS. These are two pages rendering the same fact, and they have disagreed before:
// finding §1.1 records a $3,487 gap, caused by Dashboard building its own answer from the
// transaction stream instead of reading the engine. That was fixed by making `Month0Result.endCash`
// the single definition (`debt-model-types.ts:30-40`), but the invariant itself was never
// asserted — it has only ever been checked by hand in a browser, which samples one calendar day
// and one dataset. `.claude/plan/dashboard-expense-truth.md` step 5 called for this test before
// anything near month-end cash moved; §2.4 Phase 1 shipped without it. This closes that hole.
//
// WHAT IT PINS. Both surfaces read the SAME `runDebtCashConvergence` output — this is exactly the
// call `CardProjectionContext.tsx:230` makes, and the context then publishes
// `convergence.cardProjection` (which Dashboard.tsx:631 reads as `month0.endCash`) alongside
// `convergence.projections` (which Forecast.tsx:1152 renders as row 0's End Cash). Sharing one
// convergence run is what makes them agree; a future change that re-derives either side, or that
// publishes an unconverged projection next to a converged sim, breaks this test.
//
// WHY CENTS OF TOLERANCE — this test's tolerance is the fix. It used to allow $1, because the
// sim's `m0Chain.cashPreDebt` was the sum of the ROUNDED terms (so the drawer's on-screen equation
// added up in integer arithmetic) while the engine carried cents and rounded once at the end
// (`endingCash = Math.round(finalLiquid + cumulativeCarReserveHeld)`). On the golden fixture that
// printed $3,146 on the Dashboard next to $3,145 on Forecast: two surfaces, one fact, one dollar
// apart on a user's real screen.
//
// Tre chose ENGINE PRECISION (2026-08-06): "calculations should use the full exact values with the
// decimals", and the drawers now render two decimals so they still visibly balance. So the chain
// carries exact cents and the two surfaces must agree to the CENT against the engine's own
// unrounded figure. DO NOT LOOSEN THIS BACK. If it fails, the gap was never only rounding — a cash
// chain has genuinely diverged, which is the §1.1 failure mode.
//
// Self-skips when the gitignored real fixture is absent (same pattern as
// forecast-engine.goldenTierA.test.ts and forecast-engine.simAgreement.test.ts).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

describe('month-end cash — Dashboard tile == Forecast month-0 row', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('publishes one month-end cash figure to both surfaces', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

    // Pin ONLY Date (the sim/engine read new Date() internally) — leave real timers for
    // @testing-library's render machinery.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));

    const base = renderProjectionFromFixture(inputs);
    const out = runDebtCashConvergence(base, inputs);

    const month0 = out.cardProjection?.month0;
    expect(month0, 'the sim must publish a month-0 result for the Dashboard to read').toBeTruthy();
    const forecastRow = out.projections.data[0];
    expect(forecastRow, 'the engine must publish a month-0 row for Forecast to render').toBeTruthy();

    // What Dashboard.tsx:631 assigns to `monthEndCash`, and what Forecast.tsx:1152 renders.
    const dashboard = month0!.endCash;
    const forecast = forecastRow.endingCash;

    // `forecast` is the engine's DISPLAY field (rounded to whole dollars), so the user-visible
    // equality is that the Dashboard figure rounds to the same dollar. Sub-dollar agreement is
    // asserted against `rawEndingCash` below.
    expect(
      Math.round(dashboard),
      `Dashboard Month-End Cash $${dashboard.toFixed(2)} vs Forecast End Cash $${forecast.toFixed(2)} — `
      + 'the two tiles print different dollars for the same fact, so the cash chains have diverged',
    ).toBe(forecast);

    // The engine's own unrounded figure is the tiebreak: whatever the display rounding does, the
    // sim must be modelling the same underlying cash. `rawEndingCash` exists precisely because the
    // rounded field hides sub-dollar misses (forecast-engine.ts:78-82).
    expect(
      Math.abs(dashboard - forecastRow.rawEndingCash),
      `sim endCash $${dashboard.toFixed(2)} vs engine rawEndingCash $${forecastRow.rawEndingCash.toFixed(2)} — `
      + 'the chain carries exact cents now, so anything above a cent is a real divergence',
    ).toBeLessThanOrEqual(0.01);
  });

  maybeIt('keeps the sim-side definition intact: endCash = cashPreDebt − safeToPay + carReserveHeld', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));

    const out = runDebtCashConvergence(renderProjectionFromFixture(inputs), inputs);
    const m0 = out.cardProjection?.month0;
    expect(m0).toBeTruthy();

    // Guards the drawer, which walks these three terms on screen (Dashboard.tsx:770-802). If the
    // terms stop summing to the headline, the drawer is explaining a number it did not produce —
    // the §1.1 failure mode in miniature.
    const fromTerms = m0!.chain.cashPreDebt - m0!.safeToPayTotal + m0!.carReserveHeld;
    expect(Math.abs(m0!.endCash - fromTerms)).toBeLessThan(0.01);
  });
});
