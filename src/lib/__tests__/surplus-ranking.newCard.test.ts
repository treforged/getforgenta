import { describe, it, expect } from 'vitest';
import {
  CARDS_ROW_ID, planCardSeparationWrites, planNewCardRankWrites,
  type RankableCard, type SurplusRankRow,
} from '../surplus-ranking';

const row = (
  id: string, sortOrder: number, kind: SurplusRankRow['kind'] = 'goal',
  extra: Partial<SurplusRankRow> = {},
): SurplusRankRow => ({
  id, kind, name: id, sortOrder, autoExtra: true, remaining: 1_000, share: null,
  targetAmount: null, targetDate: null, createdAt: '', ...extra,
});

const card = (id: string, apr: number, balance = 0): RankableCard => ({ id, apr, balance });

/** Two cards already ranked one row each, a goal below them — the list Tre actually has. */
const INDIVIDUAL = [
  row('visa', 0, 'card', { remaining: 8_000 }),
  row('disc', 1, 'card', { remaining: 10_000 }),
  row('goal', 2),
];
const RANKED_CARDS = [card('visa', 27.49, 8_000), card('disc', 16.6, 10_000)];

describe('a new card does not overwrite the mode the user picked', () => {
  it('writes nothing in block mode — a null rank is how a card correctly joins the block', () => {
    const rows = [row(CARDS_ROW_ID, 0, 'cards'), row('goal', 1)];
    expect(planNewCardRankWrites(rows, RANKED_CARDS, card('rh', 29.99), 'avalanche')).toBeNull();
  });

  it('writes nothing on a legacy mixed list, where nobody has picked anything yet', () => {
    const rows = [row(CARDS_ROW_ID, 0, 'cards'), row('visa', 1, 'card', { remaining: 8_000 })];
    expect(planNewCardRankWrites(rows, RANKED_CARDS, card('rh', 29.99), 'avalanche')).toBeNull();
  });

  it('writes nothing for the very first card, which has no mode to preserve', () => {
    expect(planNewCardRankWrites([row('goal', 0)], [], card('rh', 29.99), 'avalanche')).toBeNull();
  });

  it('counts the new card as neither ranked nor blocked when the refetch has already landed', () => {
    // `cards` may or may not contain the new row depending on the refetch, and the mode must read
    // the same either way — otherwise the fix would fire or not fire on a race.
    const withNew = [...RANKED_CARDS, card('rh', 29.99)];
    expect(planNewCardRankWrites(INDIVIDUAL, withNew, card('rh', 29.99), 'avalanche'))
      .toEqual(planNewCardRankWrites(INDIVIDUAL, RANKED_CARDS, card('rh', 29.99), 'avalanche'));
  });
});

describe('the seat follows the payoff strategy', () => {
  it('seats a 29.99% card above both under avalanche and moves every row below it down one', () => {
    const w = planNewCardRankWrites(INDIVIDUAL, RANKED_CARDS, card('rh', 29.99), 'avalanche')!;
    expect(w.cards).toEqual([
      { id: 'visa', surplus_sort_order: 1 },
      { id: 'disc', surplus_sort_order: 2 },
      { id: 'rh', surplus_sort_order: 0, surplus_share: null },
    ]);
    expect(w.goals).toEqual([{ id: 'goal', sort_order: 3 }]);
    expect(w.goalStages).toEqual([]);
  });

  it('seats a 12% card below both under avalanche and leaves them exactly where they were', () => {
    const w = planNewCardRankWrites(INDIVIDUAL, RANKED_CARDS, card('rh', 12), 'avalanche')!;
    expect(w.cards).toEqual([{ id: 'rh', surplus_sort_order: 2, surplus_share: null }]);
    expect(w.goals).toEqual([{ id: 'goal', sort_order: 3 }]);
  });

  it('seats an empty card first under snowball — $0 is the smallest balance there is', () => {
    const w = planNewCardRankWrites(INDIVIDUAL, RANKED_CARDS, card('rh', 12, 0), 'snowball')!;
    expect(w.cards).toContainEqual({ id: 'rh', surplus_sort_order: 0, surplus_share: null });
  });

  it('seats a $9,000 card BETWEEN the $8,000 and the $10,000 one under snowball', () => {
    const w = planNewCardRankWrites(INDIVIDUAL, RANKED_CARDS, card('rh', 29.99, 9_000), 'snowball')!;
    expect(w.cards).toEqual([
      { id: 'disc', surplus_sort_order: 2 },
      { id: 'rh', surplus_sort_order: 1, surplus_share: null },
    ]);
    expect(w.goals).toEqual([{ id: 'goal', sort_order: 3 }]);
  });

  it('stops at the FIRST card the strategy would pay later, reading a hand-dragged list top down', () => {
    // Discover (16.6%) has been dragged ABOVE the Visa (27.49%), so no single seat can satisfy both
    // the user's order and the strategy's. The rule picks one and states it: scan the list as the
    // user has it and stop above the first card this one outranks — here Discover, at the top. The
    // two existing cards keep their relative order, which is the half that was deliberate.
    const dragged = [
      row('disc', 0, 'card', { remaining: 10_000 }),
      row('visa', 1, 'card', { remaining: 8_000 }),
    ];
    const w = planNewCardRankWrites(dragged, RANKED_CARDS, card('rh', 20), 'avalanche')!;
    expect(w.cards).toEqual([
      { id: 'disc', surplus_sort_order: 1 },
      { id: 'visa', surplus_sort_order: 2 },
      { id: 'rh', surplus_sort_order: 0, surplus_share: null },
    ]);
  });
});

describe('making room cannot lose a row', () => {
  // The regression pin for 2026-08-27: seating the Robinhood card at rank 0 bumped the goal side
  // through the wrong channel, broke the Prime Visa / move-fund split pairing, and had to be
  // repaired by hand in SQL.
  const STAGED = [
    row('visa', 0, 'card', { remaining: 8_000 }),
    row('g1', 1, 'goal', { goalId: 'g1', stageId: 's1', stage: 1 }),
    row('g1::stop2', 2, 'goal', { goalId: 'g1', stageId: 's2', stage: 2 }),
  ];

  it('bumps a staged goal STOP through goalStages, never through goals', () => {
    const w = planNewCardRankWrites(STAGED, [card('visa', 27.49, 8_000)], card('rh', 29.99), 'avalanche')!;
    expect(w.goals).toEqual([]);
    expect(w.goalStages).toEqual([
      { goalId: 'g1', stageId: 's1', sort_order: 2 },
      { goalId: 'g1', stageId: 's2', sort_order: 3 },
    ]);
    expect(w.cards).toEqual([
      { id: 'visa', surplus_sort_order: 1 },
      { id: 'rh', surplus_sort_order: 0, surplus_share: null },
    ]);
  });

  it('bumps a stop the same way when a card is pulled out of the block', () => {
    const rows = [row(CARDS_ROW_ID, 0, 'cards'), row('g1', 1, 'goal', { goalId: 'g1', stageId: 's1', stage: 1 })];
    const w = planCardSeparationWrites(rows, 'visa', true);
    expect(w.goals).toEqual([]);
    expect(w.goalStages).toEqual([{ goalId: 'g1', stageId: 's1', sort_order: 2 }]);
    expect(w.cards).toEqual([{ id: 'visa', surplus_sort_order: 1, surplus_share: null }]);
  });

  it('bumps a car fund through carFunds and a liability through the accounts channel', () => {
    const rows = [
      row('visa', 0, 'card', { remaining: 8_000 }),
      row('fund', 1, 'car_fund'),
      row('sl', 2, 'liability'),
    ];
    const w = planNewCardRankWrites(rows, [card('visa', 27.49, 8_000)], card('rh', 29.99), 'avalanche')!;
    expect(w.carFunds).toEqual([{ id: 'fund', sort_order: 2 }]);
    expect(w.cards).toEqual([
      { id: 'visa', surplus_sort_order: 1 },
      { id: 'sl', surplus_sort_order: 3 },
      { id: 'rh', surplus_sort_order: 0, surplus_share: null },
    ]);
  });

  it('leaves the block row’s stored rank alone — it is about to stand for nothing', () => {
    // The block row is on screen only because the new card is transiently inside it. Bumping
    // `profiles.cards_sort_order` here would walk the block's rank down one per card ever added.
    const rows = [row(CARDS_ROW_ID, 0, 'cards'), ...INDIVIDUAL];
    const w = planNewCardRankWrites(rows, RANKED_CARDS, card('rh', 29.99), 'avalanche')!;
    expect(w.cardsSortOrder).toBeNull();
  });
});
