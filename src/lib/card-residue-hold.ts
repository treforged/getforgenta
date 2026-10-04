/**
 * ceb711fc — HOW MUCH OF THIS MONTH'S RANKED RESERVE BELONGS TO A CARD THAT STILL OWES.
 *
 * The ranked waterfall (`computeAutoExtraReserve`) is handed the card block's capacity as the
 * REVOLVING BALANCE LEFT AFTER the sim's payment, but the pool it divides is NOT net of that
 * payment. So the cards' share of the pool is spent by the payment itself, and the residue the
 * payment leaves behind is never funded by anyone. A target the user ranked BELOW the cards then
 * takes surplus dollars in a month a card above it still carries interest-bearing debt.
 * Measured on Tre's 2026-10-04 capture: the C5 loan (10.18% APR, rank 4) was funded while
 * Discover (16.6% APR, rank 2) still owed money, and the cards cleared a month late. That breaks
 * both his rank order and the standing rule to save the user the most money.
 *
 * This returns the dollars to take back off the BOTTOM of the reserve so they stay in checking,
 * where step 3's surplus branch feeds them to the cards on the next convergence pass.
 *
 * ⚠️ THE ANSWER IS BOUNDED SO IT CAN NEVER INVERT THE USER'S ORDER. The engine sheds the lowest
 * rank first. Shedding `H` takes `max(0, H - below(t))` from targets ranked at or above any rank
 * `t`, where `below(t)` is what sits strictly below `t`; those dollars may only go to cards ranked
 * strictly above `t`. So for every target rank `t`:
 *
 *     H <= below(t) + residue(cards ranked above t)
 *
 * plus the two trivial caps: never more than the cards owe, never more than the reserve holds.
 * A goal ranked above every card therefore keeps its money (the residue term is 0 at its rank),
 * and a card the user ranked at or BELOW a target holds nothing back from that target.
 *
 * ⚠️ THERE IS NO DUST ALLOWANCE, ON PURPOSE. Two were tried on the 2026-09-17 golden capture and
 * both stopped the convergence loop settling (32 passes, unconverged, up to fourteen months
 * published below the floor): IGNORING a card that owes $1 or less, and SUBTRACTING $1 from every
 * residue. The first jumps on and off as a residue crosses $1 between passes; why the second fails
 * as well is not diagnosed. Without any allowance the same capture converges. The caller nets the
 * month's slack off this figure, which is what keeps a few cents of permanent dust from cutting a
 * goal (see the ceb711fc block in forecast-engine.ts).
 */

export interface ReserveLine {
  /** The target's place in the user's list, lower first. Unranked is `+Infinity`. */
  rank: number;
  amount: number;
}

export interface CardResidue {
  /** The card's effective rank. A card inside the block sits half a rank ahead of
   *  `cards_sort_order`, the same tie-break `computeAutoExtraReserve` gives the block. */
  rank: number;
  /** Revolving balance left after this month's sim payment. */
  residue: number;
}

export function cardResidueHold(
  reserve: readonly ReserveLine[],
  cards: readonly CardResidue[],
): number {
  const owing = cards.filter(c => c.residue > 0);
  const funded = reserve.filter(t => t.amount > 0);
  if (owing.length === 0 || funded.length === 0) return 0;

  const residueTotal = owing.reduce((s, c) => s + c.residue, 0);
  const reserveTotal = funded.reduce((s, t) => s + t.amount, 0);
  let hold = Math.min(residueTotal, reserveTotal);
  for (const rank of new Set(funded.map(t => t.rank))) {
    const below = funded.filter(t => t.rank > rank).reduce((s, t) => s + t.amount, 0);
    const residueAbove = owing.filter(c => c.rank < rank).reduce((s, c) => s + c.residue, 0);
    hold = Math.min(hold, below + residueAbove);
  }
  return Math.max(0, hold);
}
