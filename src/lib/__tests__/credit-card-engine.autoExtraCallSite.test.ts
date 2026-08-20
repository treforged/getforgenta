import { describe, it, expect } from 'vitest';
import { getMonthlyDebtBreakdown } from '../credit-card-engine';
import { buildRankedTargets } from '../ranked-extra-payment-targets';
import type { AccountRow } from '@/hooks/useSupabaseData';
import type { CardData } from '../credit-card-engine';

/**
 * The CALL SITE, not the allocator.
 *
 * `ranked-surplus-allocation.test.ts` proves the arithmetic and
 * `credit-card-engine.autoExtraTargets.test.ts` proves the engine honours a reserve. Neither
 * proves the wrapper the app actually calls can carry one: until this slice,
 * `getMonthlyDebtBreakdown` had no way to pass targets down at all, so the feature was inert by
 * construction no matter what the user opted in to. These tests fail against that older signature.
 */

function makeAccount(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: 'acct', user_id: 'test', name: 'Acct', account_type: 'credit_card', balance: 0,
    credit_limit: 5000, apr: 20, payment_due_day: 15, active: true,
    min_payment: null, payment_preference: null,
    ...overrides,
  };
}

const accounts: AccountRow[] = [
  makeAccount({ id: 'chk', name: 'TOTAL CHECKING', account_type: 'checking', balance: 3000, credit_limit: 0, apr: 0 }),
  // Cash-bound on purpose: available cash, not the balance, caps the recommendation, so any
  // dollar reserved for a goal has to come off the recommended payment.
  makeAccount({ id: 'card', name: 'Discover', account_type: 'credit_card', balance: 10000, apr: 25, min_payment: 200 }),
];
const profile = { cash_floor: 500 } as never;

/** A card row shaped as `buildRankedTargets` reads it — the engine builds its own from `accounts`. */
const card = { id: 'card', minPayment: 200, balance: 10000, autopayFullBalance: false } as CardData;

const targetsFor = (goals: Parameters<typeof buildRankedTargets>[0]['goals']) =>
  buildRankedTargets({ cards: [card], carFunds: [], goals, strategy: 'avalanche', asOf: '2026-08-19' });

const run = (targets?: ReturnType<typeof buildRankedTargets>, cardsSortOrder?: number) =>
  getMonthlyDebtBreakdown(
    accounts, [], [], [], profile, 0, undefined, undefined, 0, undefined,
    targets ? { targets, cardsSortOrder } : undefined,
  );

describe('getMonthlyDebtBreakdown — ranked automatic extra payments reach the engine', () => {
  it('an opted-in goal ranked ahead of the cards takes its need out of the recommendation', () => {
    const base = run();
    const withGoal = run(targetsFor([
      { id: 'goal-1', sort_order: -1, auto_extra: true, target_amount: 900, current_amount: 500 },
    ]));

    // Capacity is 900 - 500 = 400, and the goal outranks the card block, so exactly $400 is held back.
    expect(base.totalRecommended - withGoal.totalRecommended).toBeCloseTo(400, 2);
    // The reserve comes out of the SURPLUS, never the minimum — the card is still fully covered.
    expect(withGoal.totalRecommended).toBeGreaterThanOrEqual(withGoal.totalMinimumsDue);
    expect(withGoal.cashWarning).toBe(false);
  });

  it('a goal that has not opted in changes nothing', () => {
    const base = run();
    const optedOut = run(targetsFor([
      { id: 'goal-1', sort_order: -1, auto_extra: false, target_amount: 900, current_amount: 500 },
    ]));
    expect(optedOut.totalRecommended).toBe(base.totalRecommended);
  });

  it('a partial row with no auto_extra column is treated as opted OUT, not opted in', () => {
    // The allocator reads an OMITTED `autoExtra` as opted in. The app's data layer hands back
    // partial rows, so a bare pass-through here would divert surplus for every existing user.
    const base = run();
    const partial = run(targetsFor([{ id: 'goal-1', target_amount: 900, current_amount: 500 }]));
    expect(partial.totalRecommended).toBe(base.totalRecommended);
  });

  it('a full goal hands its share straight back to the cards', () => {
    const base = run();
    const full = run(targetsFor([
      { id: 'goal-1', sort_order: -1, auto_extra: true, target_amount: 500, current_amount: 500 },
    ]));
    expect(full.totalRecommended).toBe(base.totalRecommended);
  });

  it('omitting the context leaves the breakdown byte-identical', () => {
    expect(run()).toEqual(run(targetsFor([])));
  });

  it('honours the rank of the card block itself — `profiles.cards_sort_order`', () => {
    // A goal at rank 0 against cards at rank 0: the card block is seated half a rank ahead so the
    // tie goes to the debt, which is the pre-column behaviour and the conservative default.
    const goals = [{ id: 'goal-1', sort_order: 0, auto_extra: true, target_amount: 900, current_amount: 500 }];
    const base = run();
    const cardsFirst = run(targetsFor(goals), 0);
    expect(cardsFirst.totalRecommended).toBe(base.totalRecommended);

    // Same data, one number different: the user has dragged the card row BELOW the goal.
    const cardsLast = run(targetsFor(goals), 5);
    expect(base.totalRecommended - cardsLast.totalRecommended).toBeCloseTo(400, 2);
    // Rank moves the surplus, never the obligation.
    expect(cardsLast.totalRecommended).toBeGreaterThanOrEqual(cardsLast.totalMinimumsDue);
    expect(cardsLast.cashWarning).toBe(false);
  });

  it('an omitted cardsSortOrder is exactly a 0', () => {
    const goals = [{ id: 'goal-1', sort_order: -1, auto_extra: true, target_amount: 900, current_amount: 500 }];
    expect(run(targetsFor(goals))).toEqual(run(targetsFor(goals), 0));
  });
});
