// A LUMP SUM LEAVES THE FORECAST ONCE. Asserted as a NUMBER, not as a shape.
//
// ⚠️ WHY THIS EXISTS. Tre, 2026-09-05: *"go build it. i have used one off transactions several
// times on my account"*, with the constraint *"lump sum transfers should only be available when
// the auto extra goal is disabled."* That constraint is him protecting against a double-count:
// auto-extra sweeps surplus on a schedule and a lump sum moves it by hand, and if the forecast
// counted both against the same dollars it would show money spent twice.
//
// Before restricting a feature on that reasoning, the reasoning has to be TESTED. A restriction
// that buys nothing costs him a control for no reason; a missing restriction over a real
// double-count costs him a wrong number on a money page. Only a test tells those apart, and the
// answer must be a number rather than "the code looks right" — reading `forecast-engine.ts:1952`
// and seeing `lumpTransferThisMonth` hoisted above the auto-extra reserve is an argument, not
// evidence.
//
// ⚠️ AND THE FEATURE IS NOT WHERE THE BRIEF SAID IT WAS. `lump_sum_transfers` — the table with
// zero rows — is an ABANDONED DUPLICATE, and `useSupabaseData.ts` carries a tombstone comment
// saying so. The live mechanism is `savings_goals.lump_sum_payments`, a JSON array on the goal,
// read at `forecast-engine.ts:797`, mirrored into the card simulation at
// `useCardProjection.ts:920`, rendered by `MonthlyBreakdownTable.tsx:183-185` and exported to the
// statement PDF at `forecast-export.ts:249-251`. It is built end to end. This file pins the
// behaviour of the thing that EXISTS rather than of the thing that was nearly rebuilt on top of it.
//
// ⚠️ WHAT THESE TESTS DO NOT COVER, stated rather than implied. Mutation-checked three ways:
// zeroing `lumpTransferThisMonth` turns 3 red, and breaking the destination classification turns
// 3 red. But REMOVING `lumpTransferByMonth[i].total` from the outflow total at
// `forecast-engine.ts:1730` leaves all five GREEN — the amount still reaches cash by another
// path, so that line is not covered here. Said out loud because a reader counting five green
// tests would otherwise assume it was.
//
// Synthetic inputs from the committed demo fixture, so this runs everywhere — the real-data
// fixture is gitignored and its tests SKIP in CI, which is exactly the wrong property for an
// assertion about whether money is counted twice.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateForecast, type ForecastInputs } from '@/lib/forecast-engine';
import { demoForecastInputs } from './fixtures/demo-forecast-harness';
import type { Tables } from '@/integrations/supabase/types';

/** Pinned, because an unpinned run produces figures that move under the assertions. */
const NOW = new Date('2026-09-15T12:00:00');

/** The month index a lump sum is placed in — far enough ahead to be entirely projected. */
const LUMP_MONTH = 2;
const LUMP_AMOUNT = 500;

function monthKeyAt(offset: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * A savings goal carrying one lump sum.
 *
 * `linked_account` is left null so the engine's destination inference falls to its `else` branch
 * and the amount lands in `lumpSumSavings` — the plainest of the three destinations, and the one
 * whose classification cannot be confused by an account type the fixture happens to have.
 */
function goalWithLump(autoExtra: boolean, amount = LUMP_AMOUNT) {
  return {
    id: 'goal-lump-1',
    name: 'Emergency Fund',
    target_amount: 10_000,
    current_amount: 1_000,
    // ⚠️ NOT OPTIONAL, AND OMITTING IT COSTS THE WHOLE FORECAST. `monthly_contribution` is
    // `NOT NULL DEFAULT 0` in the database, so every real row has it — but the engine does no
    // guarding, and an undefined here turned `endingCash` into **NaN for all 60 months** while
    // `lumpSumSavings` still reported 500 correctly. A fixture that omits a NOT NULL column is
    // not a smaller version of a real row, it is an impossible one.
    monthly_contribution: 0,
    goal_type: 'savings',
    linked_account: null,
    auto_extra: autoExtra,
    sort_order: 0,
    active: true,
    lump_sum_payments: [{ id: 'ls-1', date: `${monthKeyAt(LUMP_MONTH)}-10`, amount }],
  } as unknown as Tables<'savings_goals'>;
}

/**
 * The same goal with AUTO-EXTRA ON, carrying a lump sum of `amount` (0 meaning none).
 *
 * Auto-extra is held on in BOTH arms of the comparison so the only variable is the lump sum.
 * `current_amount` is well below target so the goal genuinely has capacity to receive surplus —
 * an already-met goal takes nothing, and the test would pass without exercising anything.
 */
function goalWithLumpAndAuto(amount: number) {
  const g = goalWithLump(true, amount || LUMP_AMOUNT) as unknown as Record<string, unknown>;
  return { ...g, lump_sum_payments: amount > 0 ? g.lump_sum_payments : [] } as unknown as Tables<'savings_goals'>;
}

function withGoals(goals: Tables<'savings_goals'>[]): ForecastInputs {
  return { ...demoForecastInputs({ now: NOW }), goals };
}

const endingCash = (inputs: ForecastInputs) =>
  calculateForecast(inputs).data.map(r => r.endingCash ?? 0);

describe('a lump sum is deducted exactly once', () => {
  afterEach(() => vi.useRealTimers());

  const pin = () => { vi.useFakeTimers(); vi.setSystemTime(NOW); };

  it('shows the lump sum on the month it falls in, as its own deduction', () => {
    pin();
    const { data } = calculateForecast(withGoals([goalWithLump(false)]));
    // The row the breakdown table and the PDF both read.
    expect(data[LUMP_MONTH].lumpSumSavings).toBe(LUMP_AMOUNT);
    // And it is classified, not smeared: the other two destinations stay empty.
    expect(data[LUMP_MONTH].lumpSumBrokerage).toBe(0);
    expect(data[LUMP_MONTH].lumpSumRothIra).toBe(0);
  });

  it('does not put it in any other month', () => {
    pin();
    const { data } = calculateForecast(withGoals([goalWithLump(false)]));
    const months = data.map(r => r.lumpSumSavings ?? 0);
    expect(months.filter(v => v > 0)).toEqual([LUMP_AMOUNT]);
  });

  it('⚠️ moves ending cash by EXACTLY the amount — not twice it', () => {
    pin();
    const before = endingCash(withGoals([]));
    const after = endingCash(withGoals([goalWithLump(false)]));

    const delta = before[LUMP_MONTH] - after[LUMP_MONTH];
    // The number, to the cent. A double-count shows up here as 1000 and nowhere else.
    expect(delta).toBeCloseTo(LUMP_AMOUNT, 2);
  });

  it('⚠️ SUBSTITUTES for the auto-extra sweep instead of adding to it', () => {
    // THIS IS THE CASE TRE'S CONSTRAINT IS ABOUT, AND THE ANSWER IS NEITHER OF THE TWO WE
    // EXPECTED. It is not a double-count, and it is not simply "safe" — the engine does
    // something better than both: a lump sum DISPLACES exactly its own amount of auto-extra.
    //
    // Measured on the demo fixture, month 2, goal capacity well above the sweep:
    //     auto-extra to the goal   1065.16  ->  565.16   (down by exactly 500)
    //     ending cash                 1502  ->     1502   (unchanged)
    //     lumpSumSavings                 0  ->      500
    //
    // The goal receives the same total either way. Only the ROUTE changes: swept automatically,
    // or moved by hand. So there is nothing to protect against — the constraint is unnecessary
    // for CORRECTNESS.
    //
    // ⚠️ BUT IT IS STILL A CONTROL THAT APPEARS TO DO NOTHING, which is the real reason to keep
    // Tre's rule. With auto-extra on, recording a lump sum changes neither his cash nor the goal's
    // total — it only relabels part of a sweep that was happening anyway. A person who enters one
    // and watches every number stay put has met the same "control that lies" shape this repo keeps
    // finding, arriving from the opposite direction.
    //
    // Both arms hold auto-extra ON and differ ONLY by the lump sum, so nothing here measures
    // auto-extra's own effect. An earlier version of this case asserted `before.length ===
    // after.length` — a tautology that passed against every possible double-count, and was caught
    // by mutation-checking the file rather than by the run going red.
    pin();
    const noLump = calculateForecast(withGoals([goalWithLumpAndAuto(0)])).data[LUMP_MONTH];
    const withLump = calculateForecast(withGoals([goalWithLumpAndAuto(LUMP_AMOUNT)])).data[LUMP_MONTH];

    // The substitution, to the cent. A DOUBLE-COUNT would leave auto-extra untouched and drop
    // cash by 500; ignoring the lump entirely would leave all three numbers unchanged.
    const autoBefore = noLump.autoExtraByTarget['goal-lump-1'] ?? 0;
    const autoAfter = withLump.autoExtraByTarget['goal-lump-1'] ?? 0;
    expect(autoBefore - autoAfter).toBeCloseTo(LUMP_AMOUNT, 2);

    // Cash is untouched, because the same dollars left by a different route.
    expect(withLump.endingCash).toBeCloseTo(noLump.endingCash, 2);

    // And it is still reported as a lump sum rather than absorbed into the auto-extra line.
    expect(withLump.lumpSumSavings).toBe(LUMP_AMOUNT);
    expect(noLump.lumpSumSavings).toBe(0);
  });

  it('scales with the amount rather than being a fixed or duplicated deduction', () => {
    pin();
    const base = endingCash(withGoals([]));
    const small = endingCash(withGoals([goalWithLump(false, 200)]));
    const large = endingCash(withGoals([goalWithLump(false, 800)]));

    expect(base[LUMP_MONTH] - small[LUMP_MONTH]).toBeCloseTo(200, 2);
    expect(base[LUMP_MONTH] - large[LUMP_MONTH]).toBeCloseTo(800, 2);
  });
});
