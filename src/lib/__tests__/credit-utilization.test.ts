import { describe, it, expect } from 'vitest';
import {
  breakdownCardUtilization, summarizeUtilization, rankByUtilizationImpact,
  previewCardPaymentImpact, utilizationPointsPerHundredDollars, type UtilizationCard,
} from '../credit-utilization';

/**
 * Real scenario (conductor inbox 9cb95337, 2026-08-14): Tre's revolving balance is
 * $18,450 against $25,400 of limit on cards that are actually open = 72.6%. Venture X
 * (opens 2026-12-20) and Apple Card (opens 2028-02-28) add $20,000 more limit but must
 * not count yet. $5,145 of the $18,450 sits on Prime Visa's 0%-interest Amazon
 * equal-pay plan (plan_type='upfront') — utilization-only, no interest.
 *
 * "Now" is pinned to 2026-08-14 (the day the ticket was filed) so both future cards'
 * opensInMonths come out positive and deterministic.
 */
const NOW = new Date('2026-08-14T00:00:00');

function makeCard(overrides: Partial<UtilizationCard> = {}): UtilizationCard {
  return {
    id: 'card', name: 'Card', balance: 0, creditLimit: 0,
    installmentBalance: 0, startDate: undefined,
    ...overrides,
  };
}

const discover = makeCard({ id: 'discover', name: 'Discover', balance: 13305, creditLimit: 14400 });
const primeVisa = makeCard({
  id: 'prime-visa', name: 'Prime Visa', balance: 5145, creditLimit: 11000, installmentBalance: 5145,
});
const ventureX = makeCard({
  id: 'venture-x', name: 'Venture X', balance: 0, creditLimit: 10000, startDate: '2026-12-20',
});
const appleCard = makeCard({
  id: 'apple-card', name: 'Apple Card', balance: 0, creditLimit: 10000, startDate: '2028-02-28',
});
const allCards = [discover, primeVisa, ventureX, appleCard];

describe('breakdownCardUtilization', () => {
  it('splits Prime Visa into its 0%-interest installment tranche and the rest', () => {
    const b = breakdownCardUtilization(primeVisa, NOW);
    expect(b.utilizationOnlyBalance).toBe(5145);
    expect(b.interestBearingBalance).toBe(0);
    expect(b.utilizationPct).toBeCloseTo((5145 / 11000) * 100, 5);
  });

  it('flags Venture X and Apple Card as not open yet, with null utilization', () => {
    expect(breakdownCardUtilization(ventureX, NOW).isOpen).toBe(false);
    expect(breakdownCardUtilization(ventureX, NOW).opensInMonths).toBeGreaterThan(0);
    expect(breakdownCardUtilization(appleCard, NOW).utilizationPct).toBeNull();
  });
});

describe('summarizeUtilization', () => {
  const summary = summarizeUtilization(allCards, NOW);

  it('reproduces the real 72.6% overall utilization on open cards only', () => {
    expect(summary.totalBalance).toBe(18450);
    expect(summary.totalLimit).toBe(25400);
    expect(summary.utilizationPct).toBeCloseTo(72.6, 1);
  });

  it('calls out the $5,145 zero-interest tranche separately from interest-bearing debt', () => {
    expect(summary.utilizationOnlyBalance).toBe(5145);
    expect(summary.interestBearingBalance).toBe(13305);
  });

  it('excludes Venture X and Apple Card from the totals but lists them as future cards', () => {
    expect(summary.futureCards.map(c => c.name).sort()).toEqual(['Apple Card', 'Venture X']);
    expect(summary.futureCards.reduce((s, c) => s + c.creditLimit, 0)).toBe(20000);
  });
});

describe('rankByUtilizationImpact', () => {
  const ranked = rankByUtilizationImpact(allCards, NOW);

  it('excludes future cards and cards with no balance', () => {
    expect(ranked.map(r => r.id)).toEqual(['prime-visa', 'discover']);
  });

  it('ranks the smaller-limit card first — it moves furthest per dollar paid', () => {
    // Prime Visa ($11,000 limit) moves more per dollar than Discover ($14,400 limit),
    // even though Prime Visa's balance is entirely the 0% tranche — paying it buys
    // score, not interest, which is exactly the distinction the ticket asked for.
    expect(ranked[0].id).toBe('prime-visa');
    expect(ranked[0].pointsPerHundredDollars).toBeGreaterThan(ranked[1].pointsPerHundredDollars);
  });

  it('this order differs from the avalanche (APR-first) order — it is a separate lens, not a replacement', () => {
    // Avalanche sorts by APR descending (credit-card-engine.ts generateRecommendations).
    // A card with a lower limit is not necessarily the higher-APR card, so the two
    // orderings are independent by construction — this test only proves ranking is by
    // limit, not APR, since UtilizationCard here carries no apr field at all.
    expect(utilizationPointsPerHundredDollars(11000)).toBeGreaterThan(utilizationPointsPerHundredDollars(14400));
  });
});

describe('previewCardPaymentImpact', () => {
  it('shows a $500 payment moving Discover from ~92.4% toward ~88.9%', () => {
    const preview = previewCardPaymentImpact(discover, 500, NOW);
    expect(preview.beforePct).toBeCloseTo((13305 / 14400) * 100, 5);
    expect(preview.afterPct).toBeCloseTo((12805 / 14400) * 100, 5);
    expect(preview.deltaPoints).toBeCloseTo((500 / 14400) * 100, 5);
  });

  it('caps the payment at the balance — cannot go below $0 or produce a negative delta', () => {
    const preview = previewCardPaymentImpact(primeVisa, 999999, NOW);
    expect(preview.afterPct).toBe(0);
    expect(preview.deltaPoints).toBeCloseTo((5145 / 11000) * 100, 5);
  });

  it('returns nulls for a card that has not opened yet', () => {
    const preview = previewCardPaymentImpact(ventureX, 100, NOW);
    expect(preview.beforePct).toBeNull();
    expect(preview.afterPct).toBeNull();
    expect(preview.deltaPoints).toBeNull();
  });
});
