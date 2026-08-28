/**
 * WHAT A CYCLING CARD'S STATEMENT WILL COST NEXT MONTH — the figure the save-up look-ahead must
 * reserve against.
 *
 * A cycling card (autopay-full / statement preference, no revolving balance) defers this month's
 * purchases into next month's statement, and paying that statement is a bill, not a choice. The
 * look-ahead in `useCardProjection` therefore has to know the amount BEFORE the simulation has
 * decided whether it could afford it — which is the whole subtlety, and the reason this is a
 * function with a name rather than an expression inlined at the call site.
 *
 * ── THE DEADLOCK THIS EXISTS TO BREAK (2026-08-27) ───────────────────────────
 * The look-ahead used to size the reserve from the simulation's LAST answer: it reserved what the
 * sim paid, and the sim paid what the reserve allowed. On Tre's live data that fixed point settled
 * at the 2% floor — a $230 grocery statement on a 29.99% card was paid $50 in Nov and $61 of $414.50
 * in Dec, revolving the exact balance the card plan exists to avoid, and only catching up in Jan.
 *
 * The guard against that was already there, as `Math.max(actual, intended)`. It did not work,
 * because `intended` read the per-month purchase map with a fallback of ZERO. A card whose spend is
 * an ordinary RECURRING RULE has nothing in that map — the map carries scheduled one-offs — so
 * `intended` was 0, the max collapsed back to the underpayment, and the deadlock closed anyway.
 *
 * ⚠️ THE INVARIANT: THIS MUST NOT UNDER-REPORT WHAT THE ENGINE WILL ACTUALLY CHARGE.
 * `credit-card-engine.ts` defers `Math.max(cardPurchasesThisMonth(card), card.monthlyNewPurchases)`
 * where `cardPurchasesThisMonth` itself falls back to `monthlyNewPurchases` for m >= 1 — so the
 * engine charges AT LEAST the steady recurring amount every month, map entry or no map entry. Any
 * reserve smaller than that is a reserve the sim will overrun, and the overrun lands as
 * interest-bearing backlog. Over-reporting is the safe direction and under-reporting is not, which
 * is why both terms are a `max` rather than a fallback chain.
 */

/** The least this needs of a card: its steady monthly recurring spend estimate. */
export type CyclingReserveCard = {
  id: string;
  /** `CardData.monthlyNewPurchases` — the recurring monthly spend the engine re-applies every month. */
  monthlyNewPurchases: number;
};

/**
 * What month `m`'s statement will be for `card`, from the purchases deferred out of month `m - 1`.
 *
 * Month 0 is always 0: there is no deferred history before the projection starts, so month 0's
 * statement is not something this projection can be asked to have reserved for.
 *
 * `perMonth` is `cardPurchasesPerMonth` — `perMonth[m][cardId]`, sparse by design.
 */
export function intendedCyclingStatement(
  perMonth: readonly ({ [cardId: string]: number } | undefined)[] | undefined,
  m: number,
  card: CyclingReserveCard,
): number {
  if (m <= 0) return 0;
  const scheduled = perMonth?.[m - 1]?.[card.id] ?? 0;
  const steady = Number(card.monthlyNewPurchases) || 0;
  return Math.max(Math.max(0, scheduled), Math.max(0, steady));
}
