import { describe, it, expect } from 'vitest';
import {
  moveAccountTo, moveAccountBy, planAccountOrderWrites, nextAccountSortOrder,
} from '@/lib/account-order';

/** Checking → Savings → Visa → Mortgage → Brokerage, already densely ranked. */
const LIST = [
  { id: 'chk', sort_order: 0 },
  { id: 'sav', sort_order: 1 },
  { id: 'visa', sort_order: 2 },
  { id: 'mort', sort_order: 3 },
  { id: 'brk', sort_order: 4 },
];
const ids = (rows: readonly { id: string }[]) => rows.map(r => r.id);

describe('moveAccountTo', () => {
  it('drops a row above the one it landed on when moving up', () => {
    expect(ids(moveAccountTo(LIST, 'mort', 'sav'))).toEqual(['chk', 'mort', 'sav', 'visa', 'brk']);
  });

  it('drops a row below the one it landed on when moving down', () => {
    expect(ids(moveAccountTo(LIST, 'chk', 'visa'))).toEqual(['sav', 'visa', 'chk', 'mort', 'brk']);
  });

  it('leaves the list alone for an unknown id or a drop on itself', () => {
    expect(ids(moveAccountTo(LIST, 'ghost', 'sav'))).toEqual(ids(LIST));
    expect(ids(moveAccountTo(LIST, 'sav', 'ghost'))).toEqual(ids(LIST));
    expect(ids(moveAccountTo(LIST, 'sav', 'sav'))).toEqual(ids(LIST));
  });

  it('does not mutate its input', () => {
    const before = ids(LIST);
    moveAccountTo(LIST, 'brk', 'chk');
    expect(ids(LIST)).toEqual(before);
  });
});

describe('moveAccountBy — the filter is the whole point', () => {
  it('steps one place in an unfiltered list', () => {
    expect(ids(moveAccountBy(LIST, ids(LIST), 'visa', -1))).toEqual(['chk', 'visa', 'sav', 'mort', 'brk']);
    expect(ids(moveAccountBy(LIST, ids(LIST), 'visa', 1))).toEqual(['chk', 'sav', 'mort', 'visa', 'brk']);
  });

  it('moves past the previous VISIBLE row, and lands there in the FULL list', () => {
    // Liabilities only: visa, mort. One tap up on the mortgage must put it above the visa —
    // which in the unfiltered list means jumping the savings account too, not swapping neighbours.
    const visible = ['visa', 'mort'];
    expect(ids(moveAccountBy(LIST, visible, 'mort', -1))).toEqual(['chk', 'sav', 'mort', 'visa', 'brk']);
  });

  it('is a no-op at either end of the VISIBLE slice, even mid-list overall', () => {
    const visible = ['visa', 'mort'];
    expect(ids(moveAccountBy(LIST, visible, 'visa', -1))).toEqual(ids(LIST));
    expect(ids(moveAccountBy(LIST, visible, 'mort', 1))).toEqual(ids(LIST));
  });

  it('leaves the list alone for a row that is not visible', () => {
    expect(ids(moveAccountBy(LIST, ['visa', 'mort'], 'chk', 1))).toEqual(ids(LIST));
  });
});

describe('planAccountOrderWrites', () => {
  it('writes nothing when the order did not change', () => {
    expect(planAccountOrderWrites(LIST)).toEqual([]);
  });

  it('writes only the rows whose rank actually moved', () => {
    const next = moveAccountTo(LIST, 'sav', 'visa'); // chk, visa, sav, mort, brk
    expect(planAccountOrderWrites(next)).toEqual([
      { id: 'visa', sort_order: 1 },
      { id: 'sav', sort_order: 2 },
    ]);
  });

  it('writes a rank for every row that has never had one', () => {
    // `undefined` is not 0, and that is the right answer: a row with no stored rank is exactly
    // the row whose rank has to be written down.
    expect(planAccountOrderWrites([{ id: 'a' }, { id: 'b' }])).toEqual([
      { id: 'a', sort_order: 0 },
      { id: 'b', sort_order: 1 },
    ]);
  });
});

describe('nextAccountSortOrder', () => {
  it('seats a new account after everything that exists', () => {
    expect(nextAccountSortOrder(LIST)).toBe(5);
  });

  it('is 0 for the very first account', () => {
    expect(nextAccountSortOrder([])).toBe(0);
  });

  it('tolerates rows with no rank yet rather than writing a negative one', () => {
    expect(nextAccountSortOrder([{ id: 'a' }, { id: 'b', sort_order: 7 }])).toBe(8);
  });
});
