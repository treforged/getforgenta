// A CREDIT CARD THE USER HAS PLANNED BUT NOT OPENED.
//
// Tre, 2026-08-26: "if we still want to show the two not live cards yet, just show them
// individually with a note ... ordered by the payoff method."
//
// Two things are pinned here and the first is the one that had a real bug in the draft:
//   (a) a row is marked not-open-yet from `card_start_date` alone — the obvious helper
//       (`isCardOpenAsOf`) short-circuits on `account_type === 'credit_card'`, which a
//       `RankableCard` does not carry, so every card read as OPEN and the note never appeared;
//   (b) the not-yet-open rows are ordered by the payoff strategy WITHIN the slots they already
//       hold, so nothing the user dragged can move.

import { describe, it, expect } from 'vitest';
import { buildSurplusRankRows, orderNotOpenCards, type SurplusRankRow } from '../surplus-ranking';

const AS_OF = new Date('2026-08-27T12:00:00');

const card = (over: Record<string, unknown>) => ({
  id: 'c', name: 'Card', balance: 0, surplus_sort_order: 0, created_at: '2026-01-01', ...over,
});

const rowsFor = (cards: Parameters<typeof buildSurplusRankRows>[0]['cards'], strategy?: 'avalanche' | 'snowball') =>
  buildSurplusRankRows({
    goals: [], carFunds: [], cards, asOf: AS_OF,
    ...(strategy ? { cardPayoffStrategy: strategy } : {}),
  });

describe('a not-yet-open card is marked, and says when it opens', () => {
  it('marks a card whose start date is a future MONTH, and formats the month', () => {
    const row = rowsFor([card({ id: 'vx', name: 'Venture X', card_start_date: '2027-03-01' })])
      .find(r => r.id === 'vx')!;
    expect(row.notOpenYet).toBe(true);
    expect(row.opensLabel).toBe(
      new Date('2027-03-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
    );
  });

  it('leaves an ORDINARY card byte-identical — no start date, or one already passed', () => {
    for (const start of [null, undefined, '2025-01-01', '2026-08-01']) {
      const row = rowsFor([card({ id: 'v', name: 'Visa', balance: 900, card_start_date: start })])
        .find(r => r.id === 'v')!;
      expect(row.notOpenYet).toBeUndefined();
      expect(row.opensLabel).toBeUndefined();
      expect(row.remaining).toBe(900);
    }
  });

  it('does NOT read the card as open just because the shape has no account_type — the bug two '
    + 'drafts of this shared, and the reason `cardStartMonthOffset` is used instead', () => {
    const row = rowsFor([card({ id: 'ac', card_start_date: '2099-01-01' })]).find(r => r.id === 'ac')!;
    expect(row.notOpenYet).toBe(true);
  });

  it('marks it from the START OF THE MONTH, matching the simulation: a card opening later THIS '
    + 'month is already counted as open', () => {
    const row = rowsFor([card({ id: 'x', card_start_date: '2026-08-31' })]).find(r => r.id === 'x')!;
    expect(row.notOpenYet).toBeUndefined();
  });
});

describe('orderNotOpenCards — the payoff method decides, within the slots they already hold', () => {
  const at = (id: string, sortOrder: number, notOpenYet = true, remaining = 0): SurplusRankRow => ({
    id, kind: 'card', name: id, sortOrder, autoExtra: true, remaining, share: null,
    targetAmount: null, targetDate: null, createdAt: '2026-01-01',
    ...(notOpenYet ? { notOpenYet: true } : {}),
  });
  const goal: SurplusRankRow = {
    id: 'g', kind: 'goal', name: 'Goal', sortOrder: 1, autoExtra: true, remaining: 500, share: null,
    targetAmount: 500, targetDate: null, createdAt: '2026-01-01',
  };

  it('avalanche puts the higher APR first', () => {
    const rows = [at('low', 0), goal, at('high', 2)];
    const out = orderNotOpenCards(rows, 'avalanche', [
      { id: 'low', apr: 18 }, { id: 'high', apr: 26 },
    ]);
    expect(out.map(r => r.id)).toEqual(['high', 'g', 'low']);
    // The slots keep their ranks; only which card sits in which changed.
    expect(out.map(r => r.sortOrder)).toEqual([0, 1, 2]);
  });

  it('snowball puts the smaller balance first', () => {
    const rows = [at('big', 0, true, 4_000), at('small', 1, true, 900)];
    expect(orderNotOpenCards(rows, 'snowball', [{ id: 'big' }, { id: 'small' }]).map(r => r.id))
      .toEqual(['small', 'big']);
  });

  it('NEVER moves an open card, a goal or the block — it only fills the planned cards\' own slots', () => {
    const open = at('open', 0, false, 8_000);
    const rows = [open, at('p1', 1), goal, at('p2', 3)];
    const out = orderNotOpenCards(rows, 'avalanche', [
      { id: 'open', apr: 99 }, { id: 'p1', apr: 10 }, { id: 'p2', apr: 30 },
    ]);
    expect(out[0].id).toBe('open');
    expect(out[2].id).toBe('g');
    expect([out[1].id, out[3].id]).toEqual(['p2', 'p1']);
  });

  it('is a no-op with fewer than two planned cards, so a normal list is untouched', () => {
    const rows = [at('only', 0), goal];
    expect(orderNotOpenCards(rows, 'avalanche', [{ id: 'only', apr: 1 }])).toEqual(rows);
  });
});
