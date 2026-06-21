import { describe, it, expect } from 'vitest';
import { getAugmentedMinSafeCash, buildPayConfig } from '../pay-schedule';

// Regression for a real account: Venture X has a card_start_date a couple months in the future
// (the card doesn't exist yet / hasn't been opened), but getAugmentedMinSafeCash's cycling-card
// floor reservation (the "else" branch below, for $0-balance statement/full-preference cards)
// never checked card_start_date at all — a not-yet-started card looked identical to a genuinely
// paid-off cycling card and had its minimum payment reserved in the cash floor every month from
// today, months before the card will have any real payment due.

const profile: any = { weekly_gross_income: 0.01 };

function makeCard(overrides: Partial<Record<string, any>>) {
  return {
    id: 'vx', name: 'Venture X', balance: 0, minPayment: 25, paymentPreference: 'statement',
    autopayFullBalance: true, dueDay: 7, startDate: undefined,
    ...overrides,
  };
}

describe('getAugmentedMinSafeCash — card_start_date gating', () => {
  it('does not reserve a cycling card\'s minimum in the floor before its start date', () => {
    const config = buildPayConfig(profile);
    const card = makeCard({ startDate: '2026-08-28' });
    const cc = {
      simCards: [card],
      monthlyRevolvingBalances: new Map([['vx', [0]]]),
      perCardMinPayments: new Map([['vx', [0]]]),
    };
    const now = new Date(2026, 5, 21); // June 21, 2026 — before the card starts
    const result = getAugmentedMinSafeCash([], config, 1000, null, now, [], cc, 0);
    expect(result.floorItems.find(i => i.name.includes('Venture X'))).toBeUndefined();
    expect(result.prePaycheckBillsTotal).toBe(0);
  });

  it('does reserve the same card\'s minimum once its start month has arrived', () => {
    const config = buildPayConfig(profile);
    const card = makeCard({ startDate: '2026-08-28' });
    const cc = {
      simCards: [card],
      monthlyRevolvingBalances: new Map([['vx', [0]]]),
      perCardMinPayments: new Map([['vx', [0]]]),
    };
    const now = new Date(2026, 7, 28); // August 28, 2026 — the start month itself
    const result = getAugmentedMinSafeCash([], config, 1000, null, now, [], cc, 0);
    expect(result.floorItems.find(i => i.name.includes('Venture X'))).toBeDefined();
    expect(result.prePaycheckBillsTotal).toBe(25);
  });

  it('still reserves a cycling card with no startDate set (unaffected by this change)', () => {
    const config = buildPayConfig(profile);
    const card = makeCard({ startDate: undefined });
    const cc = {
      simCards: [card],
      monthlyRevolvingBalances: new Map([['vx', [0]]]),
      perCardMinPayments: new Map([['vx', [0]]]),
    };
    const now = new Date(2026, 5, 21);
    const result = getAugmentedMinSafeCash([], config, 1000, null, now, [], cc, 0);
    expect(result.prePaycheckBillsTotal).toBe(25);
  });
});
