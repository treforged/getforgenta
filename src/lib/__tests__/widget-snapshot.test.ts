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

// ─── Next debt payments (Tre, 2026-09-28: "we also need next debt payments as a widget") ────────
import { buildNextDebtPayments } from '@/lib/widget-snapshot';

describe('buildNextDebtPayments', () => {
  // Local-calendar constructors, so the expected YYYY-MM-DD is the user's own day in every zone
  // test:tz runs (UTC, New York, Tokyo). An ISO-string constructor would shift the day in two of them.
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

  it('orders all three kinds soonest first and keeps the app rows untouched', () => {
    const out = buildNextDebtPayments({
      recommendations: [{ cardName: 'Visa', nextPayment: 250, nextDueDate: d(2026, 10, 15) }],
      loanRecommendations: [{ name: 'Car loan', nextPayment: 410.5, nextDueDate: d(2026, 10, 3) }],
      otherDebtRecommendations: [{ name: 'Student loan', nextPayment: 120, nextDueDate: d(2026, 10, 9) }],
    });
    expect(out).toEqual([
      { name: 'Car loan', amount: 410.5, dueDate: '2026-10-03' },
      { name: 'Student loan', amount: 120, dueDate: '2026-10-09' },
      { name: 'Visa', amount: 250, dueDate: '2026-10-15' },
    ]);
  });

  it('puts a payment with no due day LAST instead of dropping it', () => {
    const out = buildNextDebtPayments({
      recommendations: [
        { cardName: 'No-date card', nextPayment: 40, nextDueDate: null },
        { cardName: 'Dated card', nextPayment: 60, nextDueDate: d(2026, 11, 1) },
      ],
    });
    expect(out.map((r) => r.name)).toEqual(['Dated card', 'No-date card']);
    expect(out[1].dueDate).toBeNull();
  });

  it('sends an unmodelled amount as null, never as 0', () => {
    const out = buildNextDebtPayments({
      recommendations: [
        { cardName: 'Unmodelled', nextPayment: null, nextDueDate: d(2026, 10, 1) },
        { cardName: 'NaN', nextPayment: Number.NaN, nextDueDate: d(2026, 10, 2) },
      ],
    });
    expect(out.map((r) => r.amount)).toEqual([null, null]);
  });

  it('caps the list at the limit and returns [] for no debts', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ cardName: `C${i}`, nextPayment: 10, nextDueDate: d(2026, 10, i + 1) }));
    expect(buildNextDebtPayments({ recommendations: many })).toHaveLength(3);
    expect(buildNextDebtPayments({ recommendations: [] })).toEqual([]);
  });

  it('rides along in the payload only when sent', () => {
    const base = { monthEndCash: 1, netWorth: 2, currency: 'USD', enabled: true };
    const now = new Date('2026-09-28T12:00:00Z');
    expect(buildWidgetPayload(base, now)).not.toHaveProperty('nextDebtPayments');
    expect(buildWidgetPayload({ ...base, nextDebtPayments: [] }, now)?.nextDebtPayments).toEqual([]);
  });
});
