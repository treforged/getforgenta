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

// Oct-Mar match the R000 report exactly. RE-PINNED 2026-09-30 (e3566eab): this capture pays more
// out of the move account than it will hold (a duplicate $3,830 fee, removed from his data later
// that day), and the engine used to clamp that account at $0 so the rest was paid by NOBODY. The
// unfunded dollars now come out of cash from their month onward, which adds Jul and Sep 2027 and
// raises Aug from 155 to 1,785. The pre-fix pins were Aug 2027 155 and three levers.
// RE-PINNED AGAIN 2026-09-30 (f3c0cdf5): the unfunded dollars are now paid inside the engine's cash
// chain, so the sim pays the cards less in those months instead of shortfallByMonth charging the gap
// again for every later month. Same months short; Jul/Aug/Sep 2027 fall from 556/1,785/1,429 to
// 343/1,571/1,044. Proven red by removing the cash subtraction (the old figures return).
const PINNED_MONTHS: [string, number][] = [
  ['Oct 2026', 1174], ['Nov 2026', 1698], ['Dec 2026', 1567], ['Jan 2027', 1018], ['Mar 2027', 962],
  ['Jul 2027', 343], ['Aug 2027', 1571], ['Sep 2027', 1044],
];
// Owners reconciles with the R000 per-scenario re-render for Oct-Mar. The move fund is NO LONGER a
// lever, and that is the fix working: the fund pays the move expenses itself, so pausing its
// contributions only moved the bill onto the unfunded remainder - it never freed real cash (it
// showed 1,190 "covered" before). Fidelity is a BROKERAGE account, so it is a lever; the 401k and
// Roth IRA never are.
// f3c0cdf5: Owners 4,423 -> 5,264 and now clears Sep 2027 as well; Fidelity ($25/mo) drops below
// MIN_COVERED_DOLLARS. Its old 702 came from the separate unfunded charge, which let freed dollars
// pile up in checking until Jul 2027. In the real cash chain, cash above the floor in the months
// between goes to the cards, so those $25s never reach July.
const PINNED_LEVERS: [string, number, string[]][] = [
  ['Owners Contribution', 5264, ['Jul 2027', 'Sep 2027']],
];
