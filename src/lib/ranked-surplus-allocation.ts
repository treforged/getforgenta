/**
 * Ranked surplus allocation — the pure core of "automatic extra payments".
 *
 * Today every dollar of `availableToDeploy` (month0-budget-snapshot.ts) goes to credit cards via
 * the avalanche engine. This module turns that single destination into a RANKED LIST: cards, car
 * funds and savings goals in one user-ordered queue, each taking its fill before the remainder
 * flows to the next. Nothing here reads the database, the clock, or the engine — it is deliberately
 * a function of its arguments so the one rule that must never break can be proven in isolation.
 *
 * THE RULE THAT MUST NEVER BREAK: a goal ranked above a card can never starve that card's minimum.
 * Rank orders the SURPLUS, never the obligations. That is enforced structurally rather than by
 * convention — `allocateRankedSurplus` runs a mandatory pass over every target's `minimum` BEFORE
 * it looks at `sortOrder` at all, so there is no ordering of the input that can produce a plan
 * which underpays a minimum while funding a goal. If the pool cannot even cover the minimums the
 * shortfall is REPORTED (`minimumShortfall`), never quietly absorbed by dropping a payment.
 */

/** Half a cent. Below this a residual is rounding noise, not money. */
const CENT = 0.005;

export type RankedTargetKind = 'card' | 'car_fund' | 'goal';

export type RankedTarget = {
  id: string;
  kind: RankedTargetKind;
  /** User-chosen rank, ascending — the `sort_order` pattern used by builds, phases and items.
   * Ties break on `id` so the result is stable regardless of input order. */
  sortOrder: number;
  /**
   * Non-negotiable outflow this month: a card's minimum payment. Paid before ANY ranked
   * allocation, whatever the rank. Goals and car funds are 0 — their manual
   * `monthly_contribution` / `gift_contribution` is already a bill by the time surplus is
   * computed, so counting it here would deduct it twice.
   */
  minimum: number;
  /**
   * The most this target can absorb this month, minimum included — a card's payoff balance, a
   * goal's `target_amount - current_amount`, a car fund's remaining down payment. Allocation
   * never exceeds it, which is what makes a FULL target hand its share on to the next rank
   * instead of letting surplus evaporate against something that needs nothing.
   */
  capacity: number;
  /**
   * Whether this target draws automatic extra payments (`auto_extra`). `false` means it still
   * gets its `minimum` — opting out of extras is not opting out of paying the card — but takes
   * no ranked surplus. Omitted ⇒ true.
   */
  autoExtra?: boolean;
  /** Optional per-month ceiling on the RANKED portion only, on top of `capacity`. Omitted ⇒ none. */
  maxExtra?: number;
};

export type RankedAllocation = {
  id: string;
  kind: RankedTargetKind;
  /** The mandatory portion — what this target would have received at any rank. */
  minimum: number;
  /** The ranked portion, on top of `minimum`. */
  extra: number;
  /** `minimum + extra`, cent-rounded. What the caller actually pays this target. */
  total: number;
};

export type RankedSurplusResult = {
  /** One entry per input target, in the ranked order actually used. */
  allocations: RankedAllocation[];
  /** Pool left after every target hit its cap — flows back to the caller's own surplus handling. */
  unallocated: number;
  /**
   * How much of the combined minimums the pool could NOT cover. Non-zero means the month is
   * already short before any ranking happens; the caller must surface it (this is the engine's
   * existing floor-breach case), never treat it as a successful plan.
   */
  minimumShortfall: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ranked order: `sortOrder` ascending, ties on `id`, so equal ranks are still deterministic. */
export function rankTargets(targets: readonly RankedTarget[]): RankedTarget[] {
  return [...targets].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * Split `deployable` across `targets` in rank order.
 *
 * @param deployable Surplus available this month — `availableToDeploy` from the month-0 snapshot,
 *   which is already net of the cash floor, bills and reserves. Negative is clamped to 0.
 */
export function allocateRankedSurplus(
  deployable: number,
  targets: readonly RankedTarget[],
): RankedSurplusResult {
  const ranked = rankTargets(targets);
  let pool = Math.max(0, deployable);

  // PASS 1 — mandatory. Deliberately ahead of any rank arithmetic: this is what makes it
  // impossible for a highly-ranked goal to starve a card's minimum.
  let minimumShortfall = 0;
  const paidMinimum = ranked.map(t => {
    const due = Math.max(0, Math.min(t.minimum, t.capacity));
    const paid = Math.min(due, pool);
    pool -= paid;
    minimumShortfall += due - paid;
    return paid;
  });

  // PASS 2 — ranked surplus. Each target fills to its remaining capacity, then the rest flows on.
  const paidExtra = ranked.map((t, i) => {
    if (t.autoExtra === false || pool < CENT) return 0;
    const headroom = Math.max(0, t.capacity - paidMinimum[i]);
    const capped = t.maxExtra === undefined ? headroom : Math.min(headroom, Math.max(0, t.maxExtra));
    const take = Math.min(capped, pool);
    pool -= take;
    return take;
  });

  const allocations = ranked.map((t, i) => ({
    id: t.id,
    kind: t.kind,
    minimum: round2(paidMinimum[i]),
    extra: round2(paidExtra[i]),
    total: round2(paidMinimum[i] + paidExtra[i]),
  }));

  return {
    allocations,
    unallocated: round2(Math.max(0, pool)),
    minimumShortfall: round2(minimumShortfall < CENT ? 0 : minimumShortfall),
  };
}

export type AutoExtraReserve = {
  /** Total to hold back from the card pool this month for goals and car funds. */
  reserved: number;
  /** Per-target share, in ranked order. Empty when nothing is reserved. */
  perTarget: { id: string; kind: 'car_fund' | 'goal'; amount: number }[];
};

/**
 * How much of the revolving-card pool this month belongs to opted-in goals and car funds.
 *
 * The card cascade in `generateRecommendations` is elaborate and correct, and replacing it would
 * risk everything the Q1–Q12 anomaly history bought. So this does not replace it: it decides a
 * RESERVE, the cascade then runs unchanged on the reduced pool. When nothing is opted in the
 * reserve is 0 and the cascade sees exactly the pool it saw before — which is every existing user,
 * since `auto_extra` defaults to false.
 *
 * The whole card block enters the allocator as ONE synthetic target carrying the combined minimum
 * due and the combined balance. That is what keeps the minimum-protection proof intact: a goal
 * ranked above the cards is ranked above the block's SURPLUS, never its minimums, because
 * `allocateRankedSurplus` settles every minimum before it consults a rank at all.
 */
export function computeAutoExtraReserve(
  pool: number,
  cardMinimumsTotal: number,
  cardBalanceTotal: number,
  targets: readonly RankedTarget[],
  /** Where the card block sits in the user's list. Defaults to 0 -- cards first, today's
   * behaviour, and the conservative reading for a user who has ranked nothing yet. */
  cardsSortOrder = 0,
): AutoExtraReserve {
  const rankable = targets.filter(t => t.kind !== 'card' && t.autoExtra !== false && t.capacity >= CENT);
  if (rankable.length === 0) return { reserved: 0, perTarget: [] };

  const CARD_BLOCK = '__cards__';
  const { allocations } = allocateRankedSurplus(pool, [
    ...rankable,
    {
      // Half a rank ahead of its nominal position, so an exact tie with a target's rank resolves
      // in favour of the cards. Ties are otherwise broken on id, which for a uuid vs a sentinel is
      // arbitrary -- and "arbitrary" is not an acceptable way to decide whether debt or a goal gets
      // the money. Every non-tie comparison is unaffected: a UI that hands out 0, 1, 2 places the
      // card row exactly where the user dragged it.
      id: CARD_BLOCK, kind: 'card', sortOrder: cardsSortOrder - 0.5,
      minimum: Math.max(0, cardMinimumsTotal), capacity: Math.max(0, cardBalanceTotal),
    },
  ]);

  const perTarget = allocations
    .filter(a => a.id !== CARD_BLOCK && a.total >= CENT)
    .map(a => ({ id: a.id, kind: a.kind as 'car_fund' | 'goal', amount: a.total }));

  return {
    reserved: Math.round(perTarget.reduce((s, t) => s + t.amount, 0) * 100) / 100,
    perTarget,
  };
}
