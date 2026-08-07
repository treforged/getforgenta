import { describe, it, expect } from 'vitest';
import { openCreditLimitAtMonth } from '../credit-card-engine';

/**
 * The utilization milestones ("when do I get under 30%?") divide projected
 * balances by the total credit limit. A card the user has not opened yet must
 * not contribute its limit until the month it opens, or the milestones read
 * optimistically against credit that does not exist.
 */
describe('openCreditLimitAtMonth', () => {
  const cards = [
    { creditLimit: 14400, startMonth: 0 },  // existing card
    { creditLimit: 11000, startMonth: 0 },  // existing card
    { creditLimit: 10000, startMonth: 4 },  // opens in 4 months
    { creditLimit: 10000, startMonth: 18 }, // opens in 18 months
  ];

  it('counts only already-open cards in the current month', () => {
    expect(openCreditLimitAtMonth(cards, 0)).toBe(25400);
  });

  it('still excludes a card the month before it opens', () => {
    expect(openCreditLimitAtMonth(cards, 3)).toBe(25400);
  });

  it('includes a card from the month it opens onward', () => {
    expect(openCreditLimitAtMonth(cards, 4)).toBe(35400);
    expect(openCreditLimitAtMonth(cards, 17)).toBe(35400);
  });

  it('includes every card once all have opened', () => {
    expect(openCreditLimitAtMonth(cards, 18)).toBe(45400);
    expect(openCreditLimitAtMonth(cards, 119)).toBe(45400);
  });

  it('is 0 when there are no cards', () => {
    expect(openCreditLimitAtMonth([], 0)).toBe(0);
  });
});
