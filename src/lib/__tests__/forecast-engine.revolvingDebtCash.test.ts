import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { calculateForecast } from '@/lib/forecast-engine';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';

// Phase 2 Option C convergence — per-month revolving debt cash emission.
//
// unify-cycling-model Stage 3: row.revolvingDebtCash is no longer "cash already routed this
// pass" (post-step-3, synchronous with monthDebtPayment) — it is the TARGET for the NEXT
// convergence pass (runDebtCashConvergence → resimulateWithDebtCash → debtCashTargetByMonth):
// the sim's own revolving share (ledgerEntry.revolving) plus any cash surplus above the floor
// not yet routed. Because it is forward-looking, it can legitimately exceed this pass's
// debtPayment — the whole point is to tell the NEXT resim pass to pay more.
//
// Same self-skip pattern as the Tier-A golden test: the real fixture is gitignored.

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

describe('forecast-engine — revolvingDebtCash row field (real data)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('emits a per-month revolving debt cash target that is non-negative and drives real payoff', () => {
    const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers();
    vi.setSystemTime(clock);

    const { data } = calculateForecast(inputs);

    for (const [i, row] of data.entries()) {
      // Field exists and is a rounded non-negative number. It is a forward-looking TARGET for
      // the next convergence pass, so — unlike the pre-Stage-3 model — it is NOT bounded above
      // by this pass's own debtPayment (a real cash surplus this month can legitimately push
      // next month's target above what was actually paid this pass).
      expect(typeof row.revolvingDebtCash, `month ${i} field`).toBe('number');
      expect(row.revolvingDebtCash, `month ${i} >= 0`).toBeGreaterThanOrEqual(0);
    }

    // The projection horizon pays off all revolving debt (Tier-A anchor), so real revolving
    // cash must actually flow: the total must at least cover the sim's month-0 revolving balance.
    const totalRevolvingCash = data.reduce((s, r) => s + (r.revolvingDebtCash ?? 0), 0);
    expect(totalRevolvingCash).toBeGreaterThan(1000);
  });
});
