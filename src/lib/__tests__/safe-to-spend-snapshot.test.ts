import { describe, it, expect } from 'vitest';
import { toSnapshotRow, shouldWrite, snapshotKey, REFRESH_MS } from '@/lib/safe-to-spend-snapshot';
import { shapeGlance, GLANCE_KEYS } from '../../../supabase/functions/money-glance/shape';
import type { SafeToSpendResult } from '@/lib/safe-to-spend';

const fig: SafeToSpendResult = {
  kind: 'figure', amount: 1408.31, lowPoint: 1408.31, lowDate: '2026-10-10', payday: '2026-10-02', floor: 0,
  horizon: '2026-10-31', cappedAfterPayday: true,
};
const now = new Date('2026-10-01T13:40:00Z');

describe('toSnapshotRow - what the dashboard publishes for Leo (1dc2c388)', () => {
  it("Tre's figure in cents, with the horizon and the client's own clock", () => {
    expect(toSnapshotRow(fig, 'u1', now)).toEqual({
      user_id: 'u1', amount_cents: 140831, payday: '2026-10-02', horizon: '2026-10-31',
      low_point_cents: 140831, low_date: '2026-10-10', floor_cents: 0, computed_at: '2026-10-01T13:40:00.000Z',
    });
  });

  it('a negative low point stays negative; the amount never does', () => {
    const r = toSnapshotRow({ ...fig, amount: 0, lowPoint: -914.57 }, 'u1', now)!;
    expect([r.amount_cents, r.low_point_cents]).toEqual([0, -91457]);
  });

  it('writes nothing for an empty result, no user, or a non-finite number', () => {
    expect(toSnapshotRow({ kind: 'empty', missing: 'no-payday' }, 'u1', now)).toBeNull();
    expect(toSnapshotRow(null, 'u1', now)).toBeNull();
    expect(toSnapshotRow(fig, undefined, now)).toBeNull();
    expect(toSnapshotRow({ ...fig, lowPoint: NaN }, 'u1', now)).toBeNull();
  });
});

describe('shouldWrite - a settled figure is written on a change or when stale', () => {
  const row = toSnapshotRow(fig, 'u1', now)!;
  const t = now.getTime();
  it('first write goes', () => expect(shouldWrite(row, null, t)).toBe(true));
  it('a changed figure goes at once, even 1 s after the last write (the settled figure must win)', () => {
    expect(shouldWrite(row, { key: 'other', at: t - 1000 }, t)).toBe(true);
  });
  it('the same figure waits until REFRESH_MS, then refreshes the age', () => {
    const key = snapshotKey(row);
    expect(shouldWrite(row, { key, at: t - REFRESH_MS + 1 }, t)).toBe(false);
    expect(shouldWrite(row, { key, at: t - REFRESH_MS }, t)).toBe(true);
  });
  it('no row, no write', () => expect(shouldWrite(null, null, t)).toBe(false));
});

describe('shapeGlance - the 7-key money-glance contract (Vera)', () => {
  const dbRow = {
    amount_cents: 140831, payday: '2026-10-02', horizon: '2026-10-31', low_point_cents: -500,
    low_date: '2026-10-10', floor_cents: 0, computed_at: '2026-10-01T09:40:00-04:00',
    user_id: 'u1', updated_at: '2026-10-01T13:40:00Z', secret_future_column: 'x',
  };

  it('returns EXACTLY the seven keys, computed_at as UTC ending in Z', () => {
    const g = shapeGlance(dbRow)!;
    expect(Object.keys(g).sort()).toEqual([...GLANCE_KEYS].sort());
    expect(g).toEqual({
      amount_cents: 140831, payday: '2026-10-02', horizon: '2026-10-31', low_point_cents: -500,
      low_date: '2026-10-10', floor_cents: 0, computed_at: '2026-10-01T13:40:00.000Z',
    });
  });

  it('a bigint that arrives as a string is still a number', () => {
    expect(shapeGlance({ ...dbRow, amount_cents: '140831' })?.amount_cents).toBe(140831);
  });

  it('malformed rows answer null (500), never a guess', () => {
    expect(shapeGlance({ ...dbRow, amount_cents: null })).toBeNull();
    expect(shapeGlance({ ...dbRow, low_point_cents: 'abc' })).toBeNull();
    expect(shapeGlance({ ...dbRow, payday: '10/02/2026' })).toBeNull();
    expect(shapeGlance({ ...dbRow, computed_at: 'not a date' })).toBeNull();
  });
});
