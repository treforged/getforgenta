// @vitest-environment jsdom
//
// The floor look-ahead's walk against the engine's real cash, on Tre's own 2026-09-29 capture
// (gitignored, so this skips in CI; the synthetic twin is floor-protection.walkTracksReal.test.ts).
// Ask e2850463.
//
// Measured on this capture before the fix: the walk ran up to $5,687.96 BELOW real ending cash
// (Feb 2028) and $881.57 below in Oct 2026. Two causes, both fixed in PASS 2:
//   - it charged $973.45 a month of static card minimums while the sim paid $412.95 once two cards
//     had cleared ($560.50 a month of phantom outflow);
//   - it subtracted every planned goal contribution in months where PASS 3 contributed $0.
// After the fix the worst month is Oct 2026 at -$678.83, which is a different and SAFE-direction
// residue: an interest-saving statement pin of $1,451.88 the walk reserves for, which the sim cannot
// afford that month (it pays the $773.05 contract minimum; Oct 2026 ends below its floor anyway).
//
// The window ends at the first month a ranked automatic extra payment takes money: the walk does
// not model that discretionary diversion (pre-existing, outside ask e2850463), so from there on its
// cash runs above real cash by whatever was diverted. Those reserves are themselves clamped to
// `requiredEndByMonth`, which is why they do not breach a floor.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.LEVERS-2026-09-29.json');
const maybeIt = existsSync(FIXTURE) ? it : it.skip;

/** Measured after the fix: -678.83 (Oct 2026). Pre-fix: -5,127.46 inside this same window. */
const MAX_BELOW = 700;
/** The walk may not run ABOVE real cash: that is the direction that breaches a floor. */
const MAX_ABOVE = 5;

describe('PASS 2 walk on the 2026-09-29 capture', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('stays within $700 below and $5 above real cash until the first automatic extra', () => {
    const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    const base = renderProjectionFromFixture(inputs);
    const out = runDebtCashConvergence(base, inputs);
    expect(out.converged).toBe(true);
    const rows = out.projections.data;
    const walk = out.projections.lookAheadWalkEndByMonth;
    expect(walk).toBeDefined();

    const firstAutoExtra = rows.findIndex(r => r.autoExtraItems.length > 0);
    const end = firstAutoExtra < 0 ? rows.length : firstAutoExtra;
    // Positive control: the window is long enough to have caught the old drift, which reached
    // -$1,795 by Jan 2027 and -$5,127 by Nov 2027 on this capture.
    expect(end, 'window length').toBeGreaterThanOrEqual(12);

    const gaps = rows.slice(1, end).map((r, k) => ({ month: r.month, gap: walk![k + 1] - r.rawEndingCash }));
    for (const g of gaps) {
      expect(g.gap, `${g.month} walk minus real`).toBeGreaterThanOrEqual(-MAX_BELOW);
      expect(g.gap, `${g.month} walk minus real`).toBeLessThanOrEqual(MAX_ABOVE);
    }

    // Months below floor did not grow: 9 before the fix (Jul 2027 343.41 among them), 8 after.
    const below = rows.filter(r => r.rawEndingCash < r.rawMonthMinSafe - 0.005).map(r => r.month);
    expect(below).toEqual([
      'Sep 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027', 'Mar 2027', 'Aug 2027', 'Sep 2027',
    ]);
  }, 120_000);
});
