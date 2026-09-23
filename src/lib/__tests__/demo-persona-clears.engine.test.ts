// @vitest-environment jsdom
//
// THE DEMO PERSONA CAN BE HELPED: ITS CARDS CLEAR INSIDE FIVE YEARS AND MONTH 0 ENDS ABOVE THE FLOOR.
//
// Ask 43591a28, 2026-09-23. /demo is a prospect's first screen and the only source for store images.
// It opened on "YOUR CARD PAYOFF DATE: Not within 5 years" and "Cash below safe minimum", while
// `demo-marketing-lines.engine.test.ts` stayed green and quoted "clears in Dec 2027".
//
// ⚠️ WHY THAT GREEN WAS BLIND. The marketing lines then read a hand-built harness that passed debts,
// goals, car funds and transactions as EMPTY, and car funds alone were enough to stop the cards
// clearing. This file reads `runDemoAsApp`: the app's own `CardProjectionProvider` in demo mode, where
// the app's data hooks return the fixture. Nothing here assembles inputs.
//
// ⚠️ AND IT RE-IMPORTS THE FIXTURE PER DATE (inside `runDemoAsApp`). demo-data.ts computes every date
// at IMPORT time, and the app always imports on the day it runs, so a sweep of dates only means what
// /demo would show on each day if the module registry is reset after the clock is set.
//
// Covers: the Forecast's "CC Debt Free" milestone (the date the Dashboard and the Forecast show), the
// Forecast's below-safe-minimum flags for 24 months, and the card simulation's month-0 end cash. It does
// NOT cover the Garage, rendered frames, or light mode.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoAsApp } from './fixtures/demo-forecast-harness';

/** "Within 5 years" is the Dashboard's own horizon: `aggregatePayoffEta` reads a 60-month sim. */
const MAX_PAYOFF_MONTHS = 60;

/** The 2nd (before most bills) and the 23rd (after), every other month for a year. */
function sweepDates(): Date[] {
  const out: Date[] = [];
  for (let k = 0; k < 12; k += 2) {
    for (const day of [2, 23]) out.push(new Date(2026, 8 + k, day, 12));
  }
  return out;
}

const monthsBetween = (from: Date, label: string) => {
  const d = new Date(`${label} 1`);
  return (d.getFullYear() - from.getFullYear()) * 12 + (d.getMonth() - from.getMonth());
};

describe('the demo persona is someone the app can help', () => {
  afterEach(() => vi.useRealTimers());

  it('control: the run reads the fixture the app reads (car funds are present)', async () => {
    // Every absence below is only evidence if the inputs that caused the defect are in the run.
    const app = await runDemoAsApp(new Date(2026, 8, 23, 12));
    expect(app.carFunds).toBeGreaterThan(0);
  }, 60_000);

  it(`clears the cards inside ${MAX_PAYOFF_MONTHS} months, with no month below the floor, on every date`, async () => {
    const dates = sweepDates();
    const failures: string[] = [];
    let measured = 0;
    for (const now of dates) {
      const app = await runDemoAsApp(now);
      vi.useRealTimers();
      const day = now.toDateString();
      const debtFree = app.forecast.milestones.find(m => m.event.includes('CC Debt Free'));
      if (!debtFree) failures.push(`${day}: no CC Debt Free milestone`);
      else if (monthsBetween(now, debtFree.month) > MAX_PAYOFF_MONTHS) failures.push(`${day}: debt free ${debtFree.month}`);
      const below = (app.forecast.data as unknown as { month: string; belowSafeMinimum?: boolean }[])
        .slice(0, 24).filter(r => r.belowSafeMinimum === true).map(r => r.month);
      if (below.length) failures.push(`${day}: below safe minimum in ${below.join(', ')}`);
      const endCash = app.cardProjection.month0?.endCash;
      if (endCash == null) failures.push(`${day}: no month 0`);
      else if (endCash < app.cashFloor) failures.push(`${day}: month 0 ends at ${endCash.toFixed(2)}, below ${app.cashFloor}`);
      measured++;
    }
    expect(failures, failures.join('\n')).toEqual([]);
    // Every date was measured, so a silent skip cannot pass.
    expect(measured).toBe(dates.length);
  }, 300_000);
});
