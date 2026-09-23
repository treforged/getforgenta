import { describe, it, expect } from 'vitest';
import { totalRevolvingMonth0, revolvingFillTarget, type SnapshotRevolvingRow } from '../revolving-snapshot';

describe('totalRevolvingMonth0', () => {
  it('returns null for null input', () => {
    expect(totalRevolvingMonth0(null)).toBeNull();
  });

  it('returns 0 for empty map', () => {
    expect(totalRevolvingMonth0(new Map<string, readonly number[]>())).toBe(0);
  });

  it('skips negative and non-finite values', () => {
    const map = new Map<string, readonly number[]>()
      .set('card1', [100])
      .set('card2', [NaN])
      .set('card3', [-50]);
    expect(totalRevolvingMonth0(map)).toBe(100);
  });

  it('rounds to cents', () => {
    const map = new Map<string, readonly number[]>().set('card1', [0.1 + 0.2]);
    expect(totalRevolvingMonth0(map)).toBe(0.3);
  });
});

describe('revolvingFillTarget', () => {
  it('returns null for null revolving', () => {
    expect(revolvingFillTarget([], null, '2023-10-05')).toBeNull();
  });

  it('returns null for negative revolving', () => {
    expect(revolvingFillTarget([], -100, '2023-10-05')).toBeNull();
  });

  it('returns null with no snapshots', () => {
    expect(revolvingFillTarget([], 100, '2023-10-05')).toBeNull();
  });

  it('finds newest snapshot in unsorted array', () => {
    const snapshots: SnapshotRevolvingRow[] = [
      { snapshot_date: '2023-09-30', revolving_balance: null },
      { snapshot_date: '2023-10-01', revolving_balance: null },
    ];
    expect(revolvingFillTarget(snapshots, 200, '2023-10-05')).toEqual({
      snapshot_date: '2023-10-01',
      revolving_balance: 200,
    });
  });

  it('returns null if snapshot already has value', () => {
    const snapshots: SnapshotRevolvingRow[] = [
      { snapshot_date: '2023-10-01', revolving_balance: 100 },
    ];
    expect(revolvingFillTarget(snapshots, 200, '2023-10-05')).toBeNull();
  });

  it('returns null for future-dated snapshot', () => {
    const snapshots: SnapshotRevolvingRow[] = [
      { snapshot_date: '2023-10-06', revolving_balance: null },
    ];
    expect(revolvingFillTarget(snapshots, 200, '2023-10-05')).toBeNull();
  });

  it('returns null for 8-day-old snapshot', () => {
    const snapshots: SnapshotRevolvingRow[] = [
      { snapshot_date: '2023-09-27', revolving_balance: null },
    ];
    expect(revolvingFillTarget(snapshots, 200, '2023-10-05')).toBeNull();
  });

  it('fills for 7-day-old snapshot', () => {
    const snapshots: SnapshotRevolvingRow[] = [
      { snapshot_date: '2023-09-28', revolving_balance: null },
    ];
    expect(revolvingFillTarget(snapshots, 200, '2023-10-05')).toEqual({
      snapshot_date: '2023-09-28',
      revolving_balance: 200,
    });
  });

  it('fills same day snapshot', () => {
    const snapshots: SnapshotRevolvingRow[] = [
      { snapshot_date: '2023-10-05', revolving_balance: null },
    ];
    expect(revolvingFillTarget(snapshots, 200, '2023-10-05')).toEqual({
      snapshot_date: '2023-10-05',
      revolving_balance: 200,
    });
  });

  it('fills with 0 value', () => {
    const snapshots: SnapshotRevolvingRow[] = [
      { snapshot_date: '2023-10-01', revolving_balance: null },
    ];
    expect(revolvingFillTarget(snapshots, 0, '2023-10-05')).toEqual({
      snapshot_date: '2023-10-01',
      revolving_balance: 0,
    });
  });
});

describe('revolvingFillTarget - reviewer additions', () => {
  it('never fills an older empty row when the newest is already filled', () => {
    const snapshots: SnapshotRevolvingRow[] = [
      { snapshot_date: '2023-10-04', revolving_balance: 150 },
      { snapshot_date: '2023-09-30', revolving_balance: null },
    ];
    expect(revolvingFillTarget(snapshots, 200, '2023-10-05')).toBeNull();
  });

  it('refuses a date that does not parse rather than filling it', () => {
    const snapshots: SnapshotRevolvingRow[] = [{ snapshot_date: 'not-a-date', revolving_balance: null }];
    expect(revolvingFillTarget(snapshots, 200, '2023-10-05')).toBeNull();
  });

  it('refuses a non-finite balance', () => {
    const snapshots: SnapshotRevolvingRow[] = [{ snapshot_date: '2023-10-05', revolving_balance: null }];
    expect(revolvingFillTarget(snapshots, Number.NaN, '2023-10-05')).toBeNull();
  });

  it('counts a negative month-0 card as zero and skips a card with no month 0', () => {
    const map = new Map<string, readonly number[]>().set('a', [-40]).set('b', []).set('c', [25.5]);
    expect(totalRevolvingMonth0(map)).toBe(25.5);
  });
});
