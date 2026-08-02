import { describe, it, expect } from 'vitest';
import {
  aggregateNetWorth,
  shouldRecordSnapshot,
  hasRecordableData,
  SNAPSHOT_INTERVAL_DAYS,
  type SnapshotAccount,
  type SnapshotManualAsset,
  type SnapshotManualLiability,
} from '@/lib/net-worth-snapshot';

const account = (over: Partial<SnapshotAccount> = {}): SnapshotAccount => ({
  name: 'Checking',
  account_type: 'checking',
  balance: 1000,
  active: true,
  ...over,
});

describe('aggregateNetWorth', () => {
  it('treats credit cards as liabilities and everything else as assets', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', account_type: 'checking', balance: 2000 }),
        account({ name: 'Brokerage', account_type: 'investment', balance: 5000 }),
        account({ name: 'Amex', account_type: 'credit_card', balance: 1500 }),
      ],
      [],
      [],
    );
    expect(totals).toEqual({ totalAssets: 7000, totalLiabilities: 1500, netWorth: 5500 });
  });

  it('ignores inactive accounts on both sides', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Old Savings', balance: 900, active: false }),
        account({ name: 'Closed Card', account_type: 'credit_card', balance: 400, active: false }),
        account({ name: 'Checking', balance: 100 }),
      ],
      [],
      [],
    );
    expect(totals).toEqual({ totalAssets: 100, totalLiabilities: 0, netWorth: 100 });
  });

  it('adds manual assets and liabilities to the live totals', () => {
    const totals = aggregateNetWorth(
      [account({ name: 'Checking', balance: 1000 })],
      [{ name: 'Car', value: 12000 }],
      [{ name: 'Student Loan', balance: 8000 }],
    );
    expect(totals).toEqual({ totalAssets: 13000, totalLiabilities: 8000, netWorth: 5000 });
  });

  it('drops manual rows whose name duplicates a live account, case-insensitively', () => {
    const totals = aggregateNetWorth(
      [
        account({ name: 'Checking', balance: 1000 }),
        account({ name: 'Amex', account_type: 'credit_card', balance: 500 }),
      ],
      [{ name: 'CHECKING', value: 999999 }],
      [{ name: 'amex', balance: 999999 }],
    );
    expect(totals).toEqual({ totalAssets: 1000, totalLiabilities: 500, netWorth: 1000 - 500 });
  });

  it('coerces string balances coming back from Postgres numerics', () => {
    const totals = aggregateNetWorth(
      [account({ name: 'Checking', balance: '1500.50' })],
      [{ name: 'Car', value: '2000.25' }],
      [{ name: 'Loan', balance: '500.75' }],
    );
    expect(totals.totalAssets).toBeCloseTo(3500.75, 6);
    expect(totals.totalLiabilities).toBeCloseTo(500.75, 6);
    expect(totals.netWorth).toBeCloseTo(3000, 6);
  });

  it('returns zeroes when there is nothing to aggregate', () => {
    expect(aggregateNetWorth([], [], [])).toEqual({
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    });
  });
});

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
