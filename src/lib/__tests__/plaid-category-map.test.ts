import { describe, it, expect } from 'vitest';
import {
  suggestCategory,
  hasCategorySuggestion,
  normalizeProviderCategory,
  isValidCategory,
  MAPPED_CATEGORIES,
  FALLBACK_CATEGORY,
} from '../plaid-category-map';
import { CATEGORIES } from '../types';

/**
 * The 18 PFC primaries actually present in Tre's live `synced_transactions` on 2026-08-08, with
 * their row counts. Pinned here so a future taxonomy change shows up as a test failure rather than
 * as silently-'Other' rows in the UI.
 */
const LIVE_CATEGORIES = [
  'GENERAL_MERCHANDISE', 'FOOD_AND_DRINK', 'GENERAL_SERVICES', 'TRANSFER_IN', 'INCOME',
  'TRANSFER_OUT', 'LOAN_PAYMENTS', 'TRANSPORTATION', 'ENTERTAINMENT', 'RENT_AND_UTILITIES',
  'LOAN_DISBURSEMENTS', 'BANK_FEES', 'TRAVEL', 'MEDICAL', 'GOVERNMENT_AND_NON_PROFIT',
  'OTHER', 'HOME_IMPROVEMENT', 'PERSONAL_CARE',
] as const;

describe('normalizeProviderCategory', () => {
  it('collapses the two provider vocabularies onto one key', () => {
    // The whole reason normalisation exists: plaid.ts:100 falls back to the legacy title-case
    // `category[0]` on older items, so both spellings reach this map.
    expect(normalizeProviderCategory('Food and Drink')).toBe('FOOD_AND_DRINK');
    expect(normalizeProviderCategory('FOOD_AND_DRINK')).toBe('FOOD_AND_DRINK');
    expect(suggestCategory('Food and Drink')).toBe(suggestCategory('FOOD_AND_DRINK'));
  });

  it('treats absent, empty and separator-only input as no category', () => {
    expect(normalizeProviderCategory(null)).toBeNull();
    expect(normalizeProviderCategory(undefined)).toBeNull();
    expect(normalizeProviderCategory('')).toBeNull();
    expect(normalizeProviderCategory('   ')).toBeNull();
    // A stray separator must not become a key that matches nothing but looks real.
    expect(normalizeProviderCategory('___')).toBeNull();
  });

  it('trims stray separators rather than producing an unmatchable key', () => {
    expect(normalizeProviderCategory('_TRAVEL_')).toBe('TRAVEL');
    expect(suggestCategory(' travel ')).toBe('Travel');
  });
});

describe('suggestCategory', () => {
  it('always returns a real app category, for every live provider value', () => {
    for (const c of LIVE_CATEGORIES) {
      const suggested = suggestCategory(c);
      expect(CATEGORIES).toContain(suggested);
    }
  });

  it('never returns null or throws on junk input', () => {
    expect(suggestCategory(null)).toBe(FALLBACK_CATEGORY);
    expect(suggestCategory('NOT_A_REAL_PLAID_CATEGORY')).toBe(FALLBACK_CATEGORY);
    expect(suggestCategory('🙂')).toBe(FALLBACK_CATEGORY);
  });

  it('maps the unambiguous primaries the way the doc says', () => {
    expect(suggestCategory('INCOME')).toBe('Income');
    expect(suggestCategory('LOAN_PAYMENTS')).toBe('Debt Payments');
    expect(suggestCategory('MEDICAL')).toBe('Health');
    expect(suggestCategory('ENTERTAINMENT')).toBe('Entertainment');
    expect(suggestCategory('TRAVEL')).toBe('Travel');
    expect(suggestCategory('GENERAL_MERCHANDISE')).toBe('Shopping');
  });

  it('maps TRANSPORTATION to Car, not Gas', () => {
    // Plaid's TRANSPORTATION spans gas, parking, tolls, transit and ride-share. 'Gas' would be
    // precisely wrong for five of the six; 'Car' is wrong less often. Pinned because 'Gas' is the
    // intuitive choice and this test is the reason not to make it.
    expect(suggestCategory('TRANSPORTATION')).toBe('Car');
  });

  it('resolves each two-member primary to its more frequent member', () => {
    // Neither is separable from a PFC primary alone; both are corrections the user may need.
    expect(suggestCategory('FOOD_AND_DRINK')).toBe('Dining');
    expect(suggestCategory('RENT_AND_UTILITIES')).toBe('Utilities');
  });

  it('refuses to guess what a transfer means', () => {
    // A transfer's meaning lives in the far account, which the provider does not report.
    expect(suggestCategory('TRANSFER_IN')).toBe('Other');
    expect(suggestCategory('TRANSFER_OUT')).toBe('Other');
  });

  it('handles legacy category[0] values from pre-PFC items', () => {
    expect(suggestCategory('Shops')).toBe('Shopping');
    expect(suggestCategory('Healthcare')).toBe('Health');
    expect(suggestCategory('Recreation')).toBe('Entertainment');
    expect(suggestCategory('Payment')).toBe('Debt Payments');
  });
});

describe('hasCategorySuggestion', () => {
  it('distinguishes a real opinion from a fallback', () => {
    // Both yield 'Other', but only one is the provider actually telling us something. The UI
    // phrases these differently: "suggested" vs "uncategorised".
    expect(suggestCategory('TRANSFER_IN')).toBe('Other');
    expect(hasCategorySuggestion('TRANSFER_IN')).toBe(true);

    expect(suggestCategory('WHO_KNOWS')).toBe('Other');
    expect(hasCategorySuggestion('WHO_KNOWS')).toBe(false);
  });

  it('reports no suggestion when the provider gave no category', () => {
    expect(hasCategorySuggestion(null)).toBe(false);
    expect(hasCategorySuggestion('')).toBe(false);
  });

  it('has an opinion about every category present in live data', () => {
    // If Plaid adds a primary, this fails and someone decides where it goes — rather than 100% of
    // a new merchant type quietly landing in 'Other'.
    for (const c of LIVE_CATEGORIES) {
      expect(hasCategorySuggestion(c), `no mapping for ${c}`).toBe(true);
    }
  });
});

describe('map integrity', () => {
  it('only ever produces categories the app actually offers', () => {
    // Guards the seam: a typo like 'Shoppping' would otherwise reach a <select> that cannot show
    // it, and the user could never correct it back to a valid value.
    for (const mapped of MAPPED_CATEGORIES) {
      expect(CATEGORIES, `${mapped} is not an app category`).toContain(mapped);
    }
  });

  it('validates user overrides against the real category list', () => {
    expect(isValidCategory('Groceries')).toBe(true);
    expect(isValidCategory('Other')).toBe(true);
    expect(isValidCategory('Shoppping')).toBe(false);
    expect(isValidCategory('')).toBe(false);
  });
});
