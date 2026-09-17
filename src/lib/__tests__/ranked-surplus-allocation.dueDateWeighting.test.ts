import { describe, it, expect } from 'vitest';
import { buildRankedTargets } from '../ranked-extra-payment-targets';
import { allocateRankedSurplus } from '../ranked-surplus-allocation';
import type { CardData } from '../credit-card-engine';

/**
 * TRE'S DUE-DATE WEIGHTING — ask `9eba55a8`, his words on 2026-09-17 ~03:20:
 *
 *   "yes, I wanted weighted toward whichever has the nearest due date. Just make sure they both
 *    still hit their targets… credit card should be taken care of as soon as possible to reduce
 *    interest, and saving for the move fund since it's far out can be delayed a little bit more to
 *    where it loads up more when necessary… doesn't truly need to pay more than that since we
 *    still need to save up for the move."
 *
 * ⚠️ THIS PINS BEHAVIOUR THAT WAS ALREADY EMERGENT; IT DOES NOT ADD ANY. Measured 2026-09-17
 * BEFORE writing a line of feature code, which is the check this repo mandates before building.
 * A DATED goal already carries `maxExtra` = its on-time level pace (`goalMonthlyCeiling`), so in a
 * split rank it can only take that pace, and `allocateRankedSurplus`'s within-rank leftover
 * cascade hands the remainder of the rank to its card partner. The card therefore takes MORE than
 * its stored 50 while the goal is ahead of schedule, and less as the deadline nears and the pace
 * rises — his "loads up more when necessary", with no new constant to tune.
 *
 * WHY IT IS PINNED RATHER THAN LEFT IMPLICIT: the weighting is a CONSEQUENCE of two mechanisms in
 * two files that do not mention each other — the goal's pacing ceiling and the rank's leftover
 * cascade. Nothing named this outcome anywhere, so a future change to either one could delete a
 * behaviour Tre asked for by name and nothing would go red.
 *
 * THE SHAPE UNDER TEST is the one he actually has, confirmed by a read-only SELECT on 2026-09-17:
 * a credit card carrying its own `surplus_sort_order` with `surplus_share` 50, and a DATED savings
 * goal at that same rank with `surplus_share` 50 and `auto_extra` true. That is a genuine split of
 * one rank between a card and a dated goal.
 *
 * ⚠️ THE FIGURES BELOW ARE DELIBERATELY ROUND AND NOT HIS. This repo is PUBLIC, and a real
 * savings target beside a real deadline is a person's finances however ordinary it looks in a
 * fixture. Nothing the test asserts depends on the amount or the exact date - the mechanism is the
 * PRESENCE of a deadline, which is what arm B varies.
 *
 * WHAT THIS DOES NOT COVER: which card the surviving card pool actually pays (the strategy's job,
 * inside the revolving cascade), months 1+ (paced inside `forecast-engine.ts`, not here), and an
 * UNDATED goal — which by construction has no deadline to be weighted against. Arm B is that case,
 * and it is a CONTROL rather than a promise.
 */

const primeVisa = (): CardData => ({
  id: 'prime', name: 'Prime Visa', balance: 6_000, apr: 27.49, minPayment: 50, creditLimit: 10_000,
  autopayFullBalance: false, statementBalance: null, statementBalancePhase: false,
  installmentBalance: 0, installmentMonthlyPayment: 0, balanceTranches: [],
} as unknown as CardData);

const ASOF = '2026-09-17';
const NEED = 6_000;
const POOL = 1_500;

/** His split, with the goal's deadline switchable — the one variable under test. */
const hisSplit = (targetDate: string | undefined) => buildRankedTargets({
  cards: [primeVisa()],
  carFunds: [],
  goals: [{
    id: 'move', sort_order: 1, auto_extra: true, surplus_share: 50,
    target_amount: NEED, current_amount: 0, ...(targetDate ? { target_date: targetDate } : {}),
  }],
  strategy: 'avalanche',
  asOf: ASOF,
  cardsSortOrder: 0,
  cardRanks: { prime: { sortOrder: 1, share: 50 } },
});

const extraOf = (r: ReturnType<typeof allocateRankedSurplus>, id: string) =>
  r.allocations.find(a => a.id === id)!.extra;

/**
 * The pool the RANKING actually divides, derived rather than assumed.
 *
 * ⚠️ NOT `POOL`. `allocateRankedSurplus` settles every target's `minimum` in a mandatory pass
 * BEFORE it consults a rank at all - that is what stops a highly-ranked goal starving a card's
 * minimum - so the Prime Visa's minimum payment leaves the pool first and the split divides what
 * is left. Writing 1_500 here instead cost this file two red assertions on correct behaviour, and
 * hardcoding the difference would have re-broken it the day the fixture's minPayment changed.
 */
const rankedPool = (targets: ReturnType<typeof buildRankedTargets>) =>
  POOL - targets.reduce((sum, t) => sum + Math.max(0, Math.min(t.minimum, t.capacity)), 0);

describe("Tre's due-date weighting — a split with a dated goal already favours the card", () => {
  it('POSITIVE CONTROL ON THE BUILDER: his goal is genuinely paced, and the card is genuinely in the split', () => {
    // Without this, a `maxExtra` that silently failed to attach would make arm A read as a feature
    // regression rather than a broken fixture — an absent ceiling and an infinite one are the same
    // thing to the allocator, and both produce a flat 50/50.
    const targets = hisSplit('2027-07-01');
    const goal = targets.find(t => t.id === 'move')!;
    const card = targets.find(t => t.id === 'prime')!;
    expect(goal.maxExtra).toBeGreaterThan(0);
    expect(goal.maxExtra).toBeLessThan(NEED);        // paced, not free to take the whole need
    expect(card.sortOrder).toBe(goal.sortOrder);     // genuinely ONE rank, or there is no split
    expect(card.share).toBe(50);
    expect(goal.share).toBe(50);
  });

  it('ARM A — dated: the card takes MORE than half, and the goal takes exactly its on-time pace', () => {
    const targets = hisSplit('2027-07-01');
    const pace = targets.find(t => t.id === 'move')!.maxExtra!;
    const r = allocateRankedSurplus(POOL, targets);

    expect(extraOf(r, 'move')).toBeCloseTo(pace, 2);
    expect(extraOf(r, 'prime')).toBeGreaterThan(extraOf(r, 'move'));
    expect(extraOf(r, 'prime')).toBeGreaterThan(rankedPool(targets) / 2);
    // Nothing invented and nothing lost: the rank spends the ranked pool, to the cent.
    expect(extraOf(r, 'prime') + extraOf(r, 'move') + r.unallocated)
      .toBeCloseTo(rankedPool(targets), 2);
  });

  it('ARM B — CONTROL, undated: the same split pays a FLAT 50/50, so the DEADLINE is the mechanism', () => {
    // This is what makes arm A evidence. A card that took more in BOTH arms would be taking more
    // for some reason other than the due date, and this file would be pinning a coincidence.
    const targets = hisSplit(undefined);
    expect(targets.find(t => t.id === 'move')!.maxExtra).toBeUndefined();
    const r = allocateRankedSurplus(POOL, targets);
    expect(extraOf(r, 'prime')).toBeCloseTo(rankedPool(targets) / 2, 2);
    expect(extraOf(r, 'move')).toBeCloseTo(rankedPool(targets) / 2, 2);
  });

  it('ARM C — HIS INVARIANT: "make sure they both still hit their targets"', () => {
    // The pace is a LEVEL pace to the deadline, so taking exactly it every month arrives exactly on
    // time. Asserted as the arithmetic he actually named, not as a proxy for it.
    const targets = hisSplit('2027-07-01');
    const goal = targets.find(t => t.id === 'move')!;
    const pace = goal.maxExtra!;
    const monthsAtPace = Math.ceil(goal.capacity / pace);
    const from = new Date(`${ASOF}T00:00:00`);
    const deadline = new Date('2027-07-01T00:00:00');
    const monthsToDeadline =
      (deadline.getFullYear() - from.getFullYear()) * 12
      + (deadline.getMonth() - from.getMonth()) + 1;
    expect(goal.capacity).toBeCloseTo(NEED, 2);
    expect(monthsAtPace).toBeLessThanOrEqual(monthsToDeadline);
    // And the card is not starved to pay for it: it still takes the larger half today.
    const r = allocateRankedSurplus(POOL, targets);
    expect(extraOf(r, 'prime')).toBeGreaterThan(extraOf(r, 'move'));
  });

  it('SELF-LIMITING: once the card is paid off the goal keeps its pace and the rest falls THROUGH', () => {
    // His "doesn't truly need to pay more than that". A time-based ramp would keep back-loading
    // long after the card is gone; this does not, because the weighting was never about time.
    const targets = hisSplit('2027-07-01').map(t =>
      (t.id === 'prime' ? { ...t, capacity: 0, minimum: 0 } : t));
    const pace = targets.find(t => t.id === 'move')!.maxExtra!;
    const r = allocateRankedSurplus(POOL, [...targets, {
      id: 'below', kind: 'goal' as const, sortOrder: 9, minimum: 0, capacity: 9_000,
    }]);
    expect(extraOf(r, 'prime')).toBe(0);
    expect(extraOf(r, 'move')).toBeCloseTo(pace, 2);
    expect(extraOf(r, 'below')).toBeCloseTo(rankedPool(targets) - pace, 2);
    expect(r.unallocated).toBeCloseTo(0, 2);
  });
});
