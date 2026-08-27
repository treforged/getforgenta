// The ranked "where the extra money goes" list, as the UI drags it.
//
// The load-bearing claims: the card block is a ROW in the list (without one the user cannot say
// "this goal matters more than my debt"), a reorder produces DENSE ranks so the engine's fractional
// card seating can never collide with a user rank, and a save sends only what actually changed.

import { describe, it, expect } from 'vitest';
import {
  CARDS_ROW_ID, buildSurplusRankRows, compareSurplusRankRows, isSurplusRankWritesEmpty,
  moveSurplusRankRow, moveSurplusRankRowBy, planSurplusRankWrites, setSurplusRankAutoExtra,
  type SurplusRankRow,
} from '@/lib/surplus-ranking';
import type { CarFund } from '@/lib/types';

const goal = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'g1', name: 'Emergency Fund', sort_order: 0, auto_extra: false,
  target_amount: 10000, current_amount: 2500, created_at: '2026-01-01T00:00:00Z',
  ...over,
}) as Parameters<typeof buildSurplusRankRows>[0]['goals'][number];

const carFund = (over: Partial<CarFund> = {}): CarFund => ({
  id: 'c1', user_id: 'u1', vehicle_name: 'GR86',
  target_price: 30000, tax_fees: 0, down_payment_goal: 6000, current_saved: 1000,
  saved_source: 'fixed', saved_percent: 0, monthly_insurance: 0, expected_apr: 6,
  loan_term_months: 60, phase: 'saving', loan_amount: 0,
  loan_start_date: null, payment_start_date: null, interest_start_date: null,
  insurance_start_date: null, actual_monthly_payment: 0,
  linked_account: null, linked_rule_id: null,
  sort_order: 0, auto_extra: false, created_at: '2026-02-01T00:00:00Z',
  ...over,
} as unknown as CarFund);

describe('buildSurplusRankRows', () => {
  it('puts the credit cards IN the list, as one row', () => {
    const rows = buildSurplusRankRows({ goals: [goal()], carFunds: [carFund()] });
    const cards = rows.filter(r => r.kind === 'cards');
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(CARDS_ROW_ID);
    expect(rows.map(r => r.id)).toEqual([CARDS_ROW_ID, 'g1', 'c1']);
  });

  it('honours cards_sort_order, so a ranked goal shows ABOVE the debt', () => {
    const rows = buildSurplusRankRows({
      goals: [goal({ sort_order: 0 })],
      carFunds: [],
      cardsSortOrder: 1,
    });
    expect(rows.map(r => r.id)).toEqual(['g1', CARDS_ROW_ID]);
  });

  it('gives the cards a tie, matching the half-rank the allocator seats them at', () => {
    const rows = buildSurplusRankRows({ goals: [goal({ sort_order: 2 })], carFunds: [], cardsSortOrder: 2 });
    expect(rows[0].id).toBe(CARDS_ROW_ID);
  });

  it('still gives the cards the tie when the other row has no created_at to lose on', () => {
    // `useSavingsGoals` returns PARTIAL rows, so `created_at` really can be absent. Without the
    // kind branch in the comparator this falls through to an id compare, and "arbitrary" is not an
    // acceptable way to decide whether the debt or a goal gets the money.
    const rows = buildSurplusRankRows({
      goals: [goal({ id: '0000-goal', sort_order: 2, created_at: undefined })],
      carFunds: [], cardsSortOrder: 2,
    });
    expect(rows.map(r => r.id)).toEqual([CARDS_ROW_ID, '0000-goal']);
  });

  it('breaks a tie between two goals on created_at, the order both list queries actually use', () => {
    const rows = buildSurplusRankRows({
      goals: [
        goal({ id: 'late', sort_order: 0, created_at: '2026-05-01T00:00:00Z' }),
        goal({ id: 'early', sort_order: 0, created_at: '2026-03-01T00:00:00Z' }),
      ],
      carFunds: [],
      cardsSortOrder: 5,
    });
    expect(rows.map(r => r.id)).toEqual(['early', 'late', CARDS_ROW_ID]);
  });

  it('reports each row\'s remaining need, and no figure at all for the cards', () => {
    const rows = buildSurplusRankRows({ goals: [goal()], carFunds: [carFund()] });
    expect(rows.find(r => r.id === 'g1')?.remaining).toBe(7500);
    expect(rows.find(r => r.id === 'c1')?.remaining).toBe(5000);
    expect(rows.find(r => r.id === CARDS_ROW_ID)?.remaining).toBeNull();
  });

  it('never claims a row is opted in when the column is absent — auto_extra defaults FALSE', () => {
    const rows = buildSurplusRankRows({ goals: [goal({ auto_extra: undefined })], carFunds: [] });
    expect(rows.find(r => r.id === 'g1')?.autoExtra).toBe(false);
    expect(rows.find(r => r.id === CARDS_ROW_ID)?.autoExtra).toBe(true);
  });

  it('lists a LOAN-phase vehicle as a LOAN row — extra principal, not a down payment', () => {
    // Before 2026-08-21 it was left out entirely: `carFundRemainingNeed` gives a loan-phase fund 0,
    // so it could never take a ranked dollar and listing it would have printed "Fully funded"
    // beside a car the user still owes on. It now has its own kind and its own capacity.
    const rows = buildSurplusRankRows({
      goals: [], carFunds: [carFund({ phase: 'loan', loan_amount: 24000 })],
    });
    expect(rows.map(r => r.id)).toEqual([CARDS_ROW_ID, 'c1']);
    const loan = rows.find(r => r.id === 'c1')!;
    expect(loan.kind).toBe('loan');
    expect(loan.remaining).toBe(24000);
    expect(loan.targetAmount).toBeNull();
    expect(loan.targetDate).toBeNull();
  });

  it('names an untitled row rather than rendering an empty line', () => {
    const rows = buildSurplusRankRows({ goals: [goal({ name: '  ' })], carFunds: [carFund({ vehicle_name: '' })] });
    expect(rows.find(r => r.id === 'g1')?.name).toBe('Untitled goal');
    expect(rows.find(r => r.id === 'c1')?.name).toBe('Vehicle');
  });
});

describe('moveSurplusRankRow', () => {
  const rows = buildSurplusRankRows({
    goals: [goal({ id: 'g1' }), goal({ id: 'g2', created_at: '2026-04-01T00:00:00Z' })],
    carFunds: [],
  });

  it('drops the dragged row at the target position', () => {
    const next = moveSurplusRankRow(rows, 'g2', CARDS_ROW_ID);
    expect(next.map(r => r.id)).toEqual(['g2', CARDS_ROW_ID, 'g1']);
  });

  it('re-indexes DENSELY, so a user rank can never collide with the allocator\'s half-rank', () => {
    const next = moveSurplusRankRow(rows, 'g2', CARDS_ROW_ID);
    expect(next.map(r => r.sortOrder)).toEqual([0, 1, 2]);
  });

  it('does not mutate the list it was given', () => {
    const before = rows.map(r => r.id);
    moveSurplusRankRow(rows, 'g2', CARDS_ROW_ID);
    expect(rows.map(r => r.id)).toEqual(before);
  });

  it('densifies but does not reorder on an unknown id or a no-op move', () => {
    expect(moveSurplusRankRow(rows, 'nope', 'g1').map(r => r.id)).toEqual(rows.map(r => r.id));
    expect(moveSurplusRankRow(rows, 'g1', 'g1').map(r => r.id)).toEqual(rows.map(r => r.id));
  });

  it('moves one place at a time for touch, and refuses to walk off either end', () => {
    expect(moveSurplusRankRowBy(rows, 'g1', -1).map(r => r.id)).toEqual(['g1', CARDS_ROW_ID, 'g2']);
    expect(moveSurplusRankRowBy(rows, CARDS_ROW_ID, -1).map(r => r.id)).toEqual(rows.map(r => r.id));
    expect(moveSurplusRankRowBy(rows, 'g2', 1).map(r => r.id)).toEqual(rows.map(r => r.id));
  });
});

describe('setSurplusRankAutoExtra', () => {
  const rows = buildSurplusRankRows({ goals: [goal()], carFunds: [] });

  it('opts a goal in', () => {
    expect(setSurplusRankAutoExtra(rows, 'g1', true).find(r => r.id === 'g1')?.autoExtra).toBe(true);
  });

  it('refuses to opt the CARDS out — there is no switching the debt off', () => {
    const next = setSurplusRankAutoExtra(rows, CARDS_ROW_ID, false);
    expect(next.find(r => r.id === CARDS_ROW_ID)?.autoExtra).toBe(true);
  });

  // 20260826_auto_extra_auto_cleared.sql: `autoExtraAutoCleared` records whether the CURRENT
  // `autoExtra` value was placed there by the waterfall's auto-deselect rather than by the user.
  // The moment a person touches the switch by hand, that stops being true.
  it('clears autoExtraAutoCleared on a manual re-select, whatever it was before', () => {
    const cleared = buildSurplusRankRows({
      goals: [goal({ auto_extra: false, auto_extra_auto_cleared: true })], carFunds: [],
    });
    const next = setSurplusRankAutoExtra(cleared, 'g1', true);
    expect(next.find(r => r.id === 'g1')).toMatchObject({ autoExtra: true, autoExtraAutoCleared: false });
  });

  it('clears autoExtraAutoCleared on a manual deselect too — the false is now the user\'s, not the guard\'s', () => {
    const cleared = buildSurplusRankRows({
      goals: [goal({ auto_extra: true, auto_extra_auto_cleared: true })], carFunds: [],
    });
    const next = setSurplusRankAutoExtra(cleared, 'g1', false);
    expect(next.find(r => r.id === 'g1')).toMatchObject({ autoExtra: false, autoExtraAutoCleared: false });
  });

  it('never touches anything else on the row — the ranks and targets a dollar figure depends on', () => {
    const goalRows = buildSurplusRankRows({
      goals: [goal({ sort_order: 3, target_amount: 9000, current_amount: 1000, surplus_share: 40 })],
      carFunds: [],
    });
    const before = goalRows.find(r => r.id === 'g1')!;
    const after = setSurplusRankAutoExtra(goalRows, 'g1', true).find(r => r.id === 'g1')!;
    expect(after.sortOrder).toBe(before.sortOrder);
    expect(after.remaining).toBe(before.remaining);
    expect(after.targetAmount).toBe(before.targetAmount);
    expect(after.share).toBe(before.share);
  });
});

describe('planSurplusRankWrites', () => {
  // Already dense — the state any list is in after its first drag, and the only one in which
  // "only what changed" means anything. A list of all-zero ranks straight out of the DB is not
  // dense, so its first save legitimately rewrites every row.
  const before = buildSurplusRankRows({
    goals: [goal({ id: 'g1', sort_order: 1 }), goal({ id: 'g2', sort_order: 3, created_at: '2026-04-01T00:00:00Z' })],
    carFunds: [carFund({ sort_order: 2 })],
    cardsSortOrder: 0,
  });

  it('sends nothing at all when nothing changed', () => {
    const writes = planSurplusRankWrites(before, before);
    expect(isSurplusRankWritesEmpty(writes)).toBe(true);
  });

  it('routes each moved row to its own table, and the card row to the profile', () => {
    const after = moveSurplusRankRow(before, 'g2', CARDS_ROW_ID);
    const writes = planSurplusRankWrites(before, after);
    expect(writes.cardsSortOrder).toBe(1);
    expect(writes.goals).toEqual([
      { id: 'g2', sort_order: 0 },
      { id: 'g1', sort_order: 2 },
    ]);
    expect(writes.carFunds).toEqual([{ id: 'c1', sort_order: 3 }]);
  });

  it('sends only what changed — an untouched row costs no round trip', () => {
    // Swapping the last two leaves the cards row and the first goal exactly where they were.
    const after = moveSurplusRankRowBy(before, 'g2', -1);
    const writes = planSurplusRankWrites(before, after);
    expect(writes.cardsSortOrder).toBeNull();
    expect(writes.goals).toEqual([{ id: 'g2', sort_order: 2 }]);
    expect(writes.carFunds).toEqual([{ id: 'c1', sort_order: 3 }]);
  });

  it('carries an auto_extra toggle without touching the ranks', () => {
    const after = setSurplusRankAutoExtra(before, 'g1', true);
    const writes = planSurplusRankWrites(before, after);
    // `lump_sum_payments: []` rides along on the turning-ON edge from 2026-08-26: automatic and
    // manual extra against one target are two answers to the same question, so opting in clears the
    // hand-typed ones (Tre's instruction, and he confirmed the removal is intended).
    expect(writes.goals).toEqual([{ id: 'g1', auto_extra: true, lump_sum_payments: [] }]);
    expect(writes.carFunds).toEqual([]);
    expect(writes.cardsSortOrder).toBeNull();
  });

  // 20260826_auto_extra_auto_cleared.sql, brief bullet 2: "clear it when the user manually
  // re-selects". `g1` here stands in for a row the waterfall already switched off — its LIVE
  // `auto_extra_auto_cleared` reads true, exactly what a reload would hand back from the DB.
  it('clears the persisted auto_extra_auto_cleared flag when the user manually re-selects a row the waterfall had switched off', () => {
    const waterfallCleared = buildSurplusRankRows({
      goals: [
        goal({ id: 'g1', sort_order: 1, auto_extra: false, auto_extra_auto_cleared: true }),
        goal({ id: 'g2', sort_order: 3, created_at: '2026-04-01T00:00:00Z' }),
      ],
      carFunds: [carFund({ sort_order: 2 })],
      cardsSortOrder: 0,
    });
    const reselected = setSurplusRankAutoExtra(waterfallCleared, 'g1', true);
    const writes = planSurplusRankWrites(waterfallCleared, reselected);
    expect(writes.goals).toEqual([
      { id: 'g1', auto_extra: true, auto_extra_auto_cleared: false, lump_sum_payments: [] },
    ]);
    // ⚠️ THE OLD INVARIANT HERE WAS "nothing in this write is an amount", and it was deliberate.
    // It changed on 2026-08-26 on Tre's explicit instruction: turning auto extra ON now also clears
    // the target's hand-typed lump sums, because automatic and manual extra against one target
    // fund it twice. That is still not a dollar FIGURE moving, but it does remove planned money,
    // so the key-set assertion below is kept precisely to make any FURTHER field added to this
    // path a deliberate decision rather than an accident.
    expect(writes.carFunds).toEqual([]);
    expect(writes.cardsSortOrder).toBeNull();
    expect(Object.keys(writes.goals[0]).sort())
      .toEqual(['auto_extra', 'auto_extra_auto_cleared', 'id', 'lump_sum_payments'].sort());
  });

  it('does NOT re-clear the flag on a no-op resend of the same auto_extra value', () => {
    // A row already re-selected (auto_extra_auto_cleared already false) that gets the SAME
    // `setSurplusRankAutoExtra(true)` call again diffs to nothing — proof this is a real diff,
    // not a blind "always include the field" write.
    const already = buildSurplusRankRows({
      goals: [goal({ id: 'g1', auto_extra: true, auto_extra_auto_cleared: false })],
      carFunds: [],
    });
    const after = setSurplusRankAutoExtra(already, 'g1', true);
    expect(isSurplusRankWritesEmpty(planSurplusRankWrites(already, after))).toBe(true);
  });

  it('ignores a row that is not in both lists — this plans an edit, not a sync', () => {
    const after: SurplusRankRow[] = [
      ...before,
      { id: 'new', kind: 'goal', name: 'New', sortOrder: 9, autoExtra: true, remaining: 1, share: null, targetAmount: null, targetDate: null, createdAt: '' },
    ];
    expect(isSurplusRankWritesEmpty(planSurplusRankWrites(before, after))).toBe(true);
  });
});

describe('compareSurplusRankRows', () => {
  it('is a total order — equal rows compare equal', () => {
    const row: SurplusRankRow = {
      id: 'g1', kind: 'goal', name: 'A', sortOrder: 0, autoExtra: false, remaining: 0,
      share: null, targetAmount: null, targetDate: null, createdAt: '',
    };
    expect(compareSurplusRankRows(row, { ...row })).toBe(0);
  });
});
