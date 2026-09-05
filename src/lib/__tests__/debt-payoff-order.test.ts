import { describe, it, expect } from 'vitest';
import { generateRecommendations, type CardData } from '../credit-card-engine';
import { getStrategyPayoffOrder, getUnratedPayoffCards, cardMarginalApr, payoffOrderAsOf, utilizationComparisonOrder } from '../debt-payoff-order';
import type { BalanceTranche } from '../balance-tranches';

// The /debt build list prints "#1, #2, #3" in the order the engine actually pays the cards.
// The whole risk here is a naive sort on the flat `card.apr`: a promo tranche changes which card
// the next dollar should go to, which is why generateRecommendations ranks avalanche on
// marginalApr (see 88d8ac6d). These tests pin the selector's order AGAINST the engine's own
// output, so the list cannot drift away from the plan it is claiming to describe.

const CARD_BASE = {
  creditLimit: 10000, monthlyRepayments: 0, color: '#000',
  autopayFullBalance: false, statementBalancePhase: false, statementBalance: null,
  steadyMonthlyPurchases: 0, monthlyNewPurchases: 0, paymentPreference: null,
} as const;

function makeCard(overrides: Partial<CardData> & Pick<CardData, 'id'>): CardData {
  return {
    ...CARD_BASE, name: overrides.id, balance: 0, apr: 0,
    minPayment: 25, targetPayment: 25, dueDay: 15,
    ...overrides,
  } as CardData;
}

function tranche(overrides: Partial<BalanceTranche>): BalanceTranche {
  return { id: 't', label: 'Promo balance', balance: 0, apr: 0, promo_end_date: null, ...overrides };
}

/**
 * X's headline APR (10%) is the LOWEST of the three, but its whole balance sits in a 29.99% cash
 * advance tranche, so the next dollar paid to it saves 29.99% and the engine attacks it first.
 * Sorting by flat apr would print Y (20%) → Z (14%) → X (10%) — exactly backwards at both ends.
 */
function trancheFixture(): CardData[] {
  return [
    makeCard({ id: 'Y', name: 'Plain card', balance: 3000, apr: 20 }),
    makeCard({ id: 'X', name: 'Tranche card', balance: 5000, apr: 10,
      tranches: [tranche({ id: 'hi', label: 'Cash advance', balance: 5000, apr: 29.99 })] }),
    makeCard({ id: 'Z', name: 'Middle card', balance: 1200, apr: 14 }),
  ];
}

const ASOF = payoffOrderAsOf(new Date());

/** The engine's own paying order: its revolving recommendations, in the order it emitted them. */
function engineOrder(cards: CardData[], strategy: 'avalanche' | 'snowball'): string[] {
  const { recommendations } = generateRecommendations(cards, 10000, 0, strategy, 0, 0);
  return recommendations.map(r => r.cardId);
}

describe('getStrategyPayoffOrder', () => {
  it('avalanche ranks on the marginal rate a tranche creates, not the flat APR', () => {
    const cards = trancheFixture();
    const order = getStrategyPayoffOrder(cards, 'avalanche', ASOF);
    expect(order.map(o => o.cardId)).toEqual(['X', 'Y', 'Z']);
    // The flat-APR order this must NOT be, so the assertion above cannot pass by accident.
    expect(order.map(o => o.cardId)).not.toEqual(
      [...cards].sort((a, b) => b.apr - a.apr).map(c => c.id),
    );
  });

  it('matches the order generateRecommendations pays the cards in (avalanche, tranche card)', () => {
    const cards = trancheFixture();
    expect(getStrategyPayoffOrder(cards, 'avalanche', ASOF).map(o => o.cardId))
      .toEqual(engineOrder(cards, 'avalanche'));
  });

  it('matches the order generateRecommendations pays the cards in (snowball)', () => {
    const cards = trancheFixture();
    expect(getStrategyPayoffOrder(cards, 'snowball', ASOF).map(o => o.cardId))
      .toEqual(engineOrder(cards, 'snowball'));
    expect(getStrategyPayoffOrder(cards, 'snowball', ASOF).map(o => o.cardId)).toEqual(['Z', 'Y', 'X']);
  });

  it('carries both rates so the flat APR is never taken away', () => {
    const [x] = getStrategyPayoffOrder(trancheFixture(), 'avalanche', ASOF);
    expect(x.cardId).toBe('X');
    expect(x.apr).toBe(10);
    expect(x.marginalApr).toBe(29.99);
  });

  it('leaves a single-rate card reading exactly its own APR, and keeps flat order', () => {
    const cards = [
      makeCard({ id: 'A', balance: 2000, apr: 22.99 }),
      makeCard({ id: 'B', balance: 8000, apr: 18.99 }),
    ];
    const order = getStrategyPayoffOrder(cards, 'avalanche', ASOF);
    expect(order.map(o => o.cardId)).toEqual(['A', 'B']);
    expect(order.map(o => o.marginalApr)).toEqual([22.99, 18.99]);
  });

  it('excludes zero-balance cycling cards — nothing is being paid off there', () => {
    const cards = [
      makeCard({ id: 'A', balance: 2000, apr: 22.99 }),
      makeCard({ id: 'C', balance: 0, apr: 26.99, autopayFullBalance: true, paymentPreference: 'full' }),
      makeCard({ id: 'D', balance: 0, apr: 19.99 }),
    ];
    expect(getStrategyPayoffOrder(cards, 'avalanche', ASOF).map(o => o.cardId)).toEqual(['A']);
  });

  it('does not mutate the cards it is given', () => {
    const cards = trancheFixture();
    const before = cards.map(c => c.id);
    getStrategyPayoffOrder(cards, 'avalanche', ASOF);
    expect(cards.map(c => c.id)).toEqual(before);
  });
});

describe('cardMarginalApr', () => {
  it('returns the promo rate while it is live and the standard rate after it expires', () => {
    const card = makeCard({ id: 'P', balance: 5037.73, apr: 16.6,
      tranches: [tranche({ id: 'promo', balance: 5037.73, apr: 7.99, promo_end_date: '2028-01-04' })] });
    expect(cardMarginalApr(card, '2026-08-14')).toBe(7.99);
    expect(cardMarginalApr(card, '2028-02-01')).toBe(16.6);
  });

  it('equals card.apr on a card with no tranches', () => {
    expect(cardMarginalApr(makeCard({ id: 'S', balance: 900, apr: 24.99 }), ASOF)).toBe(24.99);
  });
});

describe('payoffOrderAsOf', () => {
  it('formats the LOCAL date, not the UTC one', () => {
    // 2026-08-14 21:30 local: toISOString() would roll this to the 15th in any negative offset.
    expect(payoffOrderAsOf(new Date(2026, 7, 14, 21, 30))).toBe('2026-08-14');
    expect(payoffOrderAsOf(new Date(2026, 0, 5, 3, 0))).toBe('2026-01-05');
  });
});

describe('utilizationComparisonOrder (UtilizationPanel)', () => {
  it('ranks on the marginal rate, not the flat APR, for the same tranche fixture', () => {
    const cards = trancheFixture();
    expect(utilizationComparisonOrder(cards, ASOF)).toEqual(['X', 'Y', 'Z']);
    // The flat-APR order this must NOT be — the 88d8ac6d bug class the panel carried.
    expect(utilizationComparisonOrder(cards, ASOF)).not.toEqual(
      [...cards].sort((a, b) => b.apr - a.apr).map(c => c.id),
    );
  });

  it('keeps cycling (autopay-full) cards in the order — the panel positions them via indexOf', () => {
    const cards = [
      ...trancheFixture(),
      makeCard({ id: 'C', name: 'Cycling card', balance: 900, apr: 25, autopayFullBalance: true }),
    ];
    const order = utilizationComparisonOrder(cards, ASOF);
    expect(order).toContain('C');
    expect(order).toEqual(['X', 'C', 'Y', 'Z']);
    // getStrategyPayoffOrder deliberately excludes it; this wider population must not.
    expect(getStrategyPayoffOrder(cards, 'avalanche', ASOF).map(o => o.cardId)).not.toContain('C');
  });

  it('drops zero-balance cards — nothing to compare', () => {
    const cards = [...trancheFixture(), makeCard({ id: 'E', name: 'Empty', balance: 0, apr: 30 })];
    expect(utilizationComparisonOrder(cards, ASOF)).not.toContain('E');
  });
});

/**
 * A card whose account carries NO apr at all. Until 2026-09-05 this collapsed to `apr: 0` on the
 * way out of buildCardData and then sorted LAST under avalanche — the cheapest slot in the list,
 * handed to the one card whose cost nobody has measured. `aprIsUnknown` keeps the distinction, and
 * the strategy declines to rank what it cannot compare.
 */
function unratedFixture(): CardData[] {
  return [
    // Both known cards carry SMALL balances on purpose: a surplus large enough to fill them both
    // spills past them, and the third slot is where the old behaviour quietly handed money to the
    // unrated card. A fixture where the surplus never gets that far would pass either way.
    makeCard({ id: 'HI', name: 'Known 24%', balance: 500, apr: 24 }),
    makeCard({ id: 'LO', name: 'Genuine 0%', balance: 300, apr: 0 }),
    makeCard({ id: 'UNK', name: 'Rate unknown', balance: 6000, apr: 0, aprIsUnknown: true, minPayment: 90 }),
  ];
}

describe('a card with no stored APR', () => {
  it('is absent from the avalanche order — not sorted last at a placeholder 0%', () => {
    const order = getStrategyPayoffOrder(unratedFixture(), 'avalanche', ASOF);
    expect(order.map(o => o.cardId)).toEqual(['HI', 'LO']);
  });

  it('does not take a genuine 0% card down with it — 0% is a rate, absent is not', () => {
    const order = getStrategyPayoffOrder(unratedFixture(), 'avalanche', ASOF);
    expect(order.map(o => o.cardId)).toContain('LO');
    expect(order.find(o => o.cardId === 'LO')?.aprIsUnknown).toBe(false);
  });

  it('IS ranked by snowball, which compares balances and needs no rate', () => {
    const order = getStrategyPayoffOrder(unratedFixture(), 'snowball', ASOF);
    expect(order.map(o => o.cardId)).toEqual(['LO', 'HI', 'UNK']);
  });

  it('is returned by getUnratedPayoffCards, exactly once and never also in the ranked list', () => {
    const cards = unratedFixture();
    const ranked = getStrategyPayoffOrder(cards, 'avalanche', ASOF).map(o => o.cardId);
    const unrated = getUnratedPayoffCards(cards, 'avalanche', ASOF);
    expect(unrated.map(o => o.cardId)).toEqual(['UNK']);
    expect(ranked).not.toContain('UNK');
    expect(unrated[0].aprIsUnknown).toBe(true);
  });

  it('leaves nothing unrated under snowball — every card there has a rank', () => {
    expect(getUnratedPayoffCards(unratedFixture(), 'snowball', ASOF)).toEqual([]);
  });

  it('still has its MINIMUM paid by the engine — unranked is not unpaid', () => {
    const cards = unratedFixture();
    // Cash covers the three minimums (25 + 25 + 90 = 140) and nothing more, so every dollar
    // allocated is a contract minimum and none of it is strategy surplus.
    const { recommendations } = generateRecommendations(cards, 140, 0, 'avalanche', 0, 0);
    const unk = recommendations.find(r => r.cardId === 'UNK');
    expect(unk).toBeDefined();
    expect(unk!.payment).toBe(90);
    expect(recommendations.reduce((s, r) => s + r.payment, 0)).toBe(140);
  });

  it('receives NO avalanche surplus while its rate is unknown, even once the known cards are full', () => {
    const cards = unratedFixture();
    // $140 of minimums, then $1,000 of surplus. $475 fills HI and $275 fills LO; the remaining
    // $250 has nowhere ranked left to go. Before this fix it went to UNK at a placeholder 0%.
    const { recommendations } = generateRecommendations(cards, 1140, 0, 'avalanche', 0, 0);
    const by = (id: string) => recommendations.find(r => r.cardId === id)!.payment;
    expect(by('HI')).toBe(500);
    expect(by('LO')).toBe(300);
    expect(by('UNK')).toBe(90);
    expect(recommendations.reduce((s, r) => s + r.payment, 0)).toBe(890);
  });

  it('does not strand the surplus when EVERY payable card is unrated — nothing to mis-rank', () => {
    const onlyUnrated = [
      makeCard({ id: 'A', name: 'Only card', balance: 5000, apr: 0, aprIsUnknown: true, minPayment: 50 }),
    ];
    const { recommendations } = generateRecommendations(onlyUnrated, 600, 0, 'avalanche', 0, 0);
    expect(recommendations.find(r => r.cardId === 'A')!.payment).toBe(600);
    expect(getStrategyPayoffOrder(onlyUnrated, 'avalanche', ASOF).map(o => o.cardId)).toEqual(['A']);
    expect(getUnratedPayoffCards(onlyUnrated, 'avalanche', ASOF)).toEqual([]);
  });
});
