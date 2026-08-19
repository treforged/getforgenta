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
