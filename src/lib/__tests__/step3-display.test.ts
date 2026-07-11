// Unified PASS-3 display adjustment (see src/lib/step3-display.ts).
//
// Root cause being locked down: the Forecast popup subtracted the ENGINE's cumulativeStep3Extra
// (revolving3Extra) from card balances while the Debt Payoff tab showed raw SIM balances with the
// HOOK's surplus lines — two different derivations of "pass-3 extras" that disagree numerically
// (live repro 2026-07-07: Prime Visa popup $3,901 vs accordion $4,270 for Sep 2026). Every display
// surface now subtracts the HOOK's per-card cumulative surpluses (perCardPaymentsScaled[].surpluses)
// via step3-display.ts, and the engine's Total CC line must match that per-card derivation exactly.
//
// The fixture test self-skips when the (gitignored, real-data) fixture is absent — same pattern as
// forecast-engine.goldenTierA.test.ts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { calculateForecast } from '@/lib/forecast-engine';
import { cumulativeSurplusesByCard, adjustedDisplayBalance } from '@/lib/step3-display';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const hasFixture = existsSync(FIXTURE);
const maybeIt = hasFixture ? it : it.skip;

describe('cumulativeSurplusesByCard', () => {
  it('accumulates each card\'s surpluses independently', () => {
    const cum = cumulativeSurplusesByCard([
      { id: 'a', surpluses: [0, 347, 3, 0, 0] },
      { id: 'b', surpluses: [0, 0, 0, 10, 0] },
    ]);
    expect(cum.get('a')).toEqual([0, 347, 350, 350, 350]);
    expect(cum.get('b')).toEqual([0, 0, 0, 10, 10]);
  });

  it('handles undefined input and missing surpluses', () => {
    expect(cumulativeSurplusesByCard(undefined).size).toBe(0);
    expect(cumulativeSurplusesByCard([{ id: 'a', surpluses: [] }]).get('a')).toEqual([]);
  });
});

describe('adjustedDisplayBalance', () => {
  it('subtracts the cumulative surplus and floors at zero', () => {
    expect(adjustedDisplayBalance(3517, 347)).toBe(3170);
    expect(adjustedDisplayBalance(100, 350)).toBe(0);
    expect(adjustedDisplayBalance(0, 0)).toBe(0);
  });
});

describe('forecast-engine Total CC line — unified with per-card display (real fixture)', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('ccDisplayBalance subtracts the HOOK per-card surpluses, matching the popup lines', () => {
    const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(capturedAt));

    const result = calculateForecast(inputs);
    const cpd = inputs.cardProjectionData!;
    const cum = cumulativeSurplusesByCard(cpd.perCardPaymentsScaled);

    let monthsWithAdjustment = 0;
    for (let i = 0; i < result.data.length; i++) {
      const row = result.data[i];
      const hookRow = cpd.data?.[i];
      if (!hookRow) break;
      // Same per-card, revolving-gated subtraction the popup applies to its card lines:
      // only cards still carrying revolving debt get adjusted, capped at their own balance.
      const perCardAdj = (cpd.simCards ?? []).reduce((s: number, c: { id: string }) => {
        const revBal = cpd.monthlyRevolvingBalances?.get(c.id)?.[i] ?? 0;
        if (revBal <= 0) return s;
        const trueBal = cpd.monthlyBalances?.get(c.id)?.[i] ?? 0;
        return s + (trueBal - adjustedDisplayBalance(trueBal, cum.get(c.id)?.[i] ?? 0));
      }, 0);
      if (perCardAdj > 1) monthsWithAdjustment++;
      const expected = Math.round(Math.max(0, (hookRow.displayCCBalance ?? 0) - perCardAdj));
      expect(
        Math.abs((row.ccDisplayBalance ?? 0) - expected),
        `${row.month}: ccDisplayBalance=${row.ccDisplayBalance} expected=${expected} (perCardAdj=${Math.round(perCardAdj)})`,
      ).toBeLessThanOrEqual(2);
    }
    // Guard against a vacuous pass: the fixture must actually exercise the adjustment
    // (it routes ~$350 of surplus to Prime Visa in Aug–Sep 2026).
    expect(monthsWithAdjustment).toBeGreaterThan(0);
  });
});
