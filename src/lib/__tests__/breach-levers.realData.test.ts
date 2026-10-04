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
    // e2f7101f excluded the Owners transfer as delays_debt_payoff; b520a4e7 brought it back as a
    // lever - see the re-pin note under PINNED_LEVERS.
    expect(r.excluded.map(e => e.name)).not.toContain('Owners Contribution');

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
// RE-PINNED 2026-10-03 (4066ff23): monthMinSafe keeps cents instead of a whole-dollar round, so
// Aug 2027 reads 1,572 (was 1,571). One dollar from rounding; every other month is unchanged.
// RE-PINNED 2026-10-04 (e2850463): PASS 2's floor look-ahead walk now charges the minimum the sim
// actually pays per card (not today's static minimums summed over every card) and lets a goal
// contribution give way in a month that cannot afford it, as PASS 3 does. Its walk had run up to
// $5,687.96 below real cash on this capture, so the caps held the cards back for money that was
// still in checking. Oct 2026-Mar 2027 are unchanged to the dollar; Jul 2027 (343) is no longer
// short, and Aug/Sep 2027 fall from 1,572/1,044 to 1,145/617. Was:
// ['Jul 2027', 343], ['Aug 2027', 1572], ['Sep 2027', 1044].
const PINNED_MONTHS: [string, number][] = [
  ['Oct 2026', 1174], ['Nov 2026', 1698], ['Dec 2026', 1567], ['Jan 2027', 1018], ['Mar 2027', 962],
  ['Aug 2027', 1145], ['Sep 2027', 617],
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
// RE-PINNED 2026-10-04 against the capture in forecast-inputs.real.LEVERS-2026-09-29.json (the
// "always pay this" pin now sits in both floor look-aheads): Owners 5,264 -> 5,051. The base run is
// unchanged to the dollar (PINNED_MONTHS above). Only the Owners-paused arm moves: in Jul 2027 it
// used to pay Prime Visa $609.62 against its $773.05 contract minimum and now pays $823.05, so that
// $213.43 is no longer left in checking to cover August (Aug 2027 short 188 -> 402, Sep 2027 card
// pay 1,122 -> 908). The old 5,264 counted $213 the plan only had by under-paying a minimum.
// RE-PINNED 2026-10-04 (e2f7101f): NO LEVER IS LEFT, and that is the fix working. The Owners
// transfer ($145 + $65 a month into General Operations) is the money that pays that account's bills
// (Claude, Google Workspace, Plaid, QUO: $140.90 a month here). With it paused, General Operations
// ran dry and the engine debited the bills from nobody, so the arm "freed" the whole $210 and showed
// 5,051 covered. Now the part the empty account cannot pay comes out of checking (130.87 in Oct 2026,
// then 140.90 a month), so pausing frees only ~$69 a month: the arm's 12-month shortfall is
// 9,065.06 against the base's 9,379.72, and the payoff moves Aug 2029 -> Sep 2029, so the helper
// excludes it as delays_debt_payoff.
// The base run is unchanged to the dollar (PINNED_MONTHS above).
// Was: ['Owners Contribution', 5051, ['Jul 2027', 'Sep 2027']].
// RE-PINNED 2026-10-04 (b520a4e7): PASS 2's floor look-ahead now reserves for the checking-paid
// part of an account-paid bill. The base run's months short are unchanged to the dollar (PINNED_MONTHS
// above; Jul/Aug/Sep 2027 move by cents: 343.36/1,571.68/1,043.97 -> 343.41/1,571.73/1,044.02), but
// the reserve for the move fund's Jul 2027 shortfall ($1,630.35 paid from checking) now moves the
// BASE payoff Aug 2029 -> Sep 2029 (interest 7,001.31 -> 7,158.85). The Owners-paused arm also pays
// off Sep 2029, so it no longer "delays" payoff and comes back as a lever: 315 covered, no month
// cleared. Fidelity ($25/mo) comes back the same way: it used to read delays_debt_payoff (arm Sep
// 2029 against the Aug 2029 base), and now covers 879. Both arms keep their months short; the
// reserve cannot be banked because every month before Jul 2027 already pays only its minimums.
// Was: [] with Owners and Fidelity excluded as delays_debt_payoff.
// RE-PINNED 2026-10-04 (e2850463, same change as PINNED_MONTHS above): Fidelity 879 -> 928,
// Owners Contribution 315 -> 618. Both still clear no month. Was: Fidelity 879, Owners 315.
const PINNED_LEVERS: [string, number, string[]][] = [
  ['Fidelity', 928, []], ['Owners Contribution', 618, []],
];
