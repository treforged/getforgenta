// @vitest-environment jsdom
//
// rankBreachLevers on Tre's own 2026-09-29 capture (gitignored, so this skips in CI).
//
// `run` is the production shape: runDebtCashConvergence against the card projection rendered
// ONCE from the untouched rows. That shortcut is only honest because it was measured on this
// capture: pausing the move fund or the owners transfer gave month-end cash identical, to the
// dollar in every month, to a full re-render of the sim with the change applied. A card-charged
// expense did NOT (the fixed sim hid it entirely), which is why the helper never offers one.
//
// The pins below were first measured by a full re-render per scenario (R000 report to Sam,
// 2026-09-29), and are asserted here through the helper.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';
import type { ForecastInputs } from '@/lib/forecast-engine';
import { rankBreachLevers } from '@/lib/breach-levers';
import { reviveForecastCapture } from './fixtures/forecast-fixture-io';
import { renderProjectionFromFixture } from './fixtures/projection-harness';

const FIXTURE = join(__dirname, 'fixtures', 'forecast-inputs.real.LEVERS-2026-09-29.json');
const maybeIt = existsSync(FIXTURE) ? it : it.skip;

describe('rankBreachLevers on the 2026-09-29 capture', () => {
  afterEach(() => vi.useRealTimers());

  maybeIt('ranks his own moves by measured dollars and never offers retirement', () => {
    const { clock, inputs } = reviveForecastCapture(readFileSync(FIXTURE, 'utf8'));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    const base = renderProjectionFromFixture(inputs);
    const run = (i: ForecastInputs) => runDebtCashConvergence(base, i).projections;

    const r = rankBreachLevers(inputs, run, { horizonMonths: 12, maxLevers: 5 });

    // Positive control: the base run is the one Sam was sent, month by month.
    expect(r.months.map(m => [m.month, Math.round(m.shortfall)])).toEqual(PINNED_MONTHS);
    expect(r.levers.map(l => [l.name, Math.round(l.coveredDollars), l.monthsCleared])).toEqual(PINNED_LEVERS);
    expect(r.levers.find(l => l.name === 'Owners Contribution')?.paysRules.sort())
      .toEqual(['Claude', 'Google Workspace', 'Plaid', 'QUO']);

    const offered = r.levers.map(l => l.name);
    expect(offered).not.toContain('401K Roth');
    expect(offered).not.toContain('Roth IRA');
    expect(r.excluded).toEqual(expect.arrayContaining([{ name: '401K Roth', reason: 'retirement' }]));
  }, 120_000);
});

// Oct-Mar match the R000 report exactly; Aug 2027 is past that report's window.
const PINNED_MONTHS: [string, number][] = [
  ['Oct 2026', 1174], ['Nov 2026', 1698], ['Dec 2026', 1567], ['Jan 2027', 1018], ['Mar 2027', 962], ['Aug 2027', 155],
];
// Owners and Move fund reconcile exactly with the full per-scenario re-renders in R000
// (6,574 total short; 3,925 left without Owners, 5,384 left without Move fund).
// Fidelity is a BROKERAGE account, so it is a lever; the 401k and Roth IRA never are.
const PINNED_LEVERS: [string, number, string[]][] = [
  ['Owners Contribution', 2649, ['Aug 2027']],
  ['Move fund, then emergency fund', 1190, ['Aug 2027']],
  ['Fidelity', 429, []],
];
