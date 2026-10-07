import { describe, it, expect } from 'vitest';
import type { DatedCashEvent } from '@/lib/safe-to-spend';
import {
  reservePendingDebits,
  PENDING_MATCH_DAYS_BEFORE,
  PENDING_MATCH_DAYS_AFTER,
  type PendingDebit,
} from '@/lib/safe-to-spend-pending';

function cloneEvents(events: readonly DatedCashEvent[]): DatedCashEvent[] {
  return JSON.parse(JSON.stringify(events));
}

describe('reservePendingDebits', () => {
  const chkSet = new Set(['chk']);

  it('a. counts two swipes on empty events', () => {
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-01', amount: 42.1, label: 'Swipe1' },
      { accountId: 'chk', date: '2026-10-01', amount: 7.9, label: 'Swipe2' },
    ];
    const result = reservePendingDebits(pending, [], chkSet);
    expect(result.reserve).toBe(50);
    expect(result.events).toHaveLength(0);
  });

  it('b. ignores rows from accounts not in the set', () => {
    const pending: PendingDebit[] = [
      { accountId: 'sav', date: '2026-10-01', amount: 10, label: 'SavSwipe' },
    ];
    const result = reservePendingDebits(pending, [], chkSet);
    expect(result.reserve).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('c. ignores pending deposits (negative amount)', () => {
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-01', amount: -100, label: 'Deposit' },
    ];
    const result = reservePendingDebits(pending, [], chkSet);
    expect(result.reserve).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('d. replaces matching out event within range', () => {
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-06', amount: 120, label: 'PhonePending' },
    ];
    const events: DatedCashEvent[] = [
      { date: '2026-10-08', amount: 120, direction: 'out', label: 'Phone' },
    ];
    const result = reservePendingDebits(pending, events, chkSet);
    expect(result.reserve).toBe(120);
    expect(result.events).toHaveLength(0);
    expect(result.items[0].replaces).toBe('Phone');
  });

  it('e. does not replace when event outside +10 days', () => {
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-06', amount: 120, label: 'PhonePending' },
    ];
    const events: DatedCashEvent[] = [
      { date: '2026-10-20', amount: 120, direction: 'out', label: 'Phone' },
    ];
    const result = reservePendingDebits(pending, events, chkSet);
    expect(result.reserve).toBe(120);
    expect(result.events).toHaveLength(1);
    expect(result.items[0].replaces).toBeNull();
  });

  it('f. does not replace an "in" event', () => {
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-06', amount: 120, label: 'IncomePending' },
    ];
    const events: DatedCashEvent[] = [
      { date: '2026-10-08', amount: 120, direction: 'in', label: 'Salary' },
    ];
    const result = reservePendingDebits(pending, events, chkSet);
    expect(result.reserve).toBe(120);
    expect(result.events).toHaveLength(1);
    expect(result.items[0].replaces).toBeNull();
  });

  it('g. two pendings replace only one matching out event', () => {
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-01', amount: 50, label: 'A' },
      { accountId: 'chk', date: '2026-10-02', amount: 50, label: 'B' },
    ];
    const events: DatedCashEvent[] = [
      { date: '2026-10-03', amount: 50, direction: 'out', label: 'SingleBill' },
    ];
    const result = reservePendingDebits(pending, events, chkSet);
    expect(result.reserve).toBe(100);
    expect(result.events).toHaveLength(0);
    // Only first pending should replace the bill
    expect(result.items[0].replaces).toBe('SingleBill');
    expect(result.items[1].replaces).toBeNull();
  });

  it('h. amount mismatch prevents replacement', () => {
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-06', amount: 120, label: 'PhonePending' },
    ];
    const events: DatedCashEvent[] = [
      { date: '2026-10-08', amount: 120.01, direction: 'out', label: 'Phone' },
    ];
    const result = reservePendingDebits(pending, events, chkSet);
    expect(result.reserve).toBe(120);
    expect(result.events).toHaveLength(1);
    expect(result.items[0].replaces).toBeNull();
  });

  it('i. does not mutate input arrays', () => {
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-06', amount: 50, label: 'Pending' },
    ];
    const events: DatedCashEvent[] = [
      { date: '2026-10-07', amount: 50, direction: 'out', label: 'Bill' },
    ];
    const before = cloneEvents(events);
    const pendingBefore = JSON.parse(JSON.stringify(pending));
    const result = reservePendingDebits(pending, events, chkSet);
    expect(result.events).toHaveLength(0);
    expect(events).toEqual(before);
    expect(pending).toEqual(pendingBefore);
  });

  it('j. matches across a month boundary', () => {
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-30', amount: 75, label: 'Gym pending' },
    ];
    const events: DatedCashEvent[] = [
      { date: '2026-11-05', amount: 75, direction: 'out', label: 'Gym' },
    ];
    const result = reservePendingDebits(pending, events, chkSet);
    expect(result.reserve).toBe(75);
    expect(result.items[0].replaces).toBe('Gym');
  });

  it('k. the window edges are inclusive', () => {
    expect(PENDING_MATCH_DAYS_BEFORE).toBe(3);
    expect(PENDING_MATCH_DAYS_AFTER).toBe(10);
    const pending: PendingDebit[] = [
      { accountId: 'chk', date: '2026-10-10', amount: 20, label: 'P1' },
      { accountId: 'chk', date: '2026-10-10', amount: 30, label: 'P2' },
    ];
    const events: DatedCashEvent[] = [
      { date: '2026-10-07', amount: 20, direction: 'out', label: 'Three before' },
      { date: '2026-10-20', amount: 30, direction: 'out', label: 'Ten after' },
    ];
    const result = reservePendingDebits(pending, events, chkSet);
    expect(result.items.map(i => i.replaces)).toEqual(['Three before', 'Ten after']);
  });
});
