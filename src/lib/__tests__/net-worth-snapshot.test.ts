// Drafted by groq gpt-oss-120b, reviewed by Ada 2026-10-07: dates made LOCAL (the code reads snapshot_date as local midnight).
// Assumption: NetWorthTotals has fields totalAssets and totalLiabilities of type number
import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_INTERVAL_DAYS,
  hasRecordableData,
  shouldRecordSnapshot,
} from '../net-worth-snapshot';

describe('hasRecordableData', () => {
  it('returns false when both assets and liabilities are zero', () => {
    const totals = { totalAssets: 0, totalLiabilities: 0 } as unknown as Parameters<typeof hasRecordableData>[0];
    expect(hasRecordableData(totals)).toBe(false);
  });

  it('returns true when assets are non‑zero and liabilities are zero', () => {
    const totals = { totalAssets: 12345, totalLiabilities: 0 } as unknown as Parameters<typeof hasRecordableData>[0];
    expect(hasRecordableData(totals)).toBe(true);
  });

  it('returns true when assets are zero and liabilities are non‑zero', () => {
    const totals = { totalAssets: 0, totalLiabilities: 9876 } as unknown as Parameters<typeof hasRecordableData>[0];
    expect(hasRecordableData(totals)).toBe(true);
  });

  it('returns true when both assets and liabilities are non‑zero', () => {
    const totals = { totalAssets: 5000, totalLiabilities: 3000 } as unknown as Parameters<typeof hasRecordableData>[0];
    expect(hasRecordableData(totals)).toBe(true);
  });
});

describe('shouldRecordSnapshot', () => {
  const MS_PER_DAY = 86_400_000;

  it('returns true when there are no snapshots', () => {
    expect(shouldRecordSnapshot([])).toBe(true);
  });

  it('returns true when all snapshot dates are invalid', () => {
    const snapshots = [
      { snapshot_date: 'not-a-date' },
      { snapshot_date: '' },
    ] as const;
    expect(shouldRecordSnapshot(snapshots)).toBe(true);
  });

  it('returns true when the newest valid snapshot is older than the interval', () => {
    const now = new Date('2026-01-15T12:00:00');
    const snapshots = [
      { snapshot_date: '2025-12-31' }, // 15 days before now
      { snapshot_date: '2025-12-25' }, // older
    ] as const;
    expect(shouldRecordSnapshot(snapshots, now)).toBe(true);
  });

  it('returns false when the newest valid snapshot is within the interval', () => {
    const now = new Date('2026-01-10T08:00:00');
    const snapshots = [
      { snapshot_date: '2026-01-05' }, // 5 days before now
    ] as const;
    expect(shouldRecordSnapshot(snapshots, now)).toBe(false);
  });

  it('correctly picks the newest date regardless of order', () => {
    const now = new Date('2026-02-01T00:00:00');
    const snapshots = [
      { snapshot_date: '2026-01-20' }, // 12 days old
      { snapshot_date: '2026-01-25' }, // 7 days old (exact threshold)
      { snapshot_date: '2026-01-10' }, // older
    ] as const;
    // newest is 2026-01-25, diff = 7 days -> should record (>= interval)
    expect(shouldRecordSnapshot(snapshots, now)).toBe(true);
  });

  it('ignores invalid dates when determining the newest snapshot', () => {
    const now = new Date('2026-03-01T00:00:00');
    const snapshots = [
      { snapshot_date: 'invalid-date' },
      { snapshot_date: '2026-02-20' }, // 9 days old
    ] as const;
    expect(shouldRecordSnapshot(snapshots, now)).toBe(true);
  });

  it('uses the constant SNAPSHOT_INTERVAL_DAYS for calculation', () => {
    const now = new Date('2026-04-10T00:00:00');
    const snapshots = [
      { snapshot_date: '2026-04-04' }, // 6 days old
    ] as const;
    const expected = Math.floor((now.getTime() - new Date('2026-04-04T00:00:00').getTime()) / MS_PER_DAY) >= SNAPSHOT_INTERVAL_DAYS;
    expect(shouldRecordSnapshot(snapshots, now)).toBe(expected);
  });
});

describe('review additions (mutants that survived the draft)', () => {
  it('uses the newest date even when it is FIRST in the list', () => {
    const now = new Date('2026-02-01T00:00:00');
    // Newest (3 days old) first, an old one last: trusting the last row would say "record".
    expect(shouldRecordSnapshot([{ snapshot_date: '2026-01-29' }, { snapshot_date: '2025-12-01' }], now)).toBe(false);
  });

  it('a liabilities-only balance is recordable data', () => {
    expect(hasRecordableData({ totalAssets: 0, totalLiabilities: 500 } as unknown as Parameters<typeof hasRecordableData>[0])).toBe(true);
  });
});
