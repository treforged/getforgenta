import { describe, it, expect } from 'vitest';
import { generateRecommendations, type CardData } from '../credit-card-engine';

/**
 * A credit card with a FUTURE `card_start_date` is one the user has planned, not opened.
 * It cannot receive a payment this month — but it reaches `generateRecommendations` looking
 * exactly like a zero-balance cycling card, because the preference bucket is keyed on
 * `autopayFullBalance` (which encodes balance <= 0). That is how Venture X and Apple Card
 * came to be listed under "Recommended This Month".
 *
 * ⚠️ The projection is a separate question and must NOT change: `simulateVariablePayoff`
 * holds these cards out only until their start month and then models them turning on, which
 * is the entire point of the column. These tests are about the RECOMMENDATION only.
 */

const card = (over: Partial<CardData> & Pick<CardData, 'id' | 'name'>): CardData => ({
  balance: 0,
  apr: 22,
  creditLimit: 10000,
  minPayment: 25,
  targetPayment: 25,
  monthlyNewPurchases: 0,
  monthlyRepayments: 0,
  color: '#123456',
  paymentPreference: null,
  autopayFullBalance: false,
  dueDay: 12,
  statementBalancePhase: false,
  statementBalance: null,
  ...over,
} as CardData);

/** Far enough out that the test cannot age into the card being open. */
const futureStart = (): string => `${new Date().getFullYear() + 4}-02-28`;
const pastStart = '2020-01-05';

describe('generateRecommendations — cards that have not been opened yet', () => {
  // Cash is deliberately TIGHT in these fixtures. With plenty of cash every card is paid in
  // full and an extra bucket member costs nothing, so the bug hides — which is exactly how a
  // test here can pass while the panel still lists a card that does not exist.
  const openCard = () =>
    card({ id: 'open', name: 'Discover', balance: 4000, apr: 16.6, minPayment: 120, startDate: pastStart });
  /** A planned card looks IDENTICAL to a zero-balance cycling card to the bucket filter. */
  const plannedCyclingCard = () =>
    card({
      id: 'planned', name: 'Venture X', autopayFullBalance: true, paymentPreference: 'statement',
      monthlyNewPurchases: 900, startDate: futureStart(),
    });

  it('does not recommend a payment on an unopened card', () => {
    const { recommendations } = generateRecommendations(
      [openCard(), plannedCyclingCard()], 2000, 0, 'avalanche', 0, 0,
    );
    expect(recommendations.map(r => r.cardId)).toEqual(['open']);
  });

  it('does not let an unopened card consume cash the open cards could have had', () => {
    // The preference bucket pays a cycling card its anticipated purchases first. On a card that
    // does not exist that is cash routed at nothing — and it is subtracted from what the real
    // cards are then told they can be paid.
    const withPlanned = generateRecommendations([openCard(), plannedCyclingCard()], 2000, 0, 'avalanche', 0, 0);
    const withoutPlanned = generateRecommendations([openCard()], 2000, 0, 'avalanche', 0, 0);
    const paid = (r: ReturnType<typeof generateRecommendations>) =>
      r.recommendations.find(x => x.cardId === 'open')!.payment;
    expect(paid(withPlanned)).toBe(paid(withoutPlanned));
    // Pin the actual figure so the equality above cannot be satisfied by both sides collapsing.
    expect(paid(withPlanned)).toBe(2000);
  });

  it('recommends the card normally once its start month has arrived', () => {
    const started = new Date();
    const thisMonthStart = `${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, '0')}-01`;
    const { recommendations } = generateRecommendations(
      [card({ id: 'now', name: 'Venture X', balance: 600, minPayment: 40, startDate: thisMonthStart })],
      2000, 0, 'avalanche', 0, 0,
    );
    expect(recommendations.map(r => r.cardId)).toEqual(['now']);
  });

  it('leaves a card with no start date alone', () => {
    const { recommendations } = generateRecommendations(
      [card({ id: 'plain', name: 'Prime Visa', balance: 2000, minPayment: 60 })], 2000, 0, 'avalanche', 0, 0,
    );
    expect(recommendations.map(r => r.cardId)).toEqual(['plain']);
  });
});
