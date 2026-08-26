// @vitest-environment jsdom
//
// REAL-DATA regression for the getAugmentedMinSafeCash floor-regime bistability (queued from the
// 2026-08-25 deficit investigation, root-caused in 8c15ed1a's commit body).
//
// THE MECHANISM. A statement-preference card's floor reservation is computed from the sim's
// end-of-month revolving balance: revBal > 0 reserves the FORMULA minimum on that balance
// (~$47.23 on Discover's dying ~$30-100 tail), revBal === 0 reserves the static configured
// min_payment ($253.00) via the cycling branch. Near the payoff month the two regimes differ by
// $205.77, and the discontinuity points the WRONG way for a fixed-point loop: paying the card
// off RAISES that month's floor retroactively, which lowers the next pass's payment target,
// which un-pays the card, which lowers the floor back. On the 2026-07-20 capture an $8,000 April
// 2027 shock lands Discover's payoff tail exactly on m17 (Dec 2027) and the engine↔resim loop
// falls into a genuine period-3 cycle (per-pass gaps 50 → 99 → 71 repeating, floors
// 3098.12 / 2892.35 alternating), exhausting all 24 passes and publishing the base fallback with
// a $95.90 breach. Measured 2026-08-25; present in all four old/new build combinations.
//
// THE FIX (src/lib/floor-min-latch.ts): runDebtCashConvergence threads a per-run latch into
// getAugmentedMinSafeCash. A (month, card) reservation that changes regime TWICE within one run
// — the flicker signature, impossible for a monotone payoff-date drift — is pinned at the larger
// regime's amount for the rest of the run, making the floor term monotone from that pass on. The
// larger amount is the safe side: the floor reads cash LOW, never high. One-pass convergence
// (the untouched capture, the golden fixtures) can never engage the latch — two regime CHANGES
// need three engine runs.
//
// Self-skips when the gitignored fixture is absent, like forecast-convergence.realData and
// forecast-convergence.floorDeficit. The latch's pure state machine is unit-tested without the
// fixture in floor-min-latch.test.ts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.json');
const maybeIt = existsSync(FIXTURE) ? it : it.skip;

const SHOCK_KEY = '2027-04';
const SHOCK_DATE = '2027-04-15';

function withShock(i: ForecastInputs, amount: number): ForecastInputs {
  const proto = i.transactions[0];
  return {
    ...i,
    transactions: [
      ...i.transactions,
      {
        ...proto, id: 'floor-flicker-shock', date: SHOCK_DATE, type: 'expense', amount,
        category: 'Other', note: 'regression shock', payment_source: null, car_build_item_id: null,
      } as typeof proto,
    ],
    oneTimeByMonth: {
      ...i.oneTimeByMonth,
      [SHOCK_KEY]: {
        income: i.oneTimeByMonth[SHOCK_KEY]?.income ?? 0,
        expense: (i.oneTimeByMonth[SHOCK_KEY]?.expense ?? 0) + amount,
      },
    },
  };
}

function load() {
  const { capturedAt, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(capturedAt));
  return inputs;
}

describe('floor-regime flicker — real capture', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('converges the $8,000 April shock instead of 3-cycling to exhaustion', () => {
    // Before the latch this ran all 24 passes in a period-3 cycle and published the base
    // fallback (converged=false). The assertion is convergence itself — the one thing the
    // flicker makes impossible — at the default pass budget; raising maxPasses can never pass
    // this, because a true 3-cycle survives any budget. Measured 2026-08-25: converges in 19
    // passes with the latch, m17's floor pinned at the cycling regime's $3,098.12.
    const inputs = withShock(load(), 8000);
    const out = runDebtCashConvergence(renderProjectionFromFixture(inputs), inputs);

    expect(out.converged).toBe(true);

    // WHAT THIS DOES NOT CLAIM: a breach-free April. The converged fixed point leaves the shock
    // month itself under floor (measured -$2,132.71, with a $17.77 May tail) — the same
    // structural deficit residue every neighbouring shock size in this family already converges
    // onto WITHOUT any latch involvement (6000 → -$636.96, 6500 → -$1,135.98, 7000 → -$1,384.25,
    // 7500 → -$1,632.54, all measured on unmodified pre-latch code; 8000's residue continues that
    // line, and the latched month m17 is eight months downstream of April so it cannot cause it).
    // That residue is the separately-queued deficit slice. What IS pinned here is that the
    // residue stays confined to the shock months instead of spreading — new breach months
    // elsewhere would mean the latch broke something the deficit machinery was covering.
    const breachMonths = out.projections.data
      .filter(r => r.rawEndingCash < r.rawMonthMinSafe - 0.005)
      .map(r => r.month);
    expect(breachMonths.every(m => m === 'Apr 2027' || m === 'May 2027')).toBe(true);
    const worst = out.projections.data.reduce((w, row) =>
      Math.min(w, row.rawEndingCash - row.rawMonthMinSafe), Infinity);
    expect(worst).toBeGreaterThan(-2200);
  }, 900000);

  maybeIt('leaves the rest of the shock family untouched — still converging, latch or no latch', () => {
    // These four converge in 11-18 passes on pre-latch code, so their transients are exactly
    // where an over-eager latch could engage and move a converged output. Measured 2026-08-25:
    // pass counts and worst-breach figures byte-identical with and without the latch across the
    // whole 500..8000 family; convergence is the cheap invariant worth re-asserting forever.
    for (const size of [3500, 5500, 6500, 7500]) {
      vi.useRealTimers();
      const inputs = withShock(load(), size);
      const out = runDebtCashConvergence(renderProjectionFromFixture(inputs), inputs);
      expect(out.converged, `shock ${size} must converge`).toBe(true);
    }
  }, 900000);

  maybeIt('leaves the untouched capture byte-identical (latch provably inert at 1 pass)', () => {
    // Two regime changes need three engine runs; a 1-pass convergence performs exactly two
    // (base + pass 1), so the latch cannot engage and nothing may move.
    const inputs = load();
    const out = runDebtCashConvergence(renderProjectionFromFixture(inputs), inputs);

    expect(out.converged).toBe(true);
    expect(out.passes).toBe(1);
    expect(out.projections.data.filter(r => r.belowSafeMinimum)).toEqual([]);
    expect(out.projections.milestones.find(m => m.event.startsWith('CC Debt Free'))?.month).toBe('Jul 2027');
  }, 900000);
});
