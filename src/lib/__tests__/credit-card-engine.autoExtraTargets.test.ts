import { describe, it, expect } from 'vitest';
import { generateRecommendations, type CardData } from '../credit-card-engine';
import type { RankedTarget } from '../ranked-surplus-allocation';

// Ranked automatic extra payments, slice (c) — the RESERVE wiring.
//
// The elaborate revolving cascade is deliberately untouched: the feature only decides how much of
// the pool belongs to opted-in goals and car funds before the cascade runs. The load-bearing claim
// of this file is the FIRST block — with the parameter omitted, or carrying only opted-out or full
// targets, the recommendation is IDENTICAL to before the feature existed. That is every existing
// user, since `auto_extra` defaults to false.

const makeCard = (o: Partial<CardData> = {}): CardData => ({
  id: 'c1', name: 'Visa', balance: 4_000, apr: 24, creditLimit: 10_000,
  minPayment: 100, minPaymentIsManual: true, targetPayment: 100,
  monthlyNewPurchases: 0, monthlyRepayments: 0, color: '#000',
  paymentPreference: null, autopayFullBalance: false, dueDay: 15,
  statementBalancePhase: false, statementBalance: null, ...o,
});

const goal = (id: string, sortOrder: number, capacity: number, autoExtra = true): RankedTarget =>
  ({ id, kind: 'goal', sortOrder, minimum: 0, capacity, autoExtra });

/** Scalar-expense path (no payConfig/rules/transactions), so the pool is fully determined here. */
const run = (targets?: readonly RankedTarget[], cards = [makeCard()]) =>
  generateRecommendations(
    cards, 6_000, 1_000, 'avalanche', 0, 0, 'variable',
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, 0, undefined, targets,
  );

describe('the pre-feature path is byte-identical', () => {
  it('omitting the parameter changes nothing', () => {
    const before = run(undefined);
    expect(before.autoExtra).toEqual({ reserved: 0, perTarget: [] });
    expect(run([])).toEqual(before);
  });

  it('an opted-out goal changes nothing', () => {
    expect(run([goal('g', 0, 10_000, false)])).toEqual(run(undefined));
  });

  it('a goal with nothing left to fund changes nothing', () => {
    expect(run([goal('done', 0, 0)])).toEqual(run(undefined));
  });

  it('a goal left at the default rank never outranks the cards', () => {
    // Rank 0 ties the card block, and the tie resolves in favour of the cards, so they fill to
    // their whole balance first. Only what they physically cannot absorb -- $5,000 pool against a
    // $4,000 balance -- reaches the goal, and that dollar was surplus before the feature existed.
    const r = run([goal('unranked', 0, 10_000)]);
    const base = run(undefined);
    const cardsPaid = r.recommendations.reduce((s2, x) => s2 + x.payment, 0);
    expect(cardsPaid).toBeCloseTo(base.recommendations.reduce((s2, x) => s2 + x.payment, 0), 2);
    expect(r.autoExtra.reserved).toBe(1_000);
  });
});

describe('an opted-in, ranked goal takes surplus and only surplus', () => {
  // The engine ranks the card block at 0, so a rank ABOVE the cards is a negative sort_order here;
  // the UI hands out explicit ranks for both rows.
  const ranked = (cap: number) => run([goal('vacation', -1, cap)]);

  it('reserves for the goal and shrinks the cards’ extra cash by exactly that much', () => {
    const base = run(undefined);
    const withGoal = ranked(500);
    expect(withGoal.autoExtra.reserved).toBe(500);
    expect(withGoal.autoExtra.perTarget).toEqual([{ id: 'vacation', kind: 'goal', amount: 500 }]);
    expect(withGoal.extraCashAvailable).toBeCloseTo(base.extraCashAvailable - 500, 2);
  });

  it('never starves the card minimum, at any pool size or goal size', () => {
    for (const cap of [1, 500, 10_000, 1e9]) {
      for (const cash of [1_000, 1_100, 1_500, 6_000, 50_000]) {
        const r = generateRecommendations(
          [makeCard()], cash, 1_000, 'avalanche', 0, 0, 'variable',
          undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, 0, undefined, [goal('greedy', -1, cap)],
        );
        // The claim that matters: however greedy the goal, the cards are still recommended at
        // least their minimum whenever the month's cash can cover it. `cashWarning` is the
        // engine's own signal that it could not, and it must not start firing because of a goal.
        const paid = r.recommendations.reduce((s2, x) => s2 + x.payment, 0);
        const withoutGoal = generateRecommendations(
          [makeCard()], cash, 1_000, 'avalanche', 0, 0, 'variable',
          undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, 0,
        );
        expect(r.cashWarning).toBe(withoutGoal.cashWarning);
        if (!r.cashWarning) expect(paid).toBeGreaterThanOrEqual(r.totalMinimumsdue - 0.005);
      }
    }
  });

  it('a full goal hands its share straight back to the cards', () => {
    const capped = run([goal('nearly', -1, 100)]);
    expect(capped.autoExtra.reserved).toBe(100);
    expect(capped.extraCashAvailable).toBeCloseTo(run(undefined).extraCashAvailable - 100, 2);
  });
});
