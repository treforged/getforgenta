// The Activity panel a link asks for, and the panel a remembered value resolves to. Same contract
// as `dashboard-tab.ts`/`accounts-tab.ts`/`garage-tab.ts` for the link half; the heal half is new,
// because this selector reuses a storage key that predates the third panel.

import { describe, it, expect } from 'vitest';
import {
  ACTIVITY_TABS,
  ACTIVITY_TAB_FALLBACK,
  ACTIVITY_TAB_STORAGE_KEY,
  resetActivityTabForSignIn,
  activityTabFromSearch,
  effectiveActivityTab,
  isActivityTab,
} from '@/lib/activity-tab';

describe('activity-tab', () => {
  it('names exactly the three panels the page renders, in the order the row shows them', () => {
    expect([...ACTIVITY_TABS]).toEqual(['budget', 'planning', 'bank']);
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
    expect(activityTabFromSearch(new URLSearchParams('tab=bank'))).toBe('bank');
    expect(activityTabFromSearch('?tab=planning')).toBe('planning');
  });

  it('returns null — never a default — when the link says nothing it knows', () => {
    // Would-fail: answering 'planning' here would reset the user's remembered panel on every plain
    // visit to /transactions, which is exactly what the null exists to prevent.
    expect(activityTabFromSearch('')).toBeNull();
    expect(activityTabFromSearch('?tab=')).toBeNull();
    expect(activityTabFromSearch('?tab=overview')).toBeNull();
    expect(activityTabFromSearch('?other=budget')).toBeNull();
  });

  it('keeps the two values already in localStorage working untouched', () => {
    // Every user who has opened this page has 'planning' or 'bank' stored under
    // `tre:transactions:tab`. Adding a third panel must not invalidate either.
    expect(effectiveActivityTab('planning')).toBe('planning');
    expect(effectiveActivityTab('bank')).toBe('bank');
  });

  it('heals a value it does not recognise rather than rendering nothing', () => {
    // Would-fail: returning the stored string unchanged renders NO panel — a blank surface with no
    // error, for a user with no way to see why.
    expect(effectiveActivityTab('networth')).toBe(ACTIVITY_TAB_FALLBACK);
    expect(effectiveActivityTab('')).toBe(ACTIVITY_TAB_FALLBACK);
    expect(effectiveActivityTab(null)).toBe(ACTIVITY_TAB_FALLBACK);
    expect(effectiveActivityTab(undefined)).toBe(ACTIVITY_TAB_FALLBACK);
  });

  it('keeps the other surfaces\u2019 vocabularies out of its own', () => {
    expect(isActivityTab('budget')).toBe(true);
    expect(isActivityTab('overview')).toBe(false);
    expect(isActivityTab('accounts')).toBe(false);
    expect(isActivityTab('balances')).toBe(false);
    expect(isActivityTab('builds')).toBe(false);
    expect(isActivityTab(null)).toBe(false);
  });
});
