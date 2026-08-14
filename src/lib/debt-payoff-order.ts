import { marginalApr, type CardData } from './credit-card-engine';

/**
 * The order the payoff strategy actually attacks the cards in, and the rate that ranked each one.
 *
 * This is a READ-ONLY view for the /debt build list and the per-card rate badge. It deliberately
 * mirrors `generateRecommendations`' own sort (credit-card-engine.ts, "Pure strategy sort") rather
 * than re-deriving one: avalanche ranks on the MARGINAL rate, because the next dollar paid to a
 * multi-rate card lands on its highest-APR bucket (CARD Act §164), so a promo tranche can put a
 * card with a high headline APR behind a plain card with a lower one. Sorting the list by flat
 * `card.apr` would print a different order than the engine pays — the same class of mismatch fixed
 * in 88d8ac6d. `debt-payoff-order.test.ts` pins this order against `generateRecommendations`'
 * actual output so the two cannot drift apart silently.
 */

export type DebtPayoffOrderEntry = {
  cardId: string;
  cardName: string;
  color: string;
  balance: number;
  /** The card's headline APR — always shown; the marginal rate is additional, never a replacement. */
  apr: number;
  /** The rate the next dollar paid to this card actually saves. Equals `apr` on a single-rate card. */
  marginalApr: number;
};

/** Local YYYY-MM-DD. Deliberately not toISOString(), which shifts the day in non-UTC zones. */
export function payoffOrderAsOf(now = new Date()): string {
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * The rate the next dollar paid to `card` saves, as of `asOf` — the exact expression
 * `generateRecommendations` ranks avalanche on. Equals `card.apr` for every card without tranches.
 */
export function cardMarginalApr(card: CardData, asOf: string): number {
  return marginalApr(card, (card.tranches ?? []).map(t => t.balance), Math.max(0, card.balance), asOf);
}

/**
 * Cards in the order the strategy pays them, highest priority first. Same population the engine
 * ranks: revolving cards carrying a balance (a zero-balance cycling card is not being paid off).
 */
export function getStrategyPayoffOrder(
  cards: readonly CardData[],
  strategy: 'avalanche' | 'snowball',
  asOf: string,
): DebtPayoffOrderEntry[] {
  return cards
    .filter(c => !c.autopayFullBalance && c.balance > 0)
    .map(c => ({
      cardId: c.id,
      cardName: c.name,
      color: c.color,
      balance: c.balance,
      apr: c.apr,
      marginalApr: cardMarginalApr(c, asOf),
    }))
    .sort((a, b) => (
      strategy === 'avalanche' ? b.marginalApr - a.marginalApr : a.balance - b.balance
    ));
}
