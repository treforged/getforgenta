import type { CardRewards, PurchaseCategory } from '@/lib/card-for-purchase';

export const CATALOG_STALE_DAYS = 120;

export interface SourcedRate {
  pct: number;
  source_url: string;
  checked_on: string; // YYYY-MM-DD
}

export type ConditionKey = 'prime_member' | 'robinhood_gold' | 'uses_apple_pay';

export interface ConditionalRate {
  condition: ConditionKey;
  question: string;
  without: SourcedRate | null;
  with: SourcedRate;
}

export interface CatalogProduct {
  id: string;
  name: string;
  issuer: string;
  unit: 'cash' | 'miles';
  base: SourcedRate | ConditionalRate;
  categories: Partial<Record<PurchaseCategory, SourcedRate | ConditionalRate>>;
  notes: string[];
  rotating?: {
    quarter: string; // e.g. '2026-Q4'
    categories: PurchaseCategory[];
    pct: number;
    cap_spend: number;
    source_url: string;
    checked_on: string; // YYYY-MM-DD
    // Bonus categories the app has no purchase category for, named so they are not silently dropped.
    unranked?: string[];
  }[];
  rotating_source_url?: string;
}

export interface ResolvedRewards {
  rewards: CardRewards | null;
  unknown: string[];
  notes: string[];
}

/**
 * Read‑only catalog of public card reward structures.
 */
export const CARD_CATALOG: readonly CatalogProduct[] = [
  {
    id: 'chase-prime-visa',
    name: 'Prime Visa',
    issuer: 'Chase',
    unit: 'cash',
    base: {
      pct: 1,
      source_url: 'https://creditcards.chase.com/cash-back-credit-cards/amazon-prime-rewards',
      checked_on: '2026-10-01',
    },
    categories: {
      gas: {
        pct: 2,
        source_url: 'https://creditcards.chase.com/cash-back-credit-cards/amazon-prime-rewards',
        checked_on: '2026-10-01',
      },
      dining: {
        pct: 2,
        source_url: 'https://creditcards.chase.com/cash-back-credit-cards/amazon-prime-rewards',
        checked_on: '2026-10-01',
      },
    },
    notes: [
      '5% at Amazon, Whole Foods and Chase Travel with an eligible Prime membership (3% without). Those stores are not a purchase category here, so they are not ranked.',
    ],
  },
  {
    id: 'robinhood-gold-card',
    name: 'Robinhood Gold Card',
    issuer: 'Robinhood',
    unit: 'cash',
    base: {
      condition: 'robinhood_gold',
      question: 'Do you have Robinhood Gold?',
      without: null,
      with: {
        pct: 3,
        source_url: 'https://robinhood.com/creditcard/',
        checked_on: '2026-10-01',
      },
    },
    categories: {},
    notes: ['Robinhood Gold membership is required for this card.'],
  },
  {
    id: 'discover-it-cash-back',
    name: 'Discover it Cash Back',
    issuer: 'Discover',
    unit: 'cash',
    base: {
      pct: 1,
      source_url: 'https://www.discover.com/credit-cards/cash-back/it-card.html',
      checked_on: '2026-10-01',
    },
    categories: {},
    rotating: [
      {
        // Issuer page, read 2026-10-01: "Restaurants, Entertainment and Utilities ... now to
        // December 31, 2026, on up to $1,500 in purchases when you activate."
        quarter: '2026-Q4',
        categories: ['dining'],
        pct: 5,
        cap_spend: 1500,
        source_url: 'https://www.discover.com/credit-cards/cash-back/cashback-calendar.html',
        checked_on: '2026-10-01',
        unranked: ['Entertainment', 'Utilities'],
      },
    ],
    rotating_source_url:
      'https://www.discover.com/credit-cards/cash-back/cashback-calendar.html',
    notes: ['5% on up to $1,500 a quarter in rotating categories, after you activate them.'],
  },
  {
    id: 'capital-one-venture-x',
    name: 'Capital One Venture X',
    issuer: 'Capital One',
    unit: 'miles',
    base: {
      pct: 2,
      source_url: 'https://www.capitalone.com/credit-cards/venture-x/',
      checked_on: '2026-10-01',
    },
    categories: {},
    notes: [
      '10x on hotels and rental cars and 5x on flights booked through Capital One Travel. Those are portal bookings, not a purchase category, so they are not ranked.',
    ],
  },
  {
    id: 'apple-card',
    name: 'Apple Card',
    issuer: 'Apple',
    unit: 'cash',
    base: {
      condition: 'uses_apple_pay',
      question: 'Do you pay with Apple Pay?',
      without: {
        pct: 1,
        source_url: 'https://www.apple.com/apple-card/',
        checked_on: '2026-10-01',
      },
      with: {
        pct: 2,
        source_url: 'https://www.apple.com/apple-card/',
        checked_on: '2026-10-01',
      },
    },
    categories: {},
    notes: ['3% at Apple and select merchants with Apple Pay.'],
  },
];

/**
 * Returns true if a checked_on date is invalid, in the future, or older than the
 * allowed stale window.
 */
export function isStale(checkedOn: string, today: Date): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkedOn);
  if (!match) return true;
  const [, y, m, d] = match.map(Number);
  const checkedDate = new Date(y, m - 1, d);
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (checkedDate > todayLocal) return true;
  const diffMs = todayLocal.getTime() - checkedDate.getTime();
  // Rounded: across a daylight-saving change two local midnights are 23 or 25 hours apart.
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays > CATALOG_STALE_DAYS;
}

/**
 * Formats a Date as a quarter string, e.g. '2026-Q4'.
 */
export function quarterOf(today: Date): string {
  const year = today.getFullYear();
  const quarter = Math.floor(today.getMonth() / 3) + 1;
  return `${year}-Q${quarter}`;
}

/**
 * Resolves a catalog entry into concrete rewards, handling staleness,
 * conditional answers and rotating categories.
 */
export function resolveCatalogRewards(
  product: CatalogProduct,
  opts: {
    today: Date;
    answers?: Partial<Record<ConditionKey, boolean>>;
    centsPerMile?: number | null;
  },
): ResolvedRewards {
  const unknown: string[] = [];
  const notes = [...product.notes];

  const resolveSourced = (rate: SourcedRate, label: string): number | null => {
    if (isStale(rate.checked_on, opts.today)) {
      unknown.push(`${label} (last checked ${rate.checked_on}, too old to trust)`);
      return null;
    }
    return rate.pct;
  };

  // Sam's rule 1 (2026-10-01): an UNANSWERED condition takes the LOWER rate, because that never
  // overstates a reward. Where the issuer states no lower rate, the rate is unknown, not zero.
  const resolve = (rate: SourcedRate | ConditionalRate, label: string): number | null => {
    if (!('condition' in rate)) return resolveSourced(rate, label);
    const answer = opts.answers?.[rate.condition];
    const chosen = answer === true ? rate.with : rate.without;
    if (!chosen) {
      unknown.push(`${rate.question} (needed for this rate)`);
      return null;
    }
    return resolveSourced(chosen, label);
  };

  const base = resolve(product.base, 'Everyday rate');
  if (base === null) return { rewards: null, unknown, notes };

  const categories: Partial<Record<PurchaseCategory, number>> = {};
  for (const [cat, rate] of Object.entries(product.categories) as [PurchaseCategory, SourcedRate | ConditionalRate][]) {
    const pct = resolve(rate, `${cat} rate`);
    if (pct !== null) categories[cat] = pct;
  }

  if (product.rotating) {
    const q = quarterOf(opts.today);
    const entry = product.rotating.find(r => r.quarter === q && !isStale(r.checked_on, opts.today));
    if (entry) {
      for (const cat of entry.categories) categories[cat] = Math.max(categories[cat] ?? 0, entry.pct);
      if (entry.unranked?.length) {
        notes.push(`${entry.pct}% this quarter also covers ${entry.unranked.join(' and ')}, which Which Card? has no category for yet.`);
      }
    } else {
      unknown.push("This quarter's 5% categories (not yet read from the issuer)");
    }
  }

  // Sam's rule 2: miles rank against cash only at a cent value the user gave. Never assume one.
  if (product.unit === 'miles') {
    const cpm = opts.centsPerMile;
    if (typeof cpm !== 'number' || !Number.isFinite(cpm) || cpm <= 0) {
      notes.push('Miles are not ranked against cash until you enter what a mile is worth to you.');
      return { rewards: null, unknown, notes };
    }
    const scaled: Partial<Record<PurchaseCategory, number>> = {};
    for (const [cat, pct] of Object.entries(categories) as [PurchaseCategory, number][]) scaled[cat] = pct * cpm;
    return { rewards: { base_pct: base * cpm, categories: scaled }, unknown, notes };
  }

  return { rewards: { base_pct: base, categories }, unknown, notes };
}

/** The catalog entry with this id, or null. */
export function findCatalogProduct(id: string): CatalogProduct | null {
  return CARD_CATALOG.find(p => p.id === id) ?? null;
}
