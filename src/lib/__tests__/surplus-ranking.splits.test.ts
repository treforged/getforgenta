import { describe, it, expect } from 'vitest';
import {
  CARDS_ROW_ID, DEFAULT_SPLIT_SHARE, buildSurplusRankRows, isSurplusRankWritesEmpty,
  joinSurplusRankRow, moveSurplusRankRow, moveSurplusRankRowBy, planCardSeparationWrites,
  planSurplusRankWrites, separateSurplusRankRow, setSurplusRankShare,
  type SurplusRankRow,
} from '../surplus-ranking';

const row = (
  id: string, sortOrder: number, share: number | null = null,
  kind: SurplusRankRow['kind'] = 'goal',
): SurplusRankRow => ({
  id, kind, name: id, sortOrder, autoExtra: true, remaining: 1_000, share,
  targetAmount: null, targetDate: null, createdAt: '',
});

const ranks = (rows: readonly SurplusRankRow[]) => rows.map(r => `${r.id}:${r.sortOrder}`);

describe('splits are only what the user made', () => {
  it('does NOT read a shared sort_order as a split when no weight is stored', () => {
    // Every untouched row sits at sort_order 0 — the column's default. Reading that as one
    // enormous split would divide the surplus across everything the user owns.
    const rows = [row('a', 0), row('b', 0), row('c', 0)];
    expect(ranks(moveSurplusRankRowBy(rows, 'c', -1))).toEqual(['a:0', 'c:1', 'b:2']);
  });

  it('joins a row to the rank above and weights BOTH sides', () => {
    const next = joinSurplusRankRow([row('a', 0), row('b', 1)], 'b');
    expect(ranks(next)).toEqual(['a:0', 'b:0']);
    expect(next.map(r => r.share)).toEqual([DEFAULT_SPLIT_SHARE, DEFAULT_SPLIT_SHARE]);
  });

  it('will not join the top row to nothing', () => {
    const rows = [row('a', 0), row('b', 1)];
    expect(ranks(joinSurplusRankRow(rows, 'a'))).toEqual(['a:0', 'b:1']);
  });

  it('separates a row back out and drops both weights, so the rank is a sequence again', () => {
    const split = joinSurplusRankRow([row('a', 0), row('b', 1)], 'b');
    const next = separateSurplusRankRow(split, 'b');
    expect(ranks(next)).toEqual(['a:0', 'b:1']);
    expect(next.every(r => r.share === null)).toBe(true);
  });

  it('re-ranks below a split densely — the rank after a 2-row split is the NEXT integer', () => {
    const rows = [row('a', 0), row('b', 1), row('c', 2)];
    const next = joinSurplusRankRow(rows, 'b');
    expect(ranks(next)).toEqual(['a:0', 'b:0', 'c:1']);
  });

  it('a weight can only be set on a row that is actually in a split', () => {
    const alone = [row('a', 0), row('b', 1)];
    expect(setSurplusRankShare(alone, 'b', 70)).toEqual(alone);
    const split = joinSurplusRankRow(alone, 'b');
    expect(setSurplusRankShare(split, 'b', 70).find(r => r.id === 'b')?.share).toBe(70);
  });

  it('a drag out of a split leaves the split, rather than silently keeping the weight', () => {
    const rows = joinSurplusRankRow([row('a', 0), row('b', 1), row('c', 2)], 'b');
    const next = moveSurplusRankRow(rows, 'b', 'c');
    expect(next.find(r => r.id === 'b')?.share).toBeNull();
    expect(next.find(r => r.id === 'a')?.share).toBeNull();
    expect(ranks(next)).toEqual(['a:0', 'c:1', 'b:2']);
  });

  it('a drop onto one half of a split does NOT join it — a split is a deliberate act', () => {
    const rows = joinSurplusRankRow([row('a', 0), row('b', 1), row('c', 2)], 'b');
    const next = moveSurplusRankRow(rows, 'c', 'a');
    expect(ranks(next)).toEqual(['c:0', 'a:1', 'b:1']);
  });

  it('one tap crosses one RANK, not one row, so it never lands invisibly inside a split', () => {
    const rows = joinSurplusRankRow([row('a', 0), row('b', 1), row('c', 2)], 'b');
    // a and b share rank 0; c is rank 1. Tapping c up puts it above the whole split.
    expect(ranks(moveSurplusRankRowBy(rows, 'c', -1))).toEqual(['c:0', 'a:1', 'b:1']);
  });

  it('writes both sides of a new split, and only what changed', () => {
    const before = [row('a', 0), row('b', 1)];
    const writes = planSurplusRankWrites(before, joinSurplusRankRow(before, 'b'));
    expect(writes.goals).toEqual([
      { id: 'a', surplus_share: DEFAULT_SPLIT_SHARE },
      { id: 'b', sort_order: 0, surplus_share: DEFAULT_SPLIT_SHARE },
    ]);
  });

  it('sends nothing at all when nothing changed', () => {
    const rows = [row('a', 0), row('b', 1)];
    expect(isSurplusRankWritesEmpty(planSurplusRankWrites(rows, rows))).toBe(true);
  });
});

describe('cards ranked on their own', () => {
  const card = (id: string, solo: number | null) => ({
    id, name: id, balance: 5_000, surplus_sort_order: solo, created_at: '',
  });

  it('keeps every card in the block until one is explicitly pulled out', () => {
    const rows = buildSurplusRankRows({
      goals: [], carFunds: [], cards: [card('visa', null), card('disc', null)],
    });
    expect(rows.map(r => r.id)).toEqual([CARDS_ROW_ID]);
  });

  it('gives a pulled-out card its own row, and keeps the block for the rest', () => {
    const rows = buildSurplusRankRows({
      goals: [], carFunds: [], cards: [card('visa', 1), card('disc', null)],
    });
    expect(rows.map(r => r.id)).toEqual([CARDS_ROW_ID, 'visa']);
    expect(rows.find(r => r.id === 'visa')?.kind).toBe('card');
  });

  it('drops the block row entirely once every card has left it — a rank standing for nothing', () => {
    const rows = buildSurplusRankRows({
      goals: [], carFunds: [], cards: [card('visa', 0), card('disc', 1)],
    });
    expect(rows.map(r => r.id)).toEqual(['visa', 'disc']);
  });

  it('makes room for the new rank instead of dropping the card on top of one', () => {
    // Block at 0, a goal at 1. Pulling a card out seats it at 1 and pushes the goal to 2 — landing
    // it ON the goal would have created a split nobody asked for.
    const rows = [row(CARDS_ROW_ID, 0, null, 'cards'), row('goal', 1)];
    const w = planCardSeparationWrites(rows, 'visa', true);
    expect(w.cards).toEqual([{ id: 'visa', surplus_sort_order: 1, surplus_share: null }]);
    expect(w.goals).toEqual([{ id: 'goal', sort_order: 2 }]);
    expect(w.cardsSortOrder).toBeNull();
  });

  it('putting a card back is one write, and clears its weight with it', () => {
    const w = planCardSeparationWrites([], 'visa', false);
    expect(w.cards).toEqual([{ id: 'visa', surplus_sort_order: null, surplus_share: null }]);
    expect(w.goals).toEqual([]);
  });
});
