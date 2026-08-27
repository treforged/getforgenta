/**
 * A LATER STOP OF A STAGED GOAL IS A FULL ROW — its own rank, its own tick, and (2026-08-27) its
 * own SPLIT WEIGHT. Tre: *"split stage 2 of savings with car loan."*
 *
 * Two rules are pinned here and both bite:
 *   • `goalStages` resolves a per-stop `surplus_share`, with the goal's one column as stop 1's
 *     fallback and a stored `null` on stop 1 meaning "left the split", not "inherit".
 *   • `buildRankedTargets` builds ONE TARGET PER STOP — the shape `forecast-engine.ts` has always
 *     used for months 1+ — so month 0 ranks, ticks, paces and splits a plan the same way every
 *     later month does.
 */
import { describe, it, expect } from 'vitest';
import { buildRankedTargets, goalStages, stopRowId } from '../ranked-extra-payment-targets';
import { allocateRankedSurplus } from '../ranked-surplus-allocation';
import type { CarFund } from '../types';

const MONTHLY = 1_000;

/** Three stops of $1,000 each, cumulative — so thresholds are 1k / 2k / 3k. */
const stagedGoal = (over: Record<string, unknown> = {}, stops: Record<string, unknown>[] = []) => ({
  id: 'move', sort_order: 2, auto_extra: true, current_amount: 0, target_amount: 3_000,
  stages: stops.length > 0 ? stops : [
    { id: 's1', name: 'Move fund', amount: 1_000, sort_order: 2, auto_extra: true },
    { id: 's2', name: 'Emergency runway', amount: 1_000, sort_order: 3, auto_extra: true },
    { id: 's3', name: 'Full runway', amount: 1_000, sort_order: 7, auto_extra: false },
  ],
  ...over,
});

const loanFund = (over: Partial<CarFund> = {}): CarFund => ({
  id: 'c5', user_id: 'u', vehicle_name: 'C5', phase: 'loan', loan_amount: 16_530,
  actual_monthly_payment: 422.89, sort_order: 3, auto_extra: true, linked_account: null,
  down_payment_goal: 0, current_saved: 0, gift_contribution: 0, lump_sum_payments: [],
  created_at: '', ...over,
} as unknown as CarFund);

const base = {
  cards: [], carFunds: [] as CarFund[], strategy: 'avalanche' as const, asOf: '2026-08-27',
  essentialMonthlyExpenses: MONTHLY,
};

describe('goalStages — a stop carries its own split weight', () => {
  it('reads the weight stored on the stop', () => {
    const stops = goalStages(stagedGoal({}, [
      { id: 's1', amount: 1_000 },
      { id: 's2', amount: 1_000, surplus_share: 40 },
    ]), MONTHLY).stops;
    expect(stops[1].share).toBe(40);
  });

  it('falls back to the GOAL column for stop 1 only — that column always was stop 1\'s', () => {
    const stops = goalStages(stagedGoal({ surplus_share: 60 }, [
      { id: 's1', amount: 1_000 },
      { id: 's2', amount: 1_000 },
    ]), MONTHLY).stops;
    expect(stops[0].share).toBe(60);
    expect(stops[1].share).toBeNull();
  });

  it('treats a stored null on stop 1 as LEAVING the split, never as inherit', () => {
    const stops = goalStages(stagedGoal({ surplus_share: 60 }, [
      { id: 's1', amount: 1_000, surplus_share: null },
    ]), MONTHLY).stops;
    expect(stops[0].share).toBeNull();
  });

  it('drops zero and negative weights — a rank cannot be divided by them', () => {
    const stops = goalStages(stagedGoal({}, [
      { id: 's1', amount: 1_000, surplus_share: 0 },
      { id: 's2', amount: 1_000, surplus_share: -5 },
    ]), MONTHLY).stops;
    expect(stops.map(s => s.share)).toEqual([null, null]);
  });

  it('gives an unstaged goal one stop carrying the goal\'s own weight', () => {
    const stops = goalStages({ id: 'g', target_amount: 500, surplus_share: 25 }, MONTHLY).stops;
    expect(stops).toHaveLength(1);
    expect(stops[0].share).toBe(25);
  });
});

describe('buildRankedTargets — one target per stop', () => {
  it('builds a row for every stop, at the STOP\'s own rank and tick', () => {
    const t = buildRankedTargets({ ...base, goals: [stagedGoal()] });
    expect(t.map(x => x.id)).toEqual(['move', 'move::stop2', 'move::stop3']);
    expect(t.map(x => x.sortOrder)).toEqual([2, 3, 7]);
    // Stop 3 is unticked: it is listed, it holds no queue, and it takes nothing.
    expect(t.map(x => x.autoExtra)).toEqual([true, true, false]);
    expect(t.map(x => x.capacity)).toEqual([1_000, 1_000, 1_000]);
  });

  it('sizes each stop by ITS OWN dollars once part of the plan is saved', () => {
    // $1,500 saved fills stop 1 and half of stop 2.
    const t = buildRankedTargets({ ...base, goals: [stagedGoal({ current_amount: 1_500 })] });
    expect(t.map(x => x.capacity)).toEqual([0, 500, 1_000]);
  });

  it('paces a later stop against ITS OWN date, not the goal\'s', () => {
    const t = buildRankedTargets({
      ...base,
      goals: [stagedGoal({ target_date: '2026-09-30' }, [
        { id: 's1', amount: 1_000, sort_order: 2, auto_extra: true },
        // Four months out including this one ⇒ $250 a month.
        { id: 's2', amount: 1_000, sort_order: 3, auto_extra: true, target_date: '2026-11-30' },
      ])],
    });
    expect(t[1].maxExtra).toBeCloseTo(250, 2);
  });

  it('leaves an unstaged goal exactly as it was — one row at the goal\'s rank', () => {
    const t = buildRankedTargets({
      ...base,
      goals: [{ id: 'g', sort_order: 4, auto_extra: true, target_amount: 800, current_amount: 300, surplus_share: 50 }],
    });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: 'g', sortOrder: 4, capacity: 500, autoExtra: true, share: 50 });
  });

  it('REGRESSION: a later stop is no longer funded at the goal\'s own rank once stop 1 fills', () => {
    // The pre-2026-08-27 shape put ONE row per goal at `sort_order` 2 carrying the CURRENT stop's
    // need — so the runway the user dragged below the cards would have been funded ahead of them.
    const t = buildRankedTargets({ ...base, goals: [stagedGoal({ current_amount: 1_000 })] });
    const funded = t.filter(x => x.autoExtra && x.capacity > 0);
    expect(funded.map(x => x.id)).toEqual(['move::stop2']);
    expect(funded[0].sortOrder).toBe(3);
  });
});

describe('a later stop splits a rank with the car loan', () => {
  /**
   * Stop 2 dragged onto the loan's rank, both carrying a weight. Stop 1 is already filled, so the
   * shared rank is the first UNMET one — a stop 1 with room left would hold the queue below it for
   * the rest of the month, which is the 2026-08-25 waterfall and not what is under test here.
   */
  const goals = [stagedGoal({ current_amount: 1_000 }, [
    { id: 's1', name: 'Move fund', amount: 1_000, sort_order: 2, auto_extra: true },
    { id: 's2', name: 'Runway', amount: 1_000, sort_order: 3, auto_extra: true, surplus_share: 50 },
  ])];
  const carFunds = [loanFund({ sort_order: 3, surplus_share: 50 } as Partial<CarFund>)];

  it('carries both weights onto the two targets at one rank', () => {
    const t = buildRankedTargets({ ...base, goals, carFunds, includeLoanTargets: true });
    const stop2 = t.find(x => x.id === stopRowId('move', 2))!;
    const loan = t.find(x => x.kind === 'loan')!;
    expect(stop2.sortOrder).toBe(loan.sortOrder);
    expect([stop2.share, loan.share]).toEqual([50, 50]);
  });

  it('divides that rank\'s money between them instead of filling the stop first', () => {
    const t = buildRankedTargets({ ...base, goals, carFunds, includeLoanTargets: true });
    const { allocations } = allocateRankedSurplus(600, t);
    const by = new Map(allocations.map(a => [a.id, a.extra]));
    expect(by.get('move')).toBe(0);
    expect(by.get('move::stop2')).toBeCloseTo(300, 2);
    expect(by.get('c5')).toBeCloseTo(300, 2);
  });

  it('WITHOUT a weight the rank is a strict sequence and the loan takes it all', () => {
    const unweighted = [stagedGoal({ current_amount: 1_000 }, [
      { id: 's1', name: 'Move fund', amount: 1_000, sort_order: 2, auto_extra: true },
      { id: 's2', name: 'Runway', amount: 1_000, sort_order: 3, auto_extra: true },
    ])];
    const t = buildRankedTargets({
      ...base, goals: unweighted, carFunds: [loanFund({ sort_order: 3 })], includeLoanTargets: true,
    });
    // Ties break on `id`, so `c5` fills before `move::stop2` and the stop sees nothing. That is
    // the pre-split behaviour, unchanged — and it is exactly why the weight is the feature.
    const { allocations } = allocateRankedSurplus(600, t);
    const by = new Map(allocations.map(a => [a.id, a.extra]));
    expect(by.get('move::stop2')).toBe(0);
    expect(allocations.find(a => a.kind === 'loan')!.extra).toBeCloseTo(600, 2);
  });
});
