import { describe, it, expect } from 'vitest';
import {
  normalizeSearchQuery,
  matchesTransactionSearch,
  type SearchableTransaction,
} from '../transaction-search';

describe('normalizeSearchQuery', () => {
  it('trims, lowercases, and collapses internal whitespace', () => {
    expect(normalizeSearchQuery('  HeLLo   World  ')).toBe('hello world');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeSearchQuery('   \t\n  ')).toBe('');
  });
});

describe('matchesTransactionSearch', () => {
  const row: SearchableTransaction = {
    note: 'Coffee Shop',
    category: 'Food',
    account: 'Checking',
  };

  it('matches every row when the query is empty', () => {
    expect(matchesTransactionSearch(row, '')).toBe(true);
  });

  it('matches every row when the query is whitespace only', () => {
    expect(matchesTransactionSearch(row, '   \t')).toBe(true);
  });

  it('normalizes its own input, so an UPPERCASE query still matches', () => {
    expect(matchesTransactionSearch(row, 'COFFEE')).toBe(true);
  });

  it('matches on the note', () => {
    expect(matchesTransactionSearch(row, 'coffee')).toBe(true);
  });

  it('matches on the category', () => {
    expect(matchesTransactionSearch(row, 'food')).toBe(true);
  });

  it('matches on the account', () => {
    expect(matchesTransactionSearch(row, 'checking')).toBe(true);
  });

  it('ANDs its terms across different fields', () => {
    // The positive control for the case below: both terms present, from two
    // different fields, must match. Without this, the negative test could pass
    // for any reason at all.
    expect(matchesTransactionSearch(row, 'coffee food')).toBe(true);
  });

  it('does NOT match when only one of two terms is present', () => {
    const tx: SearchableTransaction = { note: 'Amazon Purchase', category: 'Shopping', account: 'Credit' };
    expect(matchesTransactionSearch(tx, 'amazon groceries')).toBe(false);
  });

  it('does not throw on a row whose fields are all null or undefined', () => {
    const empty: SearchableTransaction = { note: null, category: undefined, account: null };
    expect(() => matchesTransactionSearch(empty, 'test')).not.toThrow();
    expect(matchesTransactionSearch(empty, 'test')).toBe(false);
  });

  it('treats a regex metacharacter as plain text rather than throwing', () => {
    expect(() => matchesTransactionSearch(row, '(')).not.toThrow();
    expect(matchesTransactionSearch(row, '(')).toBe(false);
  });
});
