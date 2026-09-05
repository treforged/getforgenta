import { marginalApr, rankableForStrategy, type CardData } from './credit-card-engine';

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
  /** True when no APR is stored on the account at all. `apr` reads 0 on such a card, but 0 here is
   * a placeholder, not a rate — the row asks for the real one rather than claiming 0%. */
  aprIsUnknown: boolean;
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
  const payable = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
  return rankableForStrategy(payable, strategy)
    .map(c => ({
      cardId: c.id,
      cardName: c.name,
      color: c.color,
      balance: c.balance,
      apr: c.apr,
      aprIsUnknown: Boolean(c.aprIsUnknown),
      marginalApr: cardMarginalApr(c, asOf),
    }))
    .sort((a, b) => (
      strategy === 'avalanche' ? b.marginalApr - a.marginalApr : a.balance - b.balance
    ));
}

/**
 * The cards the strategy is paying but CANNOT rank — today, only avalanche and only because the
 * account carries no APR. They are deliberately absent from `getStrategyPayoffOrder` (ranking them
 * at a placeholder 0% would bury possibly-expensive debt at the bottom of the list), so this is the
 * companion list the UI renders as "needs your rate" with an inline input. Same population and same
 * fallback: when EVERY payable card is unrated `getStrategyPayoffOrder` keeps them all, so this
 * returns nothing and no card is listed twice.
 */
export function getUnratedPayoffCards(
  cards: readonly CardData[],
  strategy: 'avalanche' | 'snowball',
  asOf: string,
): DebtPayoffOrderEntry[] {
  const payable = cards.filter(c => !c.autopayFullBalance && c.balance > 0);
  const ranked = new Set(getStrategyPayoffOrder(cards, strategy, asOf).map(e => e.cardId));
  return payable
    .filter(c => !ranked.has(c.id))
    .map(c => ({
      cardId: c.id,
      cardName: c.name,
      color: c.color,
      balance: c.balance,
      apr: c.apr,
      aprIsUnknown: Boolean(c.aprIsUnknown),
      marginalApr: cardMarginalApr(c, asOf),
    }))
    .sort((a, b) => b.balance - a.balance);
}

/**
 * ⚠️ NO UI READS THIS SINCE 2026-08-27 — the score-order table it ranked for was deleted from
 * `UtilizationPanel` on Tre's ask. Kept, with its tests, as the one statement of the marginal-rate
 * comparison order; it is not dead arithmetic, it is arithmetic with no screen at the moment.
 *
 * Comparison order: every card carrying a balance — cycling
 * (autopay-full) cards included, because the panel positions rows via `indexOf` and a
 * missing id would silently drop a card from the comparison. Ranked on the marginal rate
 * exactly as avalanche pays; the population is deliberately WIDER than
 * `getStrategyPayoffOrder`'s, which only lists the cards the strategy is paying off.
 */
export function utilizationComparisonOrder(cards: readonly CardData[], asOf: string): string[] {
  return cards
    .filter(c => c.balance > 0)
    .map(c => ({ id: c.id, marginal: cardMarginalApr(c, asOf) }))
    .sort((a, b) => b.marginal - a.marginal)
    .map(c => c.id);
}
