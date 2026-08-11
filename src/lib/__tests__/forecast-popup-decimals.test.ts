// @vitest-environment jsdom
//
// N8 (Tre, 2026-08-09): "all numbers in the forecast pop ups should show decimal places, not
// just part of them." The Month Breakdown popup now renders the raw* balance fields with cents
// while the chart/table keep the rounded fields. This pins the contract between the two:
//
// 1. Every raw* variant rounds to its display twin — the popup and the table must never print
//    different dollars for the same fact (the §1.1 failure mode, see monthEndCash.invariant).
// 2. The raw fields genuinely carry sub-dollar precision somewhere in the projection — if a
//    future edit re-rounds them at the push site, the popup silently regresses to ".00"
//    everywhere and this fails.
//
// Self-skips when the gitignored real fixture is absent (same pattern as
// forecast-engine.goldenTierA.test.ts and monthEndCash.invariant.test.ts).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

describe('forecast popup decimals — raw balance fields agree with their rounded display twins', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('every raw* field rounds to the chart/table field, and raws are not pre-rounded', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capturedAt));

    const out = runDebtCashConvergence(renderProjectionFromFixture(inputs), inputs);
    const rows = out.projections.data;
    expect(rows.length).toBeGreaterThan(0);

    const pairs: [string, string][] = [
      ['rawNetWorth', 'netWorth'],
      ['rawTotalAssets', 'totalAssets'],
      ['rawTotalLiabilities', 'totalLiabilities'],
      ['rawCcDisplayBalance', 'ccDisplayBalance'],
      ['rawTotalCCPurchases', 'totalCCPurchases'],
    ];

    let sawCents = false;
    for (const [i, row] of rows.entries()) {
      const r = row as unknown as Record<string, number>;
      for (const [raw, display] of pairs) {
        expect(typeof r[raw], `${raw} missing on month ${i}`).toBe('number');
        expect(
          Math.round(r[raw]),
          `month ${i}: ${raw} $${r[raw]} does not round to ${display} $${r[display]} — popup and table disagree`,
        ).toBe(r[display]);
        if (!Number.isInteger(r[raw])) sawCents = true;
      }
      // The popup's per-account lines read these arrays directly — they must be unrounded too.
      for (const a of row.assetBreakdown) {
        if (!Number.isInteger(a.balance)) sawCents = true;
      }
      // Raw identity the popup implies on screen: assets − liabilities = net worth, to the cent.
      expect(
        Math.abs(r.rawTotalAssets - r.rawTotalLiabilities - r.rawNetWorth),
        `month ${i}: rawTotalAssets − rawTotalLiabilities ≠ rawNetWorth`,
      ).toBeLessThanOrEqual(0.01);
    }

    // Growth compounding on real balances cannot stay whole-dollar across the whole horizon.
    // If everything is an integer, someone re-rounded the raw fields at the push site.
    expect(sawCents, 'no raw balance carries cents anywhere — raws were re-rounded').toBe(true);
  });
});
