// Month-label regression: projectCard/projectCardVariable built their row labels by mutating
// TODAY's date with setMonth(). On a day-29/30/31 clock that overflows any shorter target month
// (Jul 30 + 7 months => "Feb 30 2027" => Mar 2), so February 2027 vanished from the card's month
// dropdown and March 2027 appeared twice. User-reported 2026-07-30 on Prime Visa.
// The row MATH was always correct; only the labels shifted.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { projectCard, type CardData } from '@/lib/credit-card-engine';

const makeCard = (over: Partial<CardData> = {}): CardData => ({
  id: 'c1',
  name: 'Prime Visa',
  balance: 6976.94,
  apr: 27.49,
  creditLimit: 14400,
  minPayment: 450.79,
  targetPayment: 500,
  monthlyNewPurchases: 0,
  monthlyRepayments: 0,
  color: 'hsl(200, 70%, 55%)',
  ...over,
} as CardData);

describe('card projection month labels', () => {
  afterEach(() => vi.useRealTimers());

  it('emits consecutive unique months with no gap or duplicate from a day-30 clock', () => {
    // The exact clock that produced the report.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 30, 12, 0, 0)); // Jul 30 2026, local

    const labels = projectCard(makeCard(), 18).months.map(r => r.label);

    expect(labels.length).toBeGreaterThan(9);
    // No duplicates.
    expect(new Set(labels).size).toBe(labels.length);
    // February 2027 must be present and must sit between Jan and Mar.
    expect(labels).toContain('Feb 2027');
    expect(labels.indexOf('Feb 2027')).toBe(labels.indexOf('Jan 2027') + 1);
    expect(labels.indexOf('Mar 2027')).toBe(labels.indexOf('Feb 2027') + 1);
    // First row is the current month.
    expect(labels[0]).toBe('Jul 2026');
  });

  it('is stable from a day-31 clock across a 30-day month', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 31, 12, 0, 0)); // Jan 31 2026

    const labels = projectCard(makeCard(), 6).months.map(r => r.label);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.slice(0, 4)).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026']);
  });
});
