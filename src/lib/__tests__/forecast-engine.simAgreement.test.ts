// @vitest-environment jsdom
//
// Sim-agreement test for the cycling-model unification (.claude/plan/unify-cycling-model.md).
//
// Stage 3 made PASS 3 delegate row.debtPayment to the sim's payment ledger, so on the OLD
// (pre-Q5) fixture a single raw calculateForecast pass agreed with the static cardProjectionData
// by construction. The Q4 engine change (2026-07-15) deliberately broke unconditional raw parity:
// when a manual ISB pin exists, PASS 2's floor protection models the pin as a mandatory outflow
// and can cap debtPayment below the sim's ledger on a single pass — the convergence loop is what
// re-sims until the pair agrees. So this test now asserts the USER-FACING invariant on the
// CONVERGED pair (what CardProjectionContext publishes: popup payments == accordion payments):
// after runDebtCashConvergence settles, the engine's row.debtPayment must match the converged
// sim's allPaymentTotals every month.
//
// Self-skips when the gitignored fixture is absent (same pattern as forecast-engine.goldenTierA.test.ts).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

describe('forecast-engine — sim agreement on the converged pair (post-unification + Q4)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('keeps row.debtPayment within a dollar of the converged sim allPaymentTotals every month', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

    // Pin ONLY Date (the sim/engine read new Date() internally) — leave real timers for
    // @testing-library's render machinery.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));

    const base = renderProjectionFromFixture(inputs);
    const out = runDebtCashConvergence(base, inputs);
    expect(out.converged, 'agreement is only guaranteed at the converged fixed point').toBe(true);

    const simTotals = out.cardProjection?.allPaymentTotals ?? [];
    expect(out.projections.data.length).toBeGreaterThan(0);
    expect(simTotals.length).toBeGreaterThan(0);

    // row.debtPayment is whole-dollar rounded (Math.round in the engine's data.push); simTotals
    // is raw cents. Round both the same way before diffing so double-rounding at a .5 boundary
    // can't produce a spurious >$1 gap between two values that agree to the cent.
    // Month 0 is exempt: it's live-anchored to Plaid state the sim itself has no concept of
    // (syncCutoffDate — see forecast-engine's m0AllSettled zeroing). Months 1+ must agree.
    for (const [i, row] of out.projections.data.entries()) {
      if (i === 0) continue;
      const sim = Math.round(simTotals[i] ?? 0);
      expect(Math.abs(row.debtPayment - sim), `month ${i} gap`).toBeLessThanOrEqual(1);
    }
  });
});
