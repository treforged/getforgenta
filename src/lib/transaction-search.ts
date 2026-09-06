/**
 * Free-text search over ledger rows.
 *
 * WHY THIS EXISTS AT ALL. Measured 2026-09-06: `grep -rn 'type="search"' src/`
 * returned ZERO. The whole app had no text input that searches anything, while
 * every bank app, Mint, YNAB, Copilot and Monarch put one at the top of the
 * ledger. "Did that charge go through?" and "what do I spend at X?" were two
 * questions Forgenta simply could not answer. See `docs/screens-jakobs-law.md`.
 *
 * THIS ONLY ANSWERS "does this row match the typed text". The four dropdown
 * filters on the page (month, type, category, source) stay exactly as they
 * were and are ANDed with this one, so nothing was taken away to add it.
 *
 * AN EMPTY BOX FILTERS NOTHING, and that is the load-bearing case. Returning
 * false for an empty query hides the entire ledger, which is the most
 * expensive thing this file could do.
 *
 * THE QUERY IS NORMALIZED HERE, NOT AT THE CALL SITE. A predicate that trusts
 * its caller to have lowercased the query already returns zero rows the first
 * time somebody types a capital letter, and does it silently.
 *
 * NO REGEX IS EVER BUILT FROM WHAT WAS TYPED. `new RegExp('(')` throws, and a
 * search box is precisely where a stray bracket gets typed. Only `toLowerCase`
 * and `includes` are used against the input.
 */

/** The fields of a ledger row this searches. `note` is the row's description. */
export interface SearchableTransaction {
  note?: string | null;
  category?: string | null;
  account?: string | null;
}

/**
 * Trim, lowercase, and collapse runs of internal whitespace to one space.
 *
 * Whitespace-only input normalizes to '' so that a box holding only spaces
 * behaves exactly like an empty one.
 */
export function normalizeSearchQuery(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') return '';
  // A literal pattern, never one assembled from user input.
  return trimmed.replace(/\s+/g, ' ');
}

/**
 * True when every term in `query` appears somewhere in the row's text.
 *
 * Terms are ANDed, not ORed: typing "amazon groceries" must NARROW the ledger.
 * ORing them would widen it, which is the opposite of what a person typing a
 * second word is asking for.
 *
 * `query` may be raw — it is normalized here — and an empty or whitespace-only
 * query matches every row.
 */
export function matchesTransactionSearch(t: SearchableTransaction, query: string): boolean {
  const normalized = normalizeSearchQuery(query);
  if (normalized === '') return true;

  const haystack = [t.note, t.category, t.account]
    .filter((field): field is string => typeof field === 'string' && field.length > 0)
    .join(' ')
    .toLowerCase();

  return normalized.split(' ').every(term => haystack.includes(term));
}
