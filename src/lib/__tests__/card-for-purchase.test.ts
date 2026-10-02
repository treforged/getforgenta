// "Which card for this purchase?" (ask 1f3217bb). Every case asserts a number.
//
// Would-fail checks: charge interest on a $0-balance card and "a 0% card beats higher rewards" flips;
// let a future card through and "planned cards are never suggested" fails; invent a rate for a card
// with no rewards entered and "never invents a rate" fails.

import { describe, it, expect } from 'vitest';
import { rankCardsForPurchase, parseCardRewards, parseWelcomeOffer, welcomeOfferValue, type AdvisorCard } from '../card-for-purchase';

const today = new Date(2026, 9, 1, 12);
const card = (over: Partial<AdvisorCard> & { id: string }): AdvisorCard => ({
  name: over.id, account_type: 'credit_card', active: true, balance: 0, apr: 22.99, credit_limit: 10000,
  card_start_date: null, rewards: null, ...over,
});

describe('rankCardsForPurchase', () => {
  it('a card carrying a balance loses to a $0 card despite HIGHER rewards when the gap is under a month of interest', () => {
    const prime = card({ id: 'Prime', balance: 8892.82, apr: 27.74, credit_limit: 15000, rewards: { base_pct: 3 } });
    const vx = card({ id: 'VentureX', balance: 0, apr: 22.99, rewards: { base_pct: 2 } });
    const { ranked } = rankCardsForPurchase({ cards: [prime, vx], amount: 300, category: 'groceries', today });
    expect(ranked.map(r => r.id)).toEqual(['VentureX', 'Prime']);
    expect(ranked[0]).toMatchObject({ rewardsEarned: 6, monthlyInterest: 0, netValue: 6 });
    // 3% of 300 = 9 earned; a carried balance has no grace period: 300 * 27.74% / 12 = 6.935 -> 6.94.
    expect(ranked[1]).toMatchObject({ rewardsEarned: 9, monthlyInterest: 6.94, netValue: 2.06 });
  });

  it('but a rewards gap LARGER than a month of interest wins, and says by how much', () => {
    // The app already sends every spare dollar to debt, so cash that pays the $0 card in full would
    // otherwise have paid the carried card down: the marginal cost is the first month's interest.
    const prime = card({ id: 'Prime', balance: 8892.82, apr: 27.74, credit_limit: 15000, rewards: { base_pct: 1, categories: { groceries: 5 } } });
    const vx = card({ id: 'VentureX', balance: 0, rewards: { base_pct: 2 } });
    const { ranked } = rankCardsForPurchase({ cards: [prime, vx], amount: 300, category: 'groceries', today });
    expect(ranked.map(r => [r.id, r.netValue])).toEqual([['Prime', 8.06], ['VentureX', 6]]);
  });

  it('interest is per MONTH it stays: one month at 27.74% on $1,500 is $34.68', () => {
    const { ranked } = rankCardsForPurchase({ cards: [card({ id: 'P', balance: 100, apr: 27.74, credit_limit: 20000 })], amount: 1500, category: 'other', today });
    expect(ranked[0].monthlyInterest).toBe(34.68);
    expect(ranked[0].netValue).toBe(-34.68);
  });

  it('planned cards (future start date) are never suggested', () => {
    const { ranked, excluded } = rankCardsForPurchase({
      cards: [card({ id: 'VX', card_start_date: '2027-06-01' }), card({ id: 'Disc', balance: 0 })], amount: 50, category: 'gas', today,
    });
    expect(ranked.map(r => r.id)).toEqual(['Disc']);
    expect(excluded).toEqual([{ id: 'VX', name: 'VX', why: 'not-open' }]);
  });

  it('never invents a rate: no rewards entered means rewardsEarned null, not 0% or 1%', () => {
    const { ranked } = rankCardsForPurchase({ cards: [card({ id: 'A' })], amount: 100, category: 'dining', today });
    expect(ranked[0].rewardsEarned).toBeNull();
    expect(ranked[0].netValue).toBe(0);
  });

  it('category multiplier beats base; base is used when the category has none', () => {
    const rewards = { base_pct: 1.5, categories: { dining: 4 } };
    const r = (category: 'dining' | 'travel') => rankCardsForPurchase({ cards: [card({ id: 'A', rewards })], amount: 80, category, today }).ranked[0].rewardsEarned;
    expect(r('dining')).toBe(3.2);
    expect(r('travel')).toBe(1.2);
  });

  it('a purchase over the remaining limit is excluded; utilization above 30% sorts after an equal card under it', () => {
    const { ranked, excluded } = rankCardsForPurchase({
      cards: [card({ id: 'Full', balance: 0, credit_limit: 100 }), card({ id: 'High', credit_limit: 1000 }), card({ id: 'Low', credit_limit: 5000 })],
      amount: 400, category: 'other', today,
    });
    expect(excluded).toEqual([{ id: 'Full', name: 'Full', why: 'over-limit' }]);
    expect(ranked.map(r => [r.id, r.utilizationAfter, r.overUtilization])).toEqual([['Low', 8, false], ['High', 40, true]]);
  });

  it('a carried balance with an UNKNOWN APR ranks last with interest null, never as free', () => {
    const { ranked } = rankCardsForPurchase({
      cards: [card({ id: 'NoApr', balance: 500, apr: null, rewards: { base_pct: 10 } }), card({ id: 'Paid', balance: 0 })], amount: 100, category: 'other', today,
    });
    expect(ranked.map(r => [r.id, r.monthlyInterest])).toEqual([['Paid', 0], ['NoApr', null]]);
  });

  it('ignores inactive cards and non-cards, and returns nothing for a non-positive amount', () => {
    const cards = [card({ id: 'Off', active: false }), { ...card({ id: 'Chk' }), account_type: 'checking' }, card({ id: 'On' })];
    expect(rankCardsForPurchase({ cards, amount: 10, category: 'other', today }).ranked.map(r => r.id)).toEqual(['On']);
    expect(rankCardsForPurchase({ cards, amount: 0, category: 'other', today })).toEqual({ ranked: [], excluded: [] });
    expect(rankCardsForPurchase({ cards, amount: Number.NaN, category: 'other', today }).ranked).toEqual([]);
  });

  it('an open welcome offer adds its share of the bonus: $1,500 of a $4,000-for-$750 offer is $281.25', () => {
    const offer = { required_spend: 4000, spent: 0, bonus_value: 750, deadline: '2027-09-01' };
    const { ranked } = rankCardsForPurchase({
      cards: [card({ id: 'VX', rewards: { base_pct: 2 }, welcomeOffer: offer, credit_limit: 30000 }), card({ id: 'Apple', rewards: { base_pct: 3 } })],
      amount: 1500, category: 'other', today,
    });
    expect(ranked.map(r => [r.id, r.offerValue, r.netValue])).toEqual([['VX', 281.25, 311.25], ['Apple', null, 45]]);
  });
});

describe('welcomeOfferValue', () => {
  const offer = { required_spend: 4000, spent: 3500, bonus_value: 750, deadline: '2027-09-01' };
  it('counts only the spend still needed, and nothing once met or expired', () => {
    expect(welcomeOfferValue(offer, 1500, today)).toBe(93.75);           // 500 left of 4000
    expect(welcomeOfferValue({ ...offer, spent: 4000 }, 100, today)).toBeNull();
    expect(welcomeOfferValue({ ...offer, deadline: '2026-09-30' }, 100, today)).toBeNull();
    expect(welcomeOfferValue({ ...offer, deadline: '2026-10-01' }, 100, today)).toBe(18.75); // due today still counts
    expect(welcomeOfferValue(null, 100, today)).toBeNull();
  });
});

describe('parsers never let a wrong rate through', () => {
  it('parseCardRewards keeps valid percents and drops the rest', () => {
    expect(parseCardRewards({ base_pct: 2, categories: { dining: 4, gas: -1, travel: 'x', bogus: 9 } }))
      .toEqual({ base_pct: 2, categories: { dining: 4 } });
    expect(parseCardRewards({ base_pct: 150 })).toBeNull();
    expect(parseCardRewards({ categories: { dining: 4 } })).toBeNull();
    expect(parseCardRewards(null)).toBeNull();
    expect(parseCardRewards([1])).toBeNull();
  });
  it('parseWelcomeOffer requires a positive spend, a positive bonus and a YYYY-MM-DD deadline', () => {
    expect(parseWelcomeOffer({ required_spend: 4000, bonus_value: 750, deadline: '2027-09-01' }))
      .toEqual({ required_spend: 4000, spent: 0, bonus_value: 750, deadline: '2027-09-01' });
    expect(parseWelcomeOffer({ required_spend: 0, bonus_value: 750, deadline: '2027-09-01' })).toBeNull();
    expect(parseWelcomeOffer({ required_spend: 4000, bonus_value: 750, deadline: 'Sept 1' })).toBeNull();
  });
});

describe('debit cards (ask 37c89404, Tre 2026-10-01: "debit cards should also be an option")', () => {
  const checking = (over: Partial<AdvisorCard> & { id: string }): AdvisorCard =>
    card({ account_type: 'checking', apr: null, credit_limit: null, balance: 2000, ...over });

  it('beats a card whose first month of interest outweighs its rewards, because debit costs none', () => {
    // 1% of 300 = 3 earned; 300 * 27.74% / 12 = 6.94 interest; net -3.94 < debit's 0.
    // (At 3% the same card nets +2.06 and correctly beats debit - the existing rewards-vs-interest rule.)
    const prime = card({ id: 'Prime', balance: 8892.82, apr: 27.74, credit_limit: 15000, rewards: { base_pct: 1 } });
    const { ranked } = rankCardsForPurchase({ cards: [prime, checking({ id: 'Chase' })], amount: 300, category: 'groceries', today });
    expect(ranked.map(r => r.id)).toEqual(['Chase', 'Prime']);
    expect(ranked[0]).toMatchObject({ isDebit: true, monthlyInterest: 0, rewardsEarned: null, netValue: 0, utilizationAfter: null });
    expect(ranked[1].netValue).toBe(-3.94);
  });

  it('loses to a $0-balance card that earns rewards, since that card is paid in full for free', () => {
    const vx = card({ id: 'VentureX', balance: 0, rewards: { base_pct: 2 } });
    const { ranked } = rankCardsForPurchase({ cards: [checking({ id: 'Chase' }), vx], amount: 300, category: 'other', today });
    expect(ranked.map(r => r.id)).toEqual(['VentureX', 'Chase']);
    expect(ranked[0].netValue).toBe(6);
  });

  it('is left out with not-enough-cash when the purchase is more than the checking balance', () => {
    const { ranked, excluded } = rankCardsForPurchase({ cards: [checking({ id: 'Chase', balance: 250 })], amount: 300, category: 'other', today });
    expect(ranked).toEqual([]);
    expect(excluded).toEqual([{ id: 'Chase', name: 'Chase', why: 'not-enough-cash' }]);
  });

  it('a savings account is never offered, and credit cards report isDebit false', () => {
    const { ranked } = rankCardsForPurchase({ cards: [card({ id: 'Sav', account_type: 'savings' }), card({ id: 'VX' })], amount: 50, category: 'other', today });
    expect(ranked.map(r => [r.id, r.isDebit])).toEqual([['VX', false]]);
  });
});
