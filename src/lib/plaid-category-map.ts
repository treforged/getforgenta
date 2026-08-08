// §1B — provider category → app category. Pure, no I/O.
//
// WHAT THIS IS: a FIRST DRAFT THE USER CORRECTS, never a claim. Every surface that shows a mapped
// category must let the user override it, because the ceiling here is low and structural, not a
// matter of tuning:
//
//   - `synced_transactions.category` holds Plaid's personal_finance_category **primary** — one of
//     ~16 buckets (`providers/plaid.ts:100`). Plaid's own taxonomy is far more specific at the
//     `detailed` level, but Stage A never stored it, so the information genuinely is not here.
//   - `GENERAL_MERCHANDISE` is 183 of Tre's 571 rows (32%) and means no more than "a store".
//   - Plaid's `FOOD_AND_DRINK` covers both groceries and restaurants; its `RENT_AND_UTILITIES`
//     covers both rent and the power bill. One primary cannot separate them, so each maps to its
//     more FREQUENT member and the less frequent one is a correction the user makes.
//
// ⚠️ DO NOT "improve" this with merchant-name heuristics. §1A rejected fuzzy name scoring
// (`transaction-matching.ts:26-28`) as unpredictable, locale-sensitive and hard to test; the same
// reasoning applies here, and the failure mode is worse — a wrong category is silently wrong in a
// budget total, where a wrong match at least shows up as a badge on a named bill.

import { CATEGORIES, type Category } from './types';

/** Where anything unrecognised lands. A real app category, so no downstream code special-cases it. */
export const FALLBACK_CATEGORY: Category = 'Other';

/**
 * Provider category key → app category.
 *
 * Keyed on the NORMALISED form (see `normalizeProviderCategory`) so one entry serves both provider
 * vocabularies: Plaid's PFC primary (`FOOD_AND_DRINK`) and the legacy `category[0]` string
 * (`"Food and Drink"`) that `providers/plaid.ts:100` still falls back to on older items. The two
 * spellings collapse onto the same key, which is the whole reason for normalising rather than
 * matching literals.
 */
const PROVIDER_CATEGORY_MAP: Readonly<Record<string, Category>> = {
  // ── Plaid personal_finance_category primaries ────────────────────────────
  INCOME: 'Income',
  LOAN_PAYMENTS: 'Debt Payments',
  ENTERTAINMENT: 'Entertainment',
  MEDICAL: 'Health',
  PERSONAL_CARE: 'Personal',
  TRAVEL: 'Travel',
  GENERAL_MERCHANDISE: 'Shopping',

  // Both members are common; 'Dining' is the more frequent and the more discretionary, which is
  // the one a budget actually wants visible. Groceries arrive here too and need correcting.
  FOOD_AND_DRINK: 'Dining',

  // Rent lands here as well. 'Utilities' wins on row count — rent is one row a month — but it is
  // the larger amount, so this is the mapping most worth a user's attention.
  RENT_AND_UTILITIES: 'Utilities',

  // Plaid's TRANSPORTATION spans gas, parking, tolls, transit and ride-share; only one of those is
  // fuel. 'Car' is the bucket that is least wrong across the set — deliberately NOT 'Gas', which
  // would be precisely wrong five times out of six.
  TRANSPORTATION: 'Car',

  // A fee is a charge the user did not choose, which is what 'Bills' means here.
  BANK_FEES: 'Bills',

  // Genuinely unclassifiable at the primary level: a transfer's meaning lives entirely in the
  // account on the other end, which the provider does not tell us. 'Other' is the honest answer.
  TRANSFER_IN: 'Other',
  TRANSFER_OUT: 'Other',
  LOAN_DISBURSEMENTS: 'Other',
  GENERAL_SERVICES: 'Other',
  GOVERNMENT_AND_NON_PROFIT: 'Other',
  HOME_IMPROVEMENT: 'Other',
  OTHER: 'Other',

  // ── Legacy Plaid `category[0]` values, for items that predate PFC ────────
  SHOPS: 'Shopping',
  PAYMENT: 'Debt Payments',
  TRANSFER: 'Other',
  RECREATION: 'Entertainment',
  SERVICE: 'Other',
  HEALTHCARE: 'Health',
  COMMUNITY: 'Other',
  INTEREST: 'Other',
  TAX: 'Bills',
};

/**
 * Fold a provider category into the map's key space.
 *
 * `"Food and Drink"` and `"FOOD_AND_DRINK"` are the same bucket in two vocabularies; upper-casing
 * and collapsing every run of non-alphanumerics to a single underscore makes them one key. Leading
 * and trailing underscores are trimmed so a stray separator cannot produce a key that matches
 * nothing.
 */
export function normalizeProviderCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return key || null;
}

/**
 * The app category suggested for a provider category, always a real `Category`.
 *
 * Never throws and never returns null: a suggestion the UI has to null-check would grow a second
 * "unknown" state next to `'Other'`, and there is no useful difference between "the provider said
 * nothing" and "the provider said something we do not recognise" — both mean the user should look.
 */
export function suggestCategory(providerCategory: string | null | undefined): Category {
  const key = normalizeProviderCategory(providerCategory);
  if (!key) return FALLBACK_CATEGORY;
  return PROVIDER_CATEGORY_MAP[key] ?? FALLBACK_CATEGORY;
}

/**
 * Whether `suggestCategory` had an actual opinion, as opposed to falling back.
 *
 * The UI uses this to phrase itself honestly — a mapped guess can be shown as "suggested", while a
 * fallback should read as "uncategorised" rather than asserting the transaction is miscellaneous.
 * Note a provider category that legitimately maps to `'Other'` (a transfer) is still an opinion.
 */
export function hasCategorySuggestion(providerCategory: string | null | undefined): boolean {
  const key = normalizeProviderCategory(providerCategory);
  return key !== null && key in PROVIDER_CATEGORY_MAP;
}

/** Every app category this map can produce. Exported so a test can assert they are all real. */
export const MAPPED_CATEGORIES: readonly Category[] = Object.values(PROVIDER_CATEGORY_MAP);

/** Guard used by the review UI when accepting a user's override. */
export function isValidCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
