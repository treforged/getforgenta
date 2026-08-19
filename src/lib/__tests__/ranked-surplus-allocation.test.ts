import { describe, it, expect } from 'vitest';
import {
  allocateRankedSurplus,
  computeAutoExtraReserve,
  rankTargets,
  type RankedTarget,
} from '../ranked-surplus-allocation';

const card = (id: string, sortOrder: number, minimum: number, capacity: number): RankedTarget =>
  ({ id, kind: 'card', sortOrder, minimum, capacity });
const goal = (id: string, sortOrder: number, capacity: number): RankedTarget =>
  ({ id, kind: 'goal', sortOrder, minimum: 0, capacity });
const carFund = (id: string, sortOrder: number, capacity: number): RankedTarget =>
  ({ id, kind: 'car_fund', sortOrder, minimum: 0, capacity });

const byId = (r: ReturnType<typeof allocateRankedSurplus>, id: string) =>
  r.allocations.find(a => a.id === id)!;

describe('rankTargets', () => {
  it('orders by sortOrder ascending and breaks ties on id', () => {
    const order = rankTargets([
      goal('zeta', 1, 100),
      card('alpha', 1, 0, 100),
      goal('first', 0, 100),
    ]).map(t => t.id);
    expect(order).toEqual(['first', 'alpha', 'zeta']);
  });

  it('does not mutate its input', () => {
    const targets = [goal('b', 5, 10), goal('a', 1, 10)];
    rankTargets(targets);
    expect(targets.map(t => t.id)).toEqual(['b', 'a']);
  });
});

describe('allocateRankedSurplus — minimums are never rankable', () => {
  it('pays a bottom-ranked card its minimum before a top-ranked goal takes a cent', () => {
    // The rule that must never break. The goal is ranked first and could swallow the whole pool.
    const r = allocateRankedSurplus(500, [
      goal('vacation', 0, 10_000),
      card('visa', 9, 200, 5_000),
    ]);
    expect(byId(r, 'visa').minimum).toBe(200);
    expect(byId(r, 'vacation').extra).toBe(300);
    expect(r.minimumShortfall).toBe(0);
  });

  it('pays every minimum first even when the goals could absorb everything', () => {
    const r = allocateRankedSurplus(1_000, [
      goal('g1', 0, 100_000),
      card('c1', 1, 150, 5_000),
      card('c2', 2, 250, 5_000),
      carFund('cf', 3, 100_000),
    ]);
    expect(byId(r, 'c1').minimum).toBe(150);
    expect(byId(r, 'c2').minimum).toBe(250);
    expect(byId(r, 'g1').extra).toBe(600);
    expect(byId(r, 'cf').extra).toBe(0);
  });

  it('reports a minimum shortfall rather than silently dropping a payment', () => {
    const r = allocateRankedSurplus(100, [
      goal('g1', 0, 10_000),
      card('c1', 1, 150, 5_000),
      card('c2', 2, 250, 5_000),
    ]);
    // The pool covered $100 of $400 in minimums. Nothing is ranked; the gap is REPORTED.
    expect(r.minimumShortfall).toBe(300);
    expect(byId(r, 'g1').total).toBe(0);
    expect(r.allocations.reduce((s, a) => s + a.total, 0)).toBe(100);
  });

  it('a card that opts out of extras still gets its minimum', () => {
    const r = allocateRankedSurplus(1_000, [
      { ...card('c1', 0, 200, 5_000), autoExtra: false },
      goal('g1', 1, 10_000),
    ]);
    expect(byId(r, 'c1').minimum).toBe(200);
    expect(byId(r, 'c1').extra).toBe(0);
    expect(byId(r, 'g1').extra).toBe(800);
  });

  it('never pays a minimum larger than the capacity it is owed against', () => {
    // A settled card whose minimum outlives its balance must not be handed cash it cannot absorb.
    const r = allocateRankedSurplus(1_000, [card('settled', 0, 200, 35), goal('g1', 1, 10_000)]);
    expect(byId(r, 'settled').total).toBe(35);
    expect(byId(r, 'g1').extra).toBe(965);
    expect(r.minimumShortfall).toBe(0);
  });
});

describe('allocateRankedSurplus — a full target hands its share on', () => {
  it('caps at capacity and flows the remainder to the next rank in the same month', () => {
    const r = allocateRankedSurplus(1_000, [
      goal('nearly-done', 0, 120),
      carFund('car', 1, 400),
      card('visa', 2, 0, 5_000),
    ]);
    expect(byId(r, 'nearly-done').total).toBe(120);
    expect(byId(r, 'car').total).toBe(400);
    expect(byId(r, 'visa').total).toBe(480);
    expect(r.unallocated).toBe(0);
  });

  it('gives a target with zero capacity nothing and loses none of the pool', () => {
    const r = allocateRankedSurplus(300, [goal('full', 0, 0), goal('next', 1, 10_000)]);
    expect(byId(r, 'full').total).toBe(0);
    expect(byId(r, 'next').total).toBe(300);
  });

  it('returns the leftover as unallocated when every target is full', () => {
    const r = allocateRankedSurplus(1_000, [goal('g1', 0, 100), card('c1', 1, 50, 200)]);
    expect(byId(r, 'g1').total).toBe(100);
    expect(byId(r, 'c1').total).toBe(200);
    expect(r.unallocated).toBe(700);
  });

  it('honours maxExtra without letting it cap the minimum', () => {
    const r = allocateRankedSurplus(1_000, [
      { ...card('c1', 0, 200, 5_000), maxExtra: 100 },
      goal('g1', 1, 10_000),
    ]);
    expect(byId(r, 'c1').minimum).toBe(200);
    expect(byId(r, 'c1').extra).toBe(100);
    expect(byId(r, 'g1').extra).toBe(700);
  });
});

describe('allocateRankedSurplus — conservation and edges', () => {
  it('never allocates more than the deployable pool', () => {
    const targets = [goal('g1', 0, 10_000), card('c1', 1, 300, 9_000), carFund('cf', 2, 10_000)];
    for (const pool of [0, 1, 299.99, 300, 1_234.56, 50_000]) {
      const r = allocateRankedSurplus(pool, targets);
      const spent = r.allocations.reduce((s, a) => s + a.total, 0);
      expect(spent + r.unallocated).toBeCloseTo(Math.max(0, pool), 2);
      expect(spent).toBeLessThanOrEqual(Math.max(0, pool) + 0.005);
    }
  });

  it('clamps a negative pool to zero instead of inventing a payment', () => {
    const r = allocateRankedSurplus(-500, [card('c1', 0, 200, 5_000)]);
    expect(byId(r, 'c1').total).toBe(0);
    expect(r.unallocated).toBe(0);
    expect(r.minimumShortfall).toBe(200);
  });

  it('handles an empty target list', () => {
    const r = allocateRankedSurplus(750, []);
    expect(r.allocations).toEqual([]);
    expect(r.unallocated).toBe(750);
    expect(r.minimumShortfall).toBe(0);
  });

  it('rounds to cents and does not leak float dust', () => {
    const r = allocateRankedSurplus(0.1 + 0.2, [goal('g1', 0, 0.3)]);
    expect(byId(r, 'g1').total).toBe(0.3);
    expect(r.unallocated).toBe(0);
  });

  it('is stable: the result does not depend on input order, only on sortOrder', () => {
    const a = [goal('g1', 2, 500), card('c1', 0, 100, 5_000), carFund('cf', 1, 300)];
    const b = [carFund('cf', 1, 300), goal('g1', 2, 500), card('c1', 0, 100, 5_000)];
    expect(allocateRankedSurplus(900, a)).toEqual(allocateRankedSurplus(900, b));
  });
});

describe('computeAutoExtraReserve', () => {
  const g = (id: string, sortOrder: number, capacity: number, autoExtra = true): RankedTarget =>
    ({ id, kind: 'goal', sortOrder, minimum: 0, capacity, autoExtra });

  it('reserves nothing when no target is opted in — the pre-feature path', () => {
    expect(computeAutoExtraReserve(5_000, 300, 20_000, [])).toEqual({ reserved: 0, perTarget: [] });
    expect(computeAutoExtraReserve(5_000, 300, 20_000, [g('a', 0, 1_000, false)]))
      .toEqual({ reserved: 0, perTarget: [] });
  });

  it('reserves nothing for a goal that is already full', () => {
    expect(computeAutoExtraReserve(5_000, 300, 20_000, [g('full', 0, 0)]).reserved).toBe(0);
  });

  it('keeps the cards first on an exact rank tie, rather than deciding it on a uuid', () => {
    // Both at rank 0. The cards absorb the pool; the goal gets what is left, which is nothing.
    const r = computeAutoExtraReserve(1_000, 200, 20_000, [g('tie', 0, 10_000)]);
    expect(r.reserved).toBe(0);
  });

  it('reserves for a goal the user ranked above the cards', () => {
    const r = computeAutoExtraReserve(1_000, 200, 20_000, [g('vacation', 0, 10_000)], 1);
    // $200 of card minimum is settled first, then the goal takes the surplus.
    expect(r.reserved).toBe(800);
    expect(r.perTarget).toEqual([{ id: 'vacation', kind: 'goal', amount: 800 }]);
  });

  it('never reserves a card minimum, whatever the rank', () => {
    for (const pool of [0, 50, 199.99, 200, 1_000, 25_000]) {
      const r = computeAutoExtraReserve(pool, 200, 20_000, [g('greedy', 0, 1e9)], 99);
      expect(r.reserved).toBeLessThanOrEqual(Math.max(0, pool - 200) + 0.005);
    }
  });

  it('caps each goal at its remaining need and passes the rest down the ranking', () => {
    const r = computeAutoExtraReserve(2_000, 0, 20_000, [g('small', 0, 150), g('big', 1, 10_000)], 5);
    expect(r.perTarget).toEqual([
      { id: 'small', kind: 'goal', amount: 150 },
      { id: 'big', kind: 'goal', amount: 1_850 },
    ]);
    expect(r.reserved).toBe(2_000);
  });
});
