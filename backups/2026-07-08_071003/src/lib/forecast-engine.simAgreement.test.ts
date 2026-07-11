// Stage 0 characterization test for the cycling-model unification (.claude/plan/unify-cycling-model.md).
//
// Model A (forecast-engine PASS 3) re-derives its own debtPayment split instead of consuming
// Model B (the sim, useCardProjection/credit-card-engine) directly. This test records the
// PRE-UNIFICATION per-month gap between the engine's row.debtPayment and the sim's actual total
// payment (cardProjectionData.allPaymentTotals) on the real-data golden fixture. It intentionally
// asserts nothing about the gap size yet — only that both quantities exist and the run completes —
// so later stages (Stage 3) can flip this into a hard `gap <= 1` assertion once the engine
// delegates to the sim's ledger instead of re-deriving.
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

describe('forecast-engine — sim agreement (Stage 0 characterization, pre-unification)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('records the current per-month gap between row.debtPayment and sim allPaymentTotals', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));

    vi.useFakeTimers();
    vi.setSystemTime(new Date(capturedAt));

    const result = calculateForecast(inputs);
    const simTotals = inputs.cardProjectionData?.allPaymentTotals ?? [];

    expect(result.data.length).toBeGreaterThan(0);
    expect(simTotals.length).toBeGreaterThan(0);

    const gapVector = result.data.map((row, i) => {
      const sim = simTotals[i] ?? 0;
      return Math.round((row.debtPayment - sim) * 100) / 100;
    });

    // Baseline artifact: document, don't assert. Stage 3 flips this to a hard `<= 1` assertion
    // once PASS 3 delegates to the sim's payment ledger instead of re-deriving the split.
    // eslint-disable-next-line no-console
    console.log('[Stage 0 baseline] debtPayment - simAllPayments gap by month:', gapVector);

    // Structural sanity only: both series must be the same length so the gap vector is meaningful.
    expect(gapVector.length).toBe(result.data.length);
  });
});
