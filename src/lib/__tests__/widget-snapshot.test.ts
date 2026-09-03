// What the app is allowed to put on someone's HOME SCREEN.
//
// A widget shows a number without anyone opening the app, so nobody opens the app to check what
// the home screen already told them. That makes a wrong figure there worse than a blank one: a
// blank prompts a tap, a wrong number ends the conversation. Every case below is a way the old
// code would have shown a confident value it had not actually read.
//
// Would-fail checks: default a missing figure to 0 (which `optDouble("netWorth", 0)` did on the
// Android side) and "absent is not zero" fails; drop the Number.isFinite guard and NaN/Infinity
// reach NumberFormat, which prints them; hardcode USD and the currency case fails.

import { describe, it, expect } from 'vitest';
import { buildWidgetPayload, isSnapshotStale, WIDGET_STALE_AFTER_MS } from '@/lib/widget-snapshot';

const NOW = new Date('2026-09-03T12:00:00Z');

const inputs = (over = {}) => ({
  monthEndCash: 3300,
  netWorth: -21771,
  currency: 'USD',
  enabled: true,
  ...over,
});

describe('buildWidgetPayload', () => {
  it('sends a real pair of figures', () => {
    const p = buildWidgetPayload(inputs(), NOW);
    expect(p).toEqual({
      monthEndCash: 3300,
      netWorth: -21771,
      currency: 'USD',
      updatedAt: NOW.toISOString(),
    });
  });

  it('sends a genuine zero, because that is a real answer', () => {
    const p = buildWidgetPayload(inputs({ netWorth: 0, monthEndCash: 0 }), NOW);
    expect(p?.netWorth).toBe(0);
  });

  it('ABSENT IS NOT ZERO — sends nothing when a figure is missing', () => {
    // The failure this exists to prevent: a user whose data has not loaded and a user who
    // genuinely has nothing look identical on a home screen once you default to 0.
    expect(buildWidgetPayload(inputs({ netWorth: null }), NOW)).toBeNull();
    expect(buildWidgetPayload(inputs({ monthEndCash: undefined }), NOW)).toBeNull();
  });

  it('refuses NaN and Infinity, which is what a missing denominator looks like', () => {
    expect(buildWidgetPayload(inputs({ netWorth: Number.NaN }), NOW)).toBeNull();
    expect(buildWidgetPayload(inputs({ monthEndCash: Number.POSITIVE_INFINITY }), NOW)).toBeNull();
  });

  it('sends nothing at all when the caller is not ready', () => {
    expect(buildWidgetPayload(inputs({ enabled: false }), NOW)).toBeNull();
  });

  it("carries the USER's currency, not a hardcoded dollar sign", () => {
    expect(buildWidgetPayload(inputs({ currency: 'GBP' }), NOW)?.currency).toBe('GBP');
    // Falls back only when there is genuinely nothing to use.
    expect(buildWidgetPayload(inputs({ currency: null }), NOW)?.currency).toBe('USD');
    expect(buildWidgetPayload(inputs({ currency: '  ' }), NOW)?.currency).toBe('USD');
  });
});

describe('isSnapshotStale', () => {
  it('trusts a fresh snapshot', () => {
    const recent = new Date(NOW.getTime() - 60_000).toISOString();
    expect(isSnapshotStale(recent, NOW)).toBe(false);
  });

  it('stops trusting one older than the window', () => {
    const old = new Date(NOW.getTime() - WIDGET_STALE_AFTER_MS - 1).toISOString();
    expect(isSnapshotStale(old, NOW)).toBe(true);
  });

  it('treats missing or unparseable timestamps as stale, never as fresh', () => {
    // Failing towards "do not show a number" is the safe direction on this surface.
    expect(isSnapshotStale(null, NOW)).toBe(true);
    expect(isSnapshotStale('not-a-date', NOW)).toBe(true);
  });
});
