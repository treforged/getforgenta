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

export type RankedTargetKind = 'card' | 'car_fund' | 'goal' | 'loan';

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
  /**
   * Weight for a SPLIT rank — targets sharing one `sortOrder` divide that rank's money in
   * proportion to their shares instead of the higher one filling before the lower is offered a
   * cent. Any positive number works (50/50, 70/30, 2/1); only the ratio within the group matters.
   *
   * Omitted ⇒ this target does not want a split. A rank where NO member declares a share behaves
   * exactly as it always has — strict sequential fill, ties broken on `id` — which is what keeps
   * every pre-split user byte-identical. See `allocateRankedSurplus`.
   */
  share?: number;
  /**
   * Cards only, and only meaningful to `computeAutoExtraReserve`: this card was pulled OUT of the
   * card block and given its own rank, so a goal can sit between two cards.
   *
   * ⚠️ It moves the SPLIT POINT between debt and goals, not the payoff order. Which card the
   * remaining card pool actually pays is still decided by the strategy (avalanche/snowball) inside
   * the revolving cascade, exactly as `ranked-extra-payment-targets.ts` argues it must be — a rank
   * that silently overrode marginal-APR order would cost the user interest. What an individual
   * rank buys is the ability to say "fund the move AFTER the Visa but BEFORE the Discover", which
   * a contiguous block cannot express at all.
   */
  rankedIndividually?: boolean;
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

  // PASS 2 — ranked surplus. Each RANK fills to its remaining capacity, then the rest flows on.
  //
  // A rank is normally one target, in which case this is the plain sequential fill it has always
  // been. Where several targets share a `sortOrder` AND at least one of them declares a `share`,
  // the rank is a SPLIT: its money is divided in proportion to the shares instead of the first
  // member filling before the second is offered anything. That is the only shape in which "the
  // move fund and the Discover, half each" can be said at all.
  //
  // ⚠️ A rank whose members declare NO share is untouched — strict sequential fill, ties on `id`.
  // That is deliberate and load-bearing: `share` is a new nullable column, so every existing row
  // arrives here undefined and every existing user's allocation is byte-identical.
  const headroomOf = (t: RankedTarget, i: number) => {
    if (t.autoExtra === false) return 0;
    const headroom = Math.max(0, t.capacity - paidMinimum[i]);
    return t.maxExtra === undefined ? headroom : Math.min(headroom, Math.max(0, t.maxExtra));
  };

  const paidExtra = new Array<number>(ranked.length).fill(0);

  /** Fill `idxs` in rank order, each to its remaining headroom, out of the shared pool. */
  const fillSequentially = (idxs: readonly number[]) => {
    for (const i of idxs) {
      if (pool < CENT) return;
      const take = Math.min(headroomOf(ranked[i], i) - paidExtra[i], pool);
      if (take <= 0) continue;
      paidExtra[i] += take;
      pool -= take;
    }
  };

  for (let start = 0; start < ranked.length; ) {
    let end = start + 1;
    while (end < ranked.length && ranked[end].sortOrder === ranked[start].sortOrder) end += 1;
    const idxs = Array.from({ length: end - start }, (_, k) => start + k);
    start = end;
    if (pool < CENT) continue;

    // Weights come only from members that can actually take a share; an opted-out target is not
    // part of the split, and a zero/negative/non-finite share is not a weight.
    const weights = idxs.map(i => {
      const w = ranked[i].share;
      if (ranked[i].autoExtra === false || w === undefined || !Number.isFinite(w) || w <= 0) return 0;
      return w;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    if (idxs.length === 1 || totalWeight <= 0) {
      fillSequentially(idxs);
      continue;
    }

    // PROPORTIONAL PASS. Every member is measured against the pool as it stood ENTERING the rank,
    // so the split is 50/50 of the rank's money rather than 50% and then 50% of what is left.
    const atRankStart = pool;
    idxs.forEach((i, k) => {
      if (weights[k] <= 0) return;
      const want = (atRankStart * weights[k]) / totalWeight;
      const take = Math.min(want, headroomOf(ranked[i], i), pool);
      if (take <= 0) return;
      paidExtra[i] += take;
      pool -= take;
    });

    // …then the rank's own leftovers cascade WITHIN the rank before they fall to the next one. A
    // split partner that is already full hands its half to the other partner, not to whatever the
    // user ranked below both of them — which is what "split with" means to the person who set it.
    fillSequentially(idxs);
  }

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

/** Everything the reserve can be held back FOR — every kind except a credit card, whose extra
 *  stays inside the card pool and is spent by the revolving cascade. */
export type AutoExtraReserveKind = 'car_fund' | 'goal' | 'loan';

export type AutoExtraReserve = {
  /** Total to hold back from the card pool this month for goals, car funds and loan principal. */
  reserved: number;
  /** Per-target share, in ranked order. Empty when nothing is reserved. */
  perTarget: { id: string; kind: AutoExtraReserveKind; amount: number }[];
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

  // Cards the user has pulled OUT of the block and ranked for themselves. They enter the allocator
  // as their own targets so a goal can sit BETWEEN two cards; everything still inside the block
  // enters as the one synthetic row below, exactly as it always has.
  const individualCards = targets.filter(t => t.kind === 'card' && t.rankedIndividually === true);
  const individualMinimums = individualCards.reduce((s, c) => s + Math.max(0, c.minimum), 0);
  const individualCapacity = individualCards.reduce((s, c) => s + Math.max(0, c.capacity), 0);

  // ⚠️ THE BLOCK IS THE REMAINDER, NOT THE WHOLE. `cardMinimumsTotal` / `cardBalanceTotal` are the
  // engine's own aggregates for ALL cards, and they are the figures the cascade downstream will
  // spend — so an individually-ranked card's minimum and balance are subtracted here rather than
  // counted twice. The sum over every card target is therefore still exactly the engine's total,
  // which is what keeps the minimum-protection proof and the cash chain intact. With no card
  // ranked individually both subtractions are zero and this is the pre-feature block verbatim.
  const CARD_BLOCK = '__cards__';
  const { allocations } = allocateRankedSurplus(pool, [
    ...rankable,
    ...individualCards,
    {
      // Half a rank ahead of its nominal position, so an exact tie with a target's rank resolves
      // in favour of the cards. Ties are otherwise broken on id, which for a uuid vs a sentinel is
      // arbitrary -- and "arbitrary" is not an acceptable way to decide whether debt or a goal gets
      // the money. Every non-tie comparison is unaffected: a UI that hands out 0, 1, 2 places the
      // card row exactly where the user dragged it.
      id: CARD_BLOCK, kind: 'card', sortOrder: cardsSortOrder - 0.5,
      minimum: Math.max(0, cardMinimumsTotal - individualMinimums),
      capacity: Math.max(0, cardBalanceTotal - individualCapacity),
    },
  ]);

  // Cards are filtered out of the reserve whatever their rank: their extra never LEAVES the card
  // pool, it just changes how much of the pool is still there when the cascade runs.
  const perTarget = allocations
    .filter(a => a.kind !== 'card' && a.total >= CENT)
    .map(a => ({ id: a.id, kind: a.kind as AutoExtraReserveKind, amount: a.total }));

  return {
    reserved: Math.round(perTarget.reduce((s, t) => s + t.amount, 0) * 100) / 100,
    perTarget,
  };
}
