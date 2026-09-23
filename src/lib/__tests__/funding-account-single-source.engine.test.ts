// @vitest-environment jsdom
//
// THE SIM AND THE FORECAST MUST AGREE ON WHICH ACCOUNT PAYS THE CARDS.
//
// Ask a5b13315, 2026-09-23. The sim resolved its funding account from the browser-local choice
// (`tre:debt:fundingAccount`) first; the forecast resolved it from the profile only. On /demo, whose
// profile names no deposit account, choosing Harborline Checking (d2) made the sim pay 686 from d2 and
// end month 0 at 1,070, while the forecast charged the SAME 686 against Northvale (d1) and ended month
// 0 at 2,978 - so the forecast showed the wrong account falling. Measured: 2,978 + 686 = 3,664 =
// the no-choice run's 2,672 + 992. Proven red on the pre-fix context.
//
// Covers: month 0 on one date, with and without the choice. It does NOT cover a profile value that
// disagrees with a stale browser choice (demo has no profile value); that order is set in
// CardProjectionContext and stated there.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { runDemoAsApp } from './fixtures/demo-forecast-harness';

const KEY = 'tre:debt:fundingAccount';
const NOW = new Date(2026, 8, 23, 12);

type Month0 = { month0?: { endCash: number }; debtFundingAccountId?: string | null };
type Row = { rawEndingCash: number };

describe('one funding account for the sim and the forecast', () => {
  afterEach(() => { window.localStorage.removeItem(KEY); vi.useRealTimers(); });

  it('control: with no choice, the sim and the forecast both use Northvale (d1)', async () => {
    window.localStorage.removeItem(KEY);
    const app = await runDemoAsApp(NOW);
    const cp = app.cardProjection as unknown as Month0;
    expect(cp.debtFundingAccountId).toBe('d1');
    expect(Math.round((app.forecast.data as unknown as Row[])[0].rawEndingCash)).toBe(Math.round(cp.month0!.endCash));
  }, 120_000);

  it('a chosen account (d2) is the one BOTH sides show paying the cards', async () => {
    window.localStorage.setItem(KEY, JSON.stringify('d2'));
    const app = await runDemoAsApp(NOW);
    const cp = app.cardProjection as unknown as Month0;
    // The choice must reach the run, or the next assertion compares two d1 runs and proves nothing.
    expect(cp.debtFundingAccountId).toBe('d2');
    expect(Math.round((app.forecast.data as unknown as Row[])[0].rawEndingCash), 'forecast month-0 end vs sim month-0 end')
      .toBe(Math.round(cp.month0!.endCash));
  }, 120_000);
});
