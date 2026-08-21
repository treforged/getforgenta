import { describe, it, expect } from 'vitest';
import {
  allocateRankedSurplus,
  computeAutoExtraReserve,
  type RankedTarget,
} from '../ranked-surplus-allocation';

const card = (id: string, sortOrder: number, minimum: number, capacity: number): RankedTarget =>
  ({ id, kind: 'card', sortOrder, minimum, capacity });
const goal = (id: string, sortOrder: number, capacity: number): RankedTarget =>
  ({ id, kind: 'goal', sortOrder, minimum: 0, capacity });

const byId = (r: ReturnType<typeof allocateRankedSurplus>, id: string) =>
  r.allocations.find(a => a.id === id)!;

// ── SPLIT RANKS ──────────────────────────────────────────────────────────────
//
// Tre's decision (2026-08-21): "move fund split with discover. the savings split with extra car
// payments." Two targets at one rank, dividing that rank's money — which a strict sequence cannot
// express at all, since the first would fill entirely before the second saw a cent.

describe('allocateRankedSurplus — split ranks', () => {
  const shared = (id: string, sortOrder: number, capacity: number, share: number): RankedTarget =>
    ({ id, kind: 'goal', sortOrder, minimum: 0, capacity, share });

  it('a rank where nobody declares a share is the old strict sequence, byte for byte', () => {
    const r = allocateRankedSurplus(1_000, [goal('a', 1, 600), goal('b', 1, 600)]);
    expect(byId(r, 'a').extra).toBe(600);
    expect(byId(r, 'b').extra).toBe(400);
  });

  it('divides a shared rank in proportion to the shares', () => {
    const r = allocateRankedSurplus(1_000, [shared('move', 1, 5_000, 50), shared('disc', 1, 5_000, 50)]);
    expect(byId(r, 'move').extra).toBe(500);
    expect(byId(r, 'disc').extra).toBe(500);
  });

  it('honours an uneven weighting, and only the ratio matters', () => {
    const seventyThirty = allocateRankedSurplus(1_000, [shared('a', 1, 9_999, 70), shared('b', 1, 9_999, 30)]);
    expect(byId(seventyThirty, 'a').extra).toBe(700);
    expect(byId(seventyThirty, 'b').extra).toBe(300);
    const sevenToThree = allocateRankedSurplus(1_000, [shared('a', 1, 9_999, 7), shared('b', 1, 9_999, 3)]);
    expect(byId(sevenToThree, 'a').extra).toBe(700);
    expect(byId(sevenToThree, 'b').extra).toBe(300);
  });

  it('splits the rank money once, so a rank below still sees the remainder', () => {
    const r = allocateRankedSurplus(1_000, [
      shared('a', 1, 200, 50), shared('b', 1, 200, 50), goal('below', 2, 5_000),
    ]);
    expect(byId(r, 'a').extra).toBe(200);
    expect(byId(r, 'b').extra).toBe(200);
    expect(byId(r, 'below').extra).toBe(600);
  });

  it('a full split partner hands its half to the OTHER partner, not to the rank below', () => {
    const r = allocateRankedSurplus(1_000, [
      shared('full', 1, 100, 50), shared('hungry', 1, 5_000, 50), goal('below', 2, 5_000),
    ]);
    expect(byId(r, 'full').extra).toBe(100);
    expect(byId(r, 'hungry').extra).toBe(900);
    expect(byId(r, 'below').extra).toBe(0);
  });

  it('never lets a split starve a minimum, whatever the shares', () => {
    const r = allocateRankedSurplus(500, [
      shared('a', 0, 9_999, 50), shared('b', 0, 9_999, 50), card('visa', 9, 300, 4_000),
    ]);
    expect(byId(r, 'visa').minimum).toBe(300);
    expect(byId(r, 'a').extra + byId(r, 'b').extra).toBeCloseTo(200, 2);
    expect(r.minimumShortfall).toBe(0);
  });

  it('an opted-out target is not part of the split it shares a rank with', () => {
    const r = allocateRankedSurplus(1_000, [
      shared('in', 1, 5_000, 50),
      { ...shared('out', 1, 5_000, 50), autoExtra: false },
    ]);
    expect(byId(r, 'in').extra).toBe(1_000);
    expect(byId(r, 'out').extra).toBe(0);
  });

  it('falls back to the sequence when every share is zero or unusable', () => {
    const r = allocateRankedSurplus(1_000, [
      { ...goal('a', 1, 600), share: 0 },
      { ...goal('b', 1, 600), share: Number.NaN },
    ]);
    expect(byId(r, 'a').extra).toBe(600);
    expect(byId(r, 'b').extra).toBe(400);
  });

  it('conserves the pool across a split exactly as it does across a sequence', () => {
    for (const pool of [0, 1, 333.33, 1_000, 12_345.67]) {
      const r = allocateRankedSurplus(pool, [
        shared('a', 1, 400, 40), shared('b', 1, 900, 60), goal('c', 2, 300), card('v', 3, 50, 900),
      ]);
      const out = r.allocations.reduce((s, a) => s + a.total, 0) + r.unallocated;
      expect(out).toBeCloseTo(Math.max(0, pool), 2);
    }
  });
});

// ── CARDS RANKED INDIVIDUALLY ────────────────────────────────────────────────
//
// The card BLOCK cannot express "the move fund matters more than the Discover but less than the
// Visa" — every card sits at one rank by construction. A card flagged `rankedIndividually` leaves
// the block and carries its own rank, and the block becomes the REMAINDER so the aggregate the
// engine hands in is still conserved to the cent.

describe('computeAutoExtraReserve — cards ranked individually', () => {
  const g = (id: string, sortOrder: number, capacity: number): RankedTarget =>
    ({ id, kind: 'goal', sortOrder, minimum: 0, capacity, autoExtra: true });
  const solo = (id: string, sortOrder: number, minimum: number, capacity: number): RankedTarget =>
    ({ id, kind: 'card', sortOrder, minimum, capacity, rankedIndividually: true });

  it('is byte-identical to the block when no card is pulled out', () => {
    const targets = [g('move', 1, 10_000), card('visa', 0, 200, 6_000), card('disc', 0, 150, 9_000)];
    const withCards = computeAutoExtraReserve(2_000, 350, 15_000, targets, 0);
    const withoutCards = computeAutoExtraReserve(2_000, 350, 15_000, [g('move', 1, 10_000)], 0);
    expect(withCards).toEqual(withoutCards);
  });

  it('lets a goal sit BETWEEN two cards: Visa, then the move fund, then the Discover', () => {
    // Pool $2,000, minimums $350. The Visa clears its whole $600 balance first, the move fund takes
    // what is left, and the Discover — ranked below it — gets nothing this month.
    const r = computeAutoExtraReserve(2_000, 350, 6_600, [
      solo('visa', 0, 200, 600),
      g('move', 1, 10_000),
      solo('disc', 2, 150, 6_000),
    ], 0);
    expect(r.perTarget).toEqual([{ id: 'move', kind: 'goal', amount: 1_250 }]);
    expect(r.reserved).toBe(1_250);
  });

  it('a card ranked BELOW a goal no longer shields the pool from it', () => {
    // Blocked: every card sits at rank 0 as one row, above the goal, and absorbs the lot.
    const blocked = computeAutoExtraReserve(2_000, 350, 15_000, [g('move', 1, 10_000)], 0);
    // Opened: both cards are pulled out and the goal is ranked between them.
    const opened = computeAutoExtraReserve(2_000, 350, 15_000, [
      solo('visa', 0, 200, 600), g('move', 1, 10_000), solo('disc', 2, 150, 14_400),
    ], 0);
    expect(blocked.reserved).toBe(0);
    expect(opened.reserved).toBeGreaterThan(0);
  });

  it('the leftover block still outranks a goal, so pulling ONE card out changes nothing above it', () => {
    // Only the Discover is pulled out and ranked below the goal — but the Visa is still in the
    // block at rank 0, so the block absorbs the surplus first and the goal still gets nothing.
    // This is the honest reading, not a bug: a card the user has not touched keeps its rank.
    const r = computeAutoExtraReserve(2_000, 350, 15_000, [
      g('move', 1, 10_000), solo('disc', 2, 150, 9_000),
    ], 0);
    expect(r.reserved).toBe(0);
  });

  it('still settles every card minimum before any goal, at any rank', () => {
    for (const pool of [0, 100, 349.99, 350, 1_000, 50_000]) {
      const r = computeAutoExtraReserve(pool, 350, 15_000, [
        g('greedy', -5, 1e9), solo('visa', -4, 200, 6_000), solo('disc', -3, 150, 9_000),
      ], 0);
      expect(r.reserved).toBeLessThanOrEqual(Math.max(0, pool - 350) + 0.005);
    }
  });

  it('never double-counts a pulled-out card: the block is the remainder', () => {
    // The same total minimum and the same total balance whether the cards are blocked or solo, so
    // a goal ranked below them all sees exactly the same money either way.
    const asBlock = computeAutoExtraReserve(20_000, 350, 15_000, [g('move', 9, 1e9)], 0);
    const asSolos = computeAutoExtraReserve(20_000, 350, 15_000, [
      g('move', 9, 1e9), solo('visa', 0, 200, 6_000), solo('disc', 1, 150, 9_000),
    ], 0);
    expect(asSolos.reserved).toBeCloseTo(asBlock.reserved, 2);
  });

  it('a loan target is reserved for like a goal, and reported as its own kind', () => {
    const r = computeAutoExtraReserve(2_000, 350, 15_000, [
      { id: 'c5', kind: 'loan', sortOrder: 1, minimum: 0, capacity: 16_254.49, autoExtra: true },
    ], 2);
    expect(r.perTarget).toEqual([{ id: 'c5', kind: 'loan', amount: 1_650 }]);
  });
  it('never lets pulled-out cards claim more minimum than the engine says is due', () => {
    // Q11: a card whose month-0 minimum has already settled is dropped from `cardMinimumsTotal`,
    // so the two solo cards below carry $350 of row-level minimum against an engine figure of
    // $200. Un-scaled, PASS 1 would take $350 of pool the engine will only spend $200 of, and the
    // goal ranked above them would be short by exactly that $150.
    const r = computeAutoExtraReserve(1_000, 200, 15_000, [
      g('move', -1, 1e9), solo('visa', 0, 200, 6_000), solo('disc', 1, 150, 9_000),
    ], 9);
    expect(r.reserved).toBeCloseTo(800, 2);
  });

  it('never lets pulled-out cards claim more capacity than the engine says is revolving', () => {
    // Promo tranches are not paid down by surplus, so a card row balance can exceed the revolving
    // figure the engine hands in — Tre's two cards are $18,819 of balance against far less that is
    // actually revolving. With the goal ranked BETWEEN them, the scaling decides how much reaches
    // it: the Visa absorbs its scaled share, not its whole row balance.
    const scaledVisa = 8_397 * (8_000 / (8_397 + 10_422));
    const r = computeAutoExtraReserve(20_000, 0, 8_000, [
      solo('visa', 0, 0, 8_397), g('move', 1, 1e9), solo('disc', 2, 0, 10_422),
    ], 9);
    expect(r.reserved).toBeCloseTo(20_000 - scaledVisa, 2);
  });

  it('scales proportionally, so the result does not depend on the order the cards arrive in', () => {
    const forwards = computeAutoExtraReserve(20_000, 0, 8_000, [
      solo('visa', 0, 0, 8_397), g('move', 1, 1e9), solo('disc', 2, 0, 10_422),
    ], 9);
    const backwards = computeAutoExtraReserve(20_000, 0, 8_000, [
      solo('disc', 2, 0, 10_422), g('move', 1, 1e9), solo('visa', 0, 0, 8_397),
    ], 9);
    expect(forwards.reserved).toBe(backwards.reserved);
  });
});
