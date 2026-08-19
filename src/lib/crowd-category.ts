/**
 * Slice 6 — what the crowd thinks a merchant is, and where it sits in the order of answers.
 *
 * ## The order, and why it is this way round
 *
 * 1. **The user's own answer** (`merchant-memory.ts`). Always wins. It is not a guess: it is read
 *    back off their own `category_override` rows, and a wrong one is their own previous answer —
 *    the only kind they can actually correct.
 * 2. **The crowd**, from `public.crowd_merchant_categories()`. Only ever appears where at least
 *    three DIFFERENT people independently said the same thing; the database clamps that floor and
 *    a caller cannot lower it.
 * 3. **The provider's own category** (`plaid-category-map.ts`). Last, because it is the bank's
 *    bucketing rather than anybody's decision.
 *
 * ⚠️ THIS IS NOT THE MERCHANT-NAME HEURISTIC `plaid-category-map.ts` FORBIDS, and the difference is
 * the same one that lets merchant memory exist: nothing here reads the CHARACTERS of a merchant
 * name and infers meaning from them. "Publix" maps to Groceries because people said so, not because
 * the string looks grocery-ish. Delete the votes and this module has no opinion at all.
 *
 * ⚠️ A SUGGESTION IS A FIRST DRAFT, NEVER A CLAIM. `source` exists so the UI can say which of the
 * three answered, because "you said this" and "other people say this" are different promises and a
 * surface that renders them identically is making the stronger one on the weaker one's evidence.
 */
import { isValidCategory } from './plaid-category-map';
import type { Category } from './types';

/** What the crowd returns per merchant. Mirrors `public.crowd_merchant_categories()`'s columns. */
export interface CrowdCategory {
  category: string;
  /** How many DISTINCT people said it. Never below the database's floor of 3. */
  voters: number;
}

export type SuggestionSource = 'you' | 'crowd' | 'provider' | 'none';

export interface CategorySuggestion {
  category: Category | null;
  source: SuggestionSource;
  /** Present only when `source` is 'crowd'. What the UI needs to say how many agreed. */
  voters?: number;
}

export interface ResolveSuggestionInput {
  /** The user's own remembered category for this merchant, if any. */
  ownCategory?: string | null;
  /** This merchant's row from the crowd map, if it cleared the threshold. */
  crowd?: CrowdCategory | null;
  /** What `suggestCategory(providerCategory)` produced, and whether it actually had an opinion. */
  providerCategory?: string | null;
  providerHasOpinion?: boolean;
}

/**
 * The one place the three sources are ordered.
 *
 * ⚠️ An invalid category from ANY source is skipped rather than shown. The crowd table is written
 * by clients, so a category string that is no longer in the app's vocabulary can survive in it long
 * after the app stopped using it — rendering that would put a dead label in a live dropdown.
 */
export function resolveCategorySuggestion(input: ResolveSuggestionInput): CategorySuggestion {
  const own = input.ownCategory;
  if (own && isValidCategory(own)) return { category: own, source: 'you' };

  const crowd = input.crowd;
  if (crowd && isValidCategory(crowd.category)) {
    return { category: crowd.category, source: 'crowd', voters: crowd.voters };
  }

  const provider = input.providerCategory;
  if (input.providerHasOpinion && provider && isValidCategory(provider)) {
    return { category: provider, source: 'provider' };
  }

  return { category: null, source: 'none' };
}

/**
 * How a surface names the source in one short phrase.
 *
 * ⚠️ THE CROWD LINE NEVER NAMES A NUMBER OF PEOPLE PRECISELY ("3 people say…"). At the threshold
 * that is a headcount of a very small group, and a headcount invites the reader to work out who.
 * "Other people who shop here" carries the same weight and identifies nobody.
 */
export function describeSuggestionSource(s: CategorySuggestion): string | null {
  switch (s.source) {
    case 'you': return 'You already said this';
    case 'crowd': return 'Other people who shop here say this';
    case 'provider': return 'From your bank’s own label';
    default: return null;
  }
}

/**
 * The privacy sentence that has to appear wherever the crowd answer does.
 *
 * ⚠️ REQUIRED BY THE SLICE, and it is not boilerplate — it is the only place a user finds out that
 * their categorisations leave their account at all. Keep it specific about what is and is not sent:
 * a vague "we use aggregated data" reassures nobody and tells them nothing.
 */
export const CROWD_PRIVACY_NOTE =
  'Shared suggestions come from merchant names and category labels only — never amounts, dates, '
  + 'or anything about your accounts. A merchant is only ever suggested once several different '
  + 'people have independently given it the same label, so a one-off payee of yours is never shared.';
