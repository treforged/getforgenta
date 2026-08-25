// @vitest-environment jsdom
//
// REAL-DATA regression for the two deficit fixes of 2026-08-25, run through the full loop (real
// sim ↔ real engine via runDebtCashConvergence) rather than against calculateForecast alone:
//
//   1. computeFloorProtection's reserve chain now targets each month's OWN floor, not only the next
//      month's (see floor-protection.ownFloor.test.ts for the isolated proof).
//   2. A goal contribution backs off rather than pushing a month under its floor, and pauseSavings
//      reaches it at all (see forecast-engine.savingsBackOff.test.ts).
//
// Both were measured on the gitignored 2026-07-20 capture, which is where a floor STEP DOWN
// actually occurs (Apr 2027's $3,332.12 against May's $2,800) — a synthetic fixture with flat
// floors cannot see defect 1 at all, which is exactly why it survived so long. Self-skips when the
// fixture is absent, like forecast-engine.goldenTierA and forecast-convergence.realData.
//
// THE UNTOUCHED CAPTURE MUST NOT MOVE. Measured old-vs-new across all 60 projected months on
// 2026-08-25: identical ending cash, floor, savings line, debt payment and milestones, converging
// in the same single pass. Neither fix fires on it — every month already ends above its floor and
// no month is short — so the guard here is that they stay quiet, not that they do something.
//
// The shock case is the one that moves. A $5,000 one-time April 2027 expense, visible to BOTH
// halves (a transaction row for the sim, an oneTimeByMonth entry for the engine), used to leave
// Apr 2027 $1,335.85 under its floor. It now breaches by nothing at all.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';

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
        ...proto, id: 'floor-deficit-shock', date: SHOCK_DATE, type: 'expense', amount,
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

describe('deficit fixes — real capture', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('leaves the untouched capture converging in one pass with no breach', () => {
    const inputs = load();
    const out = runDebtCashConvergence(renderProjectionFromFixture(inputs), inputs);

    expect(out.converged).toBe(true);
    expect(out.passes).toBe(1);
    expect(out.projections.data.filter(r => r.belowSafeMinimum)).toEqual([]);
    // The pin the golden tests carry, restated here because it runs through the CONVERGED loop.
    expect(out.projections.milestones.find(m => m.event.startsWith('CC Debt Free'))?.month).toBe('Jul 2027');
    // Neither fix may invent a savings change on a capture where nothing is short: the capture's
    // goals contribute $100/mo for four months and every one of them is affordable.
    expect(out.projections.data.reduce((s, r) => s + r.savingsContrib, 0)).toBeCloseTo(400, 2);
  }, 900000);

  maybeIt('absorbs a $5,000 April shock without breaching the floor', () => {
    const inputs = withShock(load(), 5000);
    const out = runDebtCashConvergence(renderProjectionFromFixture(inputs), inputs);

    // Before the fixes this converged too — to a plan that left Apr 2027 $1,335.85 short. The
    // look-ahead was reserving against May's $2,800 rather than April's own $3,3xx floor, so the
    // months before it banked ~$530 too little, and the $100 goal contribution went out anyway.
    expect(out.converged).toBe(true);
    const breaches = out.projections.data
      .filter(r => r.belowSafeMinimum)
      .map(r => ({ month: r.month, short: +(r.rawMonthMinSafe - r.rawEndingCash).toFixed(2) }));
    expect(breaches).toEqual([]);

    // Mechanism, so a future regression cannot pass this by simply lowering the floor: April still
    // carries a floor materially ABOVE May's, and the cash walk clears it.
    const apr = out.projections.data.findIndex(r => r.month === 'Apr 2027');
    expect(apr).toBeGreaterThan(0);
    expect(out.projections.data[apr].rawMonthMinSafe)
      .toBeGreaterThan(out.projections.data[apr + 1].rawMonthMinSafe);
    expect(out.projections.data[apr].rawEndingCash)
      .toBeGreaterThanOrEqual(out.projections.data[apr].rawMonthMinSafe);
  }, 900000);

  maybeIt('moves the capture savings line when pauseSavings is toggled', () => {
    // The measured symptom: this delta was exactly $0.00. calculateForecast directly (no
    // convergence loop) — the toggle's effect on the savings line does not depend on the sim.
    const inputs = load();
    const on = calculateForecast({ ...inputs, pauseSavings: true });
    const off = calculateForecast({ ...inputs, pauseSavings: false });

    const total = (r: typeof on) => r.data.reduce((s, row) => s + row.savingsContrib, 0);
    expect(total(off)).toBeCloseTo(400, 2);
    expect(total(on)).toBe(0);
    expect(total(off) - total(on)).toBeCloseTo(400, 2);
  }, 900000);
});
