// The Activity panel a link asks for, and the panel a remembered value resolves to. Same contract
// as `dashboard-tab.ts`/`accounts-tab.ts`/`garage-tab.ts` for the link half; the heal half is this
// surface's own, because the selector reuses a storage key that predates every panel change since.
//
// ⚠️ THE ALIAS TESTS ARE THE POINT OF THIS FILE NOW. Planning and Bank Activity merged into one
// panel (Tre, 2026-08-25: "bank activity and planning should be one tab"), and every existing user
// has `'planning'` or `'bank'` sitting in `tre:transactions:tab`. Both must land on the merged
// panel — NOT on the sign-in fallback, which would silently move people to Budget Control.

import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_TABS,
  ACTIVITY_TAB_FALLBACK,
  ACTIVITY_TAB_STORAGE_KEY,
  ACTIVITY_TAB_ALIASES,
  resetActivityTabForSignIn,
  activityTabFromSearch,
  effectiveActivityTab,
  isActivityTab,
} from '@/lib/activity-tab';

describe('activity-tab', () => {
  it('names exactly the two panels the page renders, in the order the row shows them', () => {
    expect([...ACTIVITY_TABS]).toEqual(['budget', 'transactions']);
  });

  it('lands a fresh sign-in on Budget Control', () => {
    // Tre, 2026-08-18: "on sign in it should be budget control". Separate from the row order on
    // purpose — they happen to agree today, and pinning the VALUE means they can stop agreeing
    // without this silently following the first pill around.
    expect(ACTIVITY_TAB_FALLBACK).toBe('budget');
  });

  it('writes the sign-in reset in the format the reader parses', () => {
    // Would-fail: writing a bare 'budget' instead of JSON. `usePersistedState` JSON.parses, so a
    // bare string is discarded and the reset looks like it silently did not happen.
    const written: Record<string, string> = {};
    resetActivityTabForSignIn({ setItem: (k, v) => { written[k] = v; } });
    expect(written[ACTIVITY_TAB_STORAGE_KEY]).toBe('"budget"');
    expect(effectiveActivityTab(JSON.parse(written[ACTIVITY_TAB_STORAGE_KEY]))).toBe('budget');
  });

  it('never lets a broken storage break a sign-in', () => {
    expect(() => resetActivityTabForSignIn({
      setItem: () => { throw new Error('QuotaExceededError'); },
    })).not.toThrow();
  });

  it('reads a panel a link asks for, from a string or a URLSearchParams', () => {
    expect(activityTabFromSearch('?tab=budget')).toBe('budget');
    expect(activityTabFromSearch(new URLSearchParams('tab=transactions'))).toBe('transactions');
  });

  it('lands both retired spellings on the merged panel, from a link', () => {
    // Would-fail: treating these as unknown returns null, so a bookmarked `/transactions?tab=bank`
    // would silently open whatever panel the user last used instead of the one the link named.
    expect(activityTabFromSearch('?tab=planning')).toBe('transactions');
    expect(activityTabFromSearch(new URLSearchParams('tab=bank'))).toBe('transactions');
  });

  it('returns null — never a default — when the link says nothing it knows', () => {
    // Would-fail: answering 'transactions' here would reset the user's remembered panel on every
    // plain visit to /transactions, which is exactly what the null exists to prevent.
    expect(activityTabFromSearch('')).toBeNull();
    expect(activityTabFromSearch('?tab=')).toBeNull();
    expect(activityTabFromSearch('?tab=overview')).toBeNull();
    expect(activityTabFromSearch('?other=budget')).toBeNull();
  });

  it('keeps the two values already in localStorage working, on the merged panel', () => {
    // Every user who has opened this page has 'budget', 'planning' or 'bank' stored under
    // `tre:transactions:tab`. Merging two panels into one must not send any of them to a panel
    // they did not choose — and 'planning'/'bank' healing to ACTIVITY_TAB_FALLBACK would do
    // exactly that, quietly, to everyone who was last on either half.
    expect(effectiveActivityTab('planning')).toBe('transactions');
    expect(effectiveActivityTab('bank')).toBe('transactions');
    expect(effectiveActivityTab('budget')).toBe('budget');
    expect(effectiveActivityTab('transactions')).toBe('transactions');
  });

  it('states the aliases as data, so the reader and the writer cannot drift', () => {
    expect(ACTIVITY_TAB_ALIASES).toEqual({ planning: 'transactions', bank: 'transactions' });
  });

  it('heals a value it does not recognise rather than rendering nothing', () => {
    // Would-fail: returning the stored string unchanged renders NO panel — a blank surface with no
    // error, for a user with no way to see why.
    expect(effectiveActivityTab('networth')).toBe(ACTIVITY_TAB_FALLBACK);
    expect(effectiveActivityTab('')).toBe(ACTIVITY_TAB_FALLBACK);
    expect(effectiveActivityTab(null)).toBe(ACTIVITY_TAB_FALLBACK);
    expect(effectiveActivityTab(undefined)).toBe(ACTIVITY_TAB_FALLBACK);
  });

  it('keeps the other surfaces’ vocabularies out of its own', () => {
    expect(isActivityTab('budget')).toBe(true);
    // A retired spelling is NOT a current panel — it resolves through the alias map and is
    // deliberately not a member of the union, so nothing can store or render it as a panel.
    expect(isActivityTab('planning')).toBe(false);
    expect(isActivityTab('bank')).toBe(false);
    expect(isActivityTab('overview')).toBe(false);
    expect(isActivityTab('accounts')).toBe(false);
    expect(isActivityTab('balances')).toBe(false);
    expect(isActivityTab('builds')).toBe(false);
    expect(isActivityTab(null)).toBe(false);
  });
});
