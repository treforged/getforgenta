// Q10 — dust-tolerant revolving payoff month.
//
// The convergence loop's whole-dollar debtCashTargetByMonth can leave a card's payoff
// payment cents short (live: Prime Visa held $0.04 forever). That state is economically
// settled — grace held, zero interest — so the payoff-month reducers must not treat a
// sub-dollar remainder as live debt. Threshold matches the engine's <$1 dust convention.
export const REVOLVING_DUST_DOLLARS = 1;

/**
 * First month (1-indexed) where the summed revolving balance across `cardIds` drops
 * below the dust threshold, or null if it never does within `months`. Only cards with
 * a month-0 revolving balance > 0 count; if no card starts revolving, returns null
 * (there was never debt to pay off, so there is no payoff month).
 */
export function firstRevolvingPayoffMonth(
  monthlyRevolvingBalances: Map<string, number[]>,
  cardIds: string[],
  months: number,
): number | null {
  const revolvingIds = cardIds.filter(
    id => (monthlyRevolvingBalances.get(id)?.[0] ?? 0) > 0,
  );
  if (revolvingIds.length === 0) return null;
  for (let m = 0; m < months; m++) {
    const totalRevBal = revolvingIds.reduce(
      (s, id) => s + Math.max(0, monthlyRevolvingBalances.get(id)?.[m] ?? 0), 0,
    );
    if (totalRevBal < REVOLVING_DUST_DOLLARS) {
      return m + 1;
    }
  }
  return null;
}
