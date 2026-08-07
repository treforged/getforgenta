import { describe, it, expect } from 'vitest';
import { cardStartMonthOffset, isCardOpenAsOf } from '../card-start-date';

/**
 * A credit card with a FUTURE card_start_date is a card the user has not opened
 * yet. Its credit limit is not real available credit, so it must not count
 * toward utilization — the same rule the simulation already applies when it
 * holds such a card out until its start month.
 */
describe('cardStartMonthOffset', () => {
  const now = new Date('2026-08-06T12:00:00');

  it('is 0 for a card with no start date (an existing card)', () => {
    expect(cardStartMonthOffset(null, now)).toBe(0);
    expect(cardStartMonthOffset(undefined, now)).toBe(0);
  });

  it('is 0 for a start date in the current month, whatever the day', () => {
    expect(cardStartMonthOffset('2026-08-01', now)).toBe(0);
    expect(cardStartMonthOffset('2026-08-31', now)).toBe(0);
  });

  it('counts whole months to a future start date', () => {
    expect(cardStartMonthOffset('2026-09-01', now)).toBe(1);
    expect(cardStartMonthOffset('2026-12-20', now)).toBe(4);
    expect(cardStartMonthOffset('2028-02-28', now)).toBe(18);
  });

  it('clamps a past start date to 0 — the card is already open', () => {
    expect(cardStartMonthOffset('2025-01-15', now)).toBe(0);
  });
});

describe('isCardOpenAsOf', () => {
  const now = new Date('2026-08-06T12:00:00');
  const card = (card_start_date: string | null) => ({
    id: 'c1',
    account_type: 'credit_card',
    card_start_date,
    name: 'Card',
  });

  it('treats a card with no start date as open', () => {
    expect(isCardOpenAsOf(card(null), now)).toBe(true);
  });

  it('treats a card starting this month as open', () => {
    expect(isCardOpenAsOf(card('2026-08-20'), now)).toBe(true);
  });

  it('treats a card starting in a future month as NOT open', () => {
    expect(isCardOpenAsOf(card('2026-12-20'), now)).toBe(false);
    expect(isCardOpenAsOf(card('2028-02-28'), now)).toBe(false);
  });

  it('treats a non-credit-card account as open regardless of the field', () => {
    expect(isCardOpenAsOf({ ...card('2028-01-01'), account_type: 'checking' }, now)).toBe(true);
  });
});
