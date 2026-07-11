// Sim-agreement test for the cycling-model unification (.claude/plan/unify-cycling-model.md).
//
// Stage 0 recorded the PRE-UNIFICATION per-month gap between the engine's row.debtPayment and
// the sim's actual total payment (cardProjectionData.allPaymentTotals) on the real-data golden
// fixture, without asserting a bound. Stage 3 made PASS 3 delegate directly to the sim's payment
// ledger (monthDebtPayment = paymentLedger[i].total, m0AllSettled aside) instead of re-deriving
// its own cycling/revolving split, so the two quantities now agree by construction — this test
// flips Stage 0's baseline into the hard `gap <= 1` assertion the plan calls for.
//
// Self-skips when the gitignored fixture is absent (same pattern as forecast-engine.goldenTierA.test.ts).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { calculateForecast } from '@/lib/forecast-engine';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

describe('forecast-engine — sim agreement (post-unification, Stage 3)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('keeps row.debtPayment within a dollar of sim allPaymentTotals every month', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

    vi.useFakeTimers();
    vi.setSystemTime(new Date(capturedAt));

    const result = calculateForecast(inputs);
    const simTotals = inputs.cardProjectionData?.allPaymentTotals ?? [];

    expect(result.data.length).toBeGreaterThan(0);
    expect(simTotals.length).toBeGreaterThan(0);

    // row.debtPayment is whole-dollar rounded (Math.round in the engine's data.push); simTotals
    // is raw cents. Round both the same way before diffing so double-rounding at a .5 boundary
    // can't produce a spurious >$1 gap between two values that agree to the cent.
    const gapVector = result.data.map((row, i) => {
      const sim = Math.round(simTotals[i] ?? 0);
      return row.debtPayment - sim;
    });

    // Month 0 is exempt: it's live-anchored to Plaid state the sim itself has no concept of
    // (syncCutoffDate — see forecast-engine's m0AllSettled zeroing), a Stage 3 risk the plan
    // explicitly calls out as untouched. Months 1+ must agree with the sim by construction.
    for (const [i, gap] of gapVector.entries()) {
      if (i === 0) continue;
      expect(Math.abs(gap), `month ${i} gap`).toBeLessThanOrEqual(1);
    }
  });
});
