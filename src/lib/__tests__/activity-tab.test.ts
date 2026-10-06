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
  isPlanTabRequest,
} from '@/lib/activity-tab';

describe('activity-tab', () => {
  it('names exactly the two panels the page renders, in the order the row shows them', () => {
    // Plan left this row on 2026-10-06 for its own bottom-bar slot (decision c5e29d9e).
    expect([...ACTIVITY_TABS]).toEqual(['transactions', 'forecast']);
  });

  it('lands a fresh sign-in on the Transactions panel, now that Plan is its own page', () => {
    // Was 'budget' (Tre, 2026-08-18: "on sign in it should be budget control"). Plan left this
    // surface on 2026-10-06, so the reset can no longer open it here; Plan has its own tab.
    expect(ACTIVITY_TAB_FALLBACK).toBe('transactions');
  });

  it('writes the sign-in reset in the format the reader parses', () => {
    // Would-fail: writing a bare 'budget' instead of JSON. `usePersistedState` JSON.parses, so a
    // bare string is discarded and the reset looks like it silently did not happen.
    const written: Record<string, string> = {};
    resetActivityTabForSignIn({ setItem: (k, v) => { written[k] = v; } });
    expect(written[ACTIVITY_TAB_STORAGE_KEY]).toBe('"transactions"');
    expect(effectiveActivityTab(JSON.parse(written[ACTIVITY_TAB_STORAGE_KEY]))).toBe('transactions');
  });

  it('never lets a broken storage break a sign-in', () => {
    expect(() => resetActivityTabForSignIn({
      setItem: () => { throw new Error('QuotaExceededError'); },
    })).not.toThrow();
  });

  it('reads a panel a link asks for, from a string or a URLSearchParams', () => {
    expect(activityTabFromSearch('?tab=forecast')).toBe('forecast');
    expect(activityTabFromSearch(new URLSearchParams('tab=transactions'))).toBe('transactions');
  });

  it('recognises an old ?tab=budget link as a request for the Plan page, and nothing else', () => {
    // Would-fail: without this, every old link to Plan inside Transactions would open the ledger.
    expect(isPlanTabRequest('?tab=budget')).toBe(true);
    expect(isPlanTabRequest(new URLSearchParams('tab=budget&x=1'))).toBe(true);
    expect(activityTabFromSearch('?tab=budget')).toBeNull();
    expect(isPlanTabRequest('?tab=transactions')).toBe(false);
    expect(isPlanTabRequest('?other=budget')).toBe(false);
    expect(isPlanTabRequest('')).toBe(false);
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
    // A stored 'budget' (every sign-in wrote it until 2026-10-06) opens the ledger, not a blank.
    expect(effectiveActivityTab('budget')).toBe('transactions');
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
    expect(isActivityTab('transactions')).toBe(true);
    expect(isActivityTab('budget')).toBe(false);
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
