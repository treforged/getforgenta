// THE CARD CATALOG NEVER OVERSTATES A REWARD (ask f9b0da16, Sam's three conditions 2026-10-01, ask 55e839de).
//
// Every rate here was read from the issuer's own page on 2026-10-01. The tests pin the three rules that
// keep a public catalog honest about a PRIVATE fact it cannot see: whether the user holds the membership,
// what a mile is worth to them, and which categories the issuer has published for this quarter.
//
// Would-fail checks: answer-undefined taking `with` breaks case 1; a default cents-per-mile breaks case 3;
// dropping the stale check breaks case 5.

import { describe, it, expect } from 'vitest';
import {
  CARD_CATALOG, findCatalogProduct, isStale, quarterOf, resolveCatalogRewards,
} from '@/lib/card-catalog';

const TODAY = new Date(2026, 9, 1, 12); // 2026-10-01 local
const p = (id: string) => findCatalogProduct(id)!;

describe('card catalog - conditional rates (Sam rule 1)', () => {
  it('Apple Card: no answer takes the LOWER rate (1%), yes takes 2%, no takes 1%', () => {
    expect(resolveCatalogRewards(p('apple-card'), { today: TODAY }).rewards!.base_pct).toBe(1);
    expect(resolveCatalogRewards(p('apple-card'), { today: TODAY, answers: { uses_apple_pay: true } }).rewards!.base_pct).toBe(2);
    expect(resolveCatalogRewards(p('apple-card'), { today: TODAY, answers: { uses_apple_pay: false } }).rewards!.base_pct).toBe(1);
  });

  it('Robinhood: the issuer states no rate without Gold, so an unanswered question is UNKNOWN, never 3%', () => {
    const r = resolveCatalogRewards(p('robinhood-gold-card'), { today: TODAY });
    expect(r.rewards).toBeNull();
    expect(r.unknown).toEqual(['Do you have Robinhood Gold? (needed for this rate)']);
    expect(resolveCatalogRewards(p('robinhood-gold-card'), { today: TODAY, answers: { robinhood_gold: true } }).rewards!.base_pct).toBe(3);
  });

  it('Prime Visa ranks only what maps to a category: 1% base, 2% gas and dining, no invented 5% groceries', () => {
    const r = resolveCatalogRewards(p('chase-prime-visa'), { today: TODAY, answers: { prime_member: true } });
    expect(r.rewards).toEqual({ base_pct: 1, categories: { gas: 2, dining: 2 } });
    expect(r.notes.join(' ')).toMatch(/not ranked/);
  });
});

describe('card catalog - miles (Sam rule 2)', () => {
  it('Venture X is NOT ranked without a cent value the user gave', () => {
    const r = resolveCatalogRewards(p('capital-one-venture-x'), { today: TODAY });
    expect(r.rewards).toBeNull();
    expect(r.notes.at(-1)).toMatch(/what a mile is worth to you/);
    for (const bad of [0, -1, Number.NaN, null]) {
      expect(resolveCatalogRewards(p('capital-one-venture-x'), { today: TODAY, centsPerMile: bad }).rewards).toBeNull();
    }
  });

  it('with 1.0 cent a mile, 2x miles ranks as 2%; with 0.5 cent, as 1%', () => {
    expect(resolveCatalogRewards(p('capital-one-venture-x'), { today: TODAY, centsPerMile: 1 }).rewards!.base_pct).toBe(2);
    expect(resolveCatalogRewards(p('capital-one-venture-x'), { today: TODAY, centsPerMile: 0.5 }).rewards!.base_pct).toBe(1);
  });
});

describe('card catalog - rotating quarters and staleness (Sam rule 3)', () => {
  it('Discover Q4 2026 is 5% on dining (read 2026-10-01) and names the categories it cannot rank', () => {
    const r = resolveCatalogRewards(p('discover-it-cash-back'), { today: TODAY });
    expect(r.rewards).toEqual({ base_pct: 1, categories: { dining: 5 } });
    expect(r.unknown).toEqual([]);
    expect(r.notes).toContain('5% this quarter also covers Entertainment and Utilities, which Which Card? has no category for yet.');
  });

  it('Discover in a quarter nobody has read is UNKNOWN, and the 1% base still applies', () => {
    const r = resolveCatalogRewards(p('discover-it-cash-back'), { today: new Date(2027, 0, 5) });
    expect(r.rewards).toEqual({ base_pct: 1, categories: {} });
    expect(r.unknown).toContain("This quarter's 5% categories (not yet read from the issuer)");
  });

  it('a sourced rotating quarter applies 5% to its categories only in that quarter', () => {
    const base = p('discover-it-cash-back');
    const withQ4 = { ...base, rotating: [{ quarter: '2026-Q4', categories: ['dining' as const], pct: 5, cap_spend: 1500, source_url: 'x', checked_on: '2026-10-01' }] };
    expect(resolveCatalogRewards(withQ4, { today: TODAY }).rewards!.categories).toEqual({ dining: 5 });
    expect(resolveCatalogRewards(withQ4, { today: new Date(2027, 0, 5) }).rewards!.categories).toEqual({});
  });

  it('a rate older than 120 days, unparseable, or dated in the future is stale', () => {
    expect(isStale('2026-10-01', new Date(2027, 0, 29))).toBe(false); // 120 days
    expect(isStale('2026-10-01', new Date(2027, 0, 30))).toBe(true);  // 121 days
    expect(isStale('2026-10-02', TODAY)).toBe(true);
    expect(isStale('Oct 1', TODAY)).toBe(true);
    const r = resolveCatalogRewards(p('apple-card'), { today: new Date(2027, 1, 15) });
    expect(r.rewards).toBeNull();
    expect(r.unknown[0]).toMatch(/too old to trust/);
  });

  it('quarterOf reads the LOCAL month', () => {
    expect(quarterOf(new Date(2026, 9, 1, 0, 30))).toBe('2026-Q4');
    expect(quarterOf(new Date(2026, 8, 30, 23, 30))).toBe('2026-Q3');
  });
});

describe('card catalog - every rate is sourced', () => {
  it('each product rate carries an https issuer URL and a checked_on date', () => {
    const rates = CARD_CATALOG.flatMap(prod => [prod.base, ...Object.values(prod.categories)])
      .flatMap(r => ('condition' in r! ? [r!.with, r!.without] : [r]))
      .filter(Boolean);
    expect(rates.length).toBeGreaterThanOrEqual(7);
    for (const r of rates) {
      expect(r!.source_url).toMatch(/^https:\/\//);
      expect(r!.checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('resolving never mutates the catalog', () => {
    const before = JSON.stringify(CARD_CATALOG);
    resolveCatalogRewards(p('capital-one-venture-x'), { today: TODAY, centsPerMile: 1.5 });
    resolveCatalogRewards(p('discover-it-cash-back'), { today: TODAY });
    expect(JSON.stringify(CARD_CATALOG)).toBe(before);
  });
});
