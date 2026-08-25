// Student loans / mortgages as rows in "where the extra money goes".
//
// The rule under test is the OPT-IN, and it is unusual: `accounts` has no `auto_extra` column, so
// a non-null `surplus_sort_order` is both "this is its rank" and "this is opted in". Every user
// today has null there, which is why none of this changes an existing list — and it is why the
// auto-extra toggle has to refuse a liability rather than move a switch with nowhere to save it.
//
// Would-fail check: drop the `surplus_sort_order != null` filter in `buildSurplusRankRows` and
// case 2 lists a liability nobody ranked; route `kind: 'liability'` through the `car_funds`
// fallback in `planSurplusRankWrites` / `planCardSeparationWrites` and cases 4 and 6 write a
// `sort_order` to a `car_funds` row that does not exist.

import { describe, it, expect } from 'vitest';
import {
  buildSurplusRankRows, moveSurplusRankRow, planCardSeparationWrites, planLiabilityRankWrites,
  planSurplusRankWrites, setSurplusRankAutoExtra,
} from '@/lib/surplus-ranking';
import type { RankableLiability } from '@/lib/ranked-extra-payment-targets';
import type { CarFund } from '@/lib/types';

const liability = (over: Partial<RankableLiability> = {}): RankableLiability => ({
  id: 'sl-1',
  name: 'Student Loan',
  account_type: 'student_loan',
  balance: 12000,
  surplus_sort_order: 1,
  surplus_share: null,
  created_at: '2026-01-01',
  ...over,
});

const goal = (over: Record<string, unknown> = {}) => ({
  id: 'g-1', name: 'Move Fund', sort_order: 0, auto_extra: true,
  target_amount: 5000, current_amount: 1000, created_at: '2026-01-01', ...over,
});

const build = (liabilities: RankableLiability[], goals: ReturnType<typeof goal>[] = []) =>
  buildSurplusRankRows({ goals, carFunds: [] as CarFund[], liabilities });

/** The credit-card BLOCK row is always present (no `cards` argument means none has been pulled
 *  out of it), and it is not what any of this is about. */
const withoutCardsBlock = (rows: ReturnType<typeof build>) => rows.filter(r => r.kind !== 'cards');

describe('buildSurplusRankRows — non-CC liability rows', () => {
  it('lists a ranked liability, ordered by accounts.surplus_sort_order', () => {
    const rows = build(
      [liability({ id: 'mtg', name: 'Home Loan', account_type: 'mortgage', balance: 250000, surplus_sort_order: 0 }),
        liability({ id: 'sl', surplus_sort_order: 2 })],
      [goal({ sort_order: 1 })],
    );
    expect(withoutCardsBlock(rows).map(r => [r.id, r.kind, r.sortOrder]))
      .toEqual([['mtg', 'liability', 0], ['g-1', 'goal', 1], ['sl', 'liability', 2]]);
  });

  it('omits a liability the user has not ranked — a null sort order is not an opt-in', () => {
    expect(withoutCardsBlock(build([liability({ surplus_sort_order: null })]))).toEqual([]);
    expect(withoutCardsBlock(build([liability({ surplus_sort_order: undefined })]))).toEqual([]);
  });

  it('carries the balance as remaining, and no target amount or date', () => {
    const [row] = withoutCardsBlock(build([liability({ surplus_sort_order: 0 })]));
    expect(row.remaining).toBe(12000);
    expect(row.targetAmount).toBeNull();
    expect(row.targetDate).toBeNull();
    // Being in the list IS the opt-in; there is no column that could say otherwise.
    expect(row.autoExtra).toBe(true);
  });

  it('reads a stored split weight, and rejects a zero one', () => {
    const shareOf = (l: RankableLiability) => withoutCardsBlock(build([l]))[0].share;
    expect(shareOf(liability({ surplus_sort_order: 0, surplus_share: 70 }))).toBe(70);
    expect(shareOf(liability({ surplus_sort_order: 0, surplus_share: 0 }))).toBeNull();
  });
});

describe('surplus-ranking writes — a liability is an accounts row', () => {
  it('plans a moved liability onto the accounts channel, never onto car_funds', () => {
    // Cards block at 0, goal at 1, liability at 2. Dragging the liability above the goal swaps
    // the two, which is a write to `accounts` and a write to `savings_goals` and nothing else.
    const before = build([liability({ id: 'sl', surplus_sort_order: 2 })], [goal({ sort_order: 1 })]);
    const after = moveSurplusRankRow(before, 'sl', 'g-1');
    const writes = planSurplusRankWrites(before, after);
    expect(writes.cards).toEqual([{ id: 'sl', surplus_sort_order: 1 }]);
    expect(writes.carFunds).toEqual([]);
    expect(writes.goals).toEqual([{ id: 'g-1', sort_order: 2 }]);
  });

  it('refuses to move a liability auto-extra toggle there is no column to store', () => {
    const rows = build([liability({ surplus_sort_order: 1 })]);
    const toggled = setSurplusRankAutoExtra(rows, 'sl-1', false);
    expect(withoutCardsBlock(toggled)[0].autoExtra).toBe(true);
    // And therefore never plans a write that would be silently dropped.
    expect(planSurplusRankWrites(rows, toggled).cards).toEqual([]);
  });

  it('seats a newly-ranked liability at the END of the list, and clears the rank to remove it', () => {
    // Three ranks already in the list: the cards block, the liability, the goal.
    const rows = build([liability({ id: 'sl', surplus_sort_order: 1 })], [goal({ sort_order: 2 })]);
    expect(planLiabilityRankWrites(rows, 'mtg', true).cards)
      .toEqual([{ id: 'mtg', surplus_sort_order: 3, surplus_share: null }]);
    expect(planLiabilityRankWrites(rows, 'sl', false).cards)
      .toEqual([{ id: 'sl', surplus_sort_order: null, surplus_share: null }]);
  });

  it('bumps a liability through the accounts channel when a card is pulled out of the block', () => {
    const rows = buildSurplusRankRows({
      goals: [], carFunds: [] as CarFund[],
      cards: [{ id: 'cc-a' }, { id: 'cc-b' }],
      liabilities: [liability({ id: 'sl', surplus_sort_order: 1 })],
      cardsSortOrder: 0,
    });
    const writes = planCardSeparationWrites(rows, 'cc-a', true);
    expect(writes.cards).toEqual([
      { id: 'cc-a', surplus_sort_order: 1, surplus_share: null },
      { id: 'sl', surplus_sort_order: 2 },
    ]);
    expect(writes.carFunds).toEqual([]);
  });
});
