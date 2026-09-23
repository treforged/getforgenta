// @vitest-environment jsdom
//
// A CAP THAT FLIPS BETWEEN FINITE AND UNCAPPED MUST NOT STOP THE DEBT-CASH LOOP CONVERGING.
//
// Ask d56d5965, 2026-09-23. On /demo with checking at 3,862 and today 2026-10-01, the save-up cap for
// May 2027 onward alternated 548 / uncapped on every pass. The loop's cap damping skips non-finite
// values by design, so nothing damped that flip: a clean period-2 cycle that 200 passes did not
// break. The run fell back to the BASE pair, which paid 4,219 to the cards in Apr 2027 against a
// floor-safe 1,654, ended that month at 1,613 against its own 2,136 safe minimum, and flagged five
// months "below safe minimum" - a plan the app itself calls unsafe. The fix latches such a month to
// its latest finite cap (forecast-convergence.ts, "CAP REGIME LATCH").
//
// ⚠️ THE CASE IS A REAL APP RUN, NOT A HAND-BUILT PAIR. `runDemoAsApp` renders the app's own
// CardProjectionProvider in demo mode; only the demo checking balance is moved. Proven red on the
// pre-fix convergence code: converged=false and five below-minimum months on the first date.
//
// Covers: convergence, and no below-safe-minimum month in 24, on three dates. It does NOT cover a
// real user's data, or whether the latched finite cap is the tightest safe one.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoAsApp } from './fixtures/demo-forecast-harness';

/** The checking balance that produced the oscillation. The shipped fixture holds 4,231 (b0822110). */
const OSCILLATING_CHECKING = 3862;

vi.doMock('@/lib/demo-data', async (orig) => {
  const m = await orig<typeof import('@/lib/demo-data')>();
  return {
    ...m,
    demoAccounts: m.demoAccounts.map(a => (a.id === 'd1' ? { ...a, balance: OSCILLATING_CHECKING } : a)),
  };
});

describe('debt-cash convergence with a cap that flips between finite and uncapped', () => {
  afterEach(() => vi.useRealTimers());

  it('control: the moved balance reaches the run', async () => {
    // Without this, a mock that silently failed to apply would test the shipped fixture instead.
    const { demoAccounts } = await import('@/lib/demo-data');
    expect(demoAccounts.find(a => a.id === 'd1')?.balance).toBe(OSCILLATING_CHECKING);
  });

  it('converges, and publishes no month below its own safe minimum, on every date', async () => {
    // Oct 1 and Sep 23 oscillated before the fix; Sep 2 converged either way and is the control.
    const dates = [new Date(2026, 9, 1, 12), new Date(2026, 8, 23, 12), new Date(2026, 8, 2, 12)];
    const failures: string[] = [];
    let measured = 0;
    for (const now of dates) {
      const app = await runDemoAsApp(now);
      vi.useRealTimers();
      const day = now.toDateString();
      if (!app.converged) failures.push(`${day}: did not converge`);
      const below = (app.forecast.data as unknown as { month: string; belowSafeMinimum?: boolean }[])
        .slice(0, 24).filter(r => r.belowSafeMinimum === true).map(r => r.month);
      if (below.length) failures.push(`${day}: below safe minimum in ${below.join(', ')}`);
      measured++;
    }
    expect(failures, failures.join('\n')).toEqual([]);
    expect(measured).toBe(dates.length);
  }, 300_000);
});
