import { describe, it, expect } from 'vitest';
import {
  shouldRecordSnapshot,
  hasRecordableData,
  SNAPSHOT_INTERVAL_DAYS,
} from '@/lib/net-worth-snapshot';

// The aggregation itself moved to `src/lib/net-worth.ts`; see net-worth.test.ts.

describe('hasRecordableData', () => {
  it('is false only when both sides are zero', () => {
    expect(hasRecordableData({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 })).toBe(false);
    expect(hasRecordableData({ totalAssets: 10, totalLiabilities: 0, netWorth: 10 })).toBe(true);
    expect(hasRecordableData({ totalAssets: 0, totalLiabilities: 10, netWorth: -10 })).toBe(true);
  });
});

describe('shouldRecordSnapshot', () => {
  const now = new Date('2026-08-02T12:00:00Z');

  it('records when no snapshot has ever been taken', () => {
    expect(shouldRecordSnapshot([], now)).toBe(true);
  });

  it('does not record again within the interval', () => {
    expect(shouldRecordSnapshot([{ snapshot_date: '2026-07-30' }], now)).toBe(false);
  });

  it('records once the interval has fully elapsed', () => {
    expect(shouldRecordSnapshot([{ snapshot_date: '2026-07-26' }], now)).toBe(true);
  });

  it('uses the newest snapshot, not the array tail, when rows are unordered', () => {
    const rows = [{ snapshot_date: '2026-08-01' }, { snapshot_date: '2026-05-22' }];
    expect(shouldRecordSnapshot(rows, now)).toBe(false);
  });

  it('records again after the long gap that went unnoticed in production', () => {
    expect(shouldRecordSnapshot([{ snapshot_date: '2026-05-22' }], now)).toBe(true);
  });

  it('treats the boundary day itself as due', () => {
    const last = new Date(now.getTime() - SNAPSHOT_INTERVAL_DAYS * 86400000);
    const iso = last.toISOString().split('T')[0];
    expect(shouldRecordSnapshot([{ snapshot_date: iso }], now)).toBe(true);
  });
});
