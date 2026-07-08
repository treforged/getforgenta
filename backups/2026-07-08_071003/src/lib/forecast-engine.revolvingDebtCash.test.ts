import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { calculateForecast } from '@/lib/forecast-engine';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';

// Phase 2 Option C convergence — per-month revolving debt cash emission.
//
// The engine's month loop already knows exactly how much REAL cash it routed to revolving CC
// debt each month (step-2 revolving share of monthDebtPayment + that month's step-3 surplus),
// but until now it only exposed the CUMULATIVE step-3 surplus (revolving3Extra). The convergence
// loop in CardProjectionProvider needs the per-month actual so it can hand the card sim an
// authoritative debtCashTargetByMonth. New additive row field:
//
//   revolvingDebtCash = max(0, monthDebtPayment - cyclingPayment)   [captured AFTER step 3]
//
// Same self-skip pattern as the Tier-A golden test: the real fixture is gitignored.

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

describe('forecast-engine — revolvingDebtCash row field (real data)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('emits a per-month revolving debt cash figure consistent with debtPayment and step-3 surplus', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(capturedAt));

    const { data } = calculateForecast(inputs);

    let prevCumStep3 = 0;
    for (const [i, row] of data.entries()) {
      // Field exists, is a rounded non-negative number, and never exceeds the month's total
      // debt payment (revolving share + cycling share = total; cycling share >= 0).
      expect(typeof row.revolvingDebtCash, `month ${i} field`).toBe('number');
      expect(row.revolvingDebtCash, `month ${i} >= 0`).toBeGreaterThanOrEqual(0);
      expect(row.revolvingDebtCash, `month ${i} <= debtPayment`).toBeLessThanOrEqual(row.debtPayment + 1);

      // The month's step-3 surplus (delta of the cumulative revolving3Extra) is revolving cash
      // by definition, so it must be contained in revolvingDebtCash (±$2 rounding slack).
      const step3ThisMonth = (row.revolving3Extra ?? 0) - prevCumStep3;
      prevCumStep3 = row.revolving3Extra ?? 0;
      expect(row.revolvingDebtCash, `month ${i} contains step-3 surplus`).toBeGreaterThanOrEqual(step3ThisMonth - 2);
    }

    // The projection horizon pays off all revolving debt (Tier-A anchor), so real revolving
    // cash must actually flow: the total must at least cover the sim's month-0 revolving balance.
    const totalRevolvingCash = data.reduce((s, r) => s + (r.revolvingDebtCash ?? 0), 0);
    expect(totalRevolvingCash).toBeGreaterThan(1000);
  });
});
