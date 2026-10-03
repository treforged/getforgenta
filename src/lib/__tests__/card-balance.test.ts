/**
 * A credit card's synced balance includes its pending charges (ask 1f00b82d).
 *
 * The real case: Tre's Robinhood card, current $926.85, available $4,288.70, limit $5,250.
 * The app owes $961.30 = $926.85 posted + $34.45 pending.
 */
import { describe, expect, it } from 'vitest';
import { cardBalanceOwed } from '../../../supabase/functions/_shared/providers/card-balance';

describe('cardBalanceOwed', () => {
  it('uses limit - available when it exceeds current (Robinhood, real numbers)', () => {
    expect(cardBalanceOwed({ current: 926.85, available: 4288.7, limit: 5250 })).toBe(961.3);
  });

  it('keeps current when limit - available is smaller', () => {
    expect(cardBalanceOwed({ current: 500, available: 4900, limit: 5250 })).toBe(500);
  });

  it('falls back to current when available or limit is missing', () => {
    expect(cardBalanceOwed({ current: 926.85, available: null, limit: 5250 })).toBe(926.85);
    expect(cardBalanceOwed({ current: 926.85, available: 4288.7, limit: null })).toBe(926.85);
    expect(cardBalanceOwed({ current: 926.85, available: 4288.7, limit: 0 })).toBe(926.85);
  });

  it('reads a negative current as an owed amount', () => {
    expect(cardBalanceOwed({ current: -120, available: null, limit: null })).toBe(120);
  });

  it('rounds to cents', () => {
    expect(cardBalanceOwed({ current: 0, available: 0.1 + 0.2, limit: 1 })).toBe(0.7);
  });
});
